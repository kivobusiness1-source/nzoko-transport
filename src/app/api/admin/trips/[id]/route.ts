// PATCH /api/admin/trips/[id] — statut / prix / chauffeur / bus (trip:manage ; scope agence)
// Transitions : SCHEDULED→BOARDING→DEPARTED→ARRIVED→COMPLETED ; →CANCELLED depuis SCHEDULED/BOARDING.
// Annulation ⇒ TOUTES les réservations actives annulées (PENDING + CONFIRMED — billets VOID,
// places libérées, événements TRIP_CANCELLED/BOOKING_CANCELLED/SEAT_RELEASED/TICKET_CANCELLED),
// notifications clients ; remboursements traités ensuite via la liste de contacts (§3.16).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { TRIP_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";
import { toTripSearchDTO } from "@/services/booking";
import { cancelTripBookingsForCancellation } from "@/services/trip-lifecycle";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["BOARDING", "CANCELLED"],
  BOARDING: ["DEPARTED", "CANCELLED"],
  DEPARTED: ["ARRIVED"],
  ARRIVED: ["COMPLETED"],
  CANCELLED: [],
  COMPLETED: [],
};

const updateSchema = z
  .object({
    status: z.enum(TRIP_STATUSES, "Statut invalide.").optional(),
    price: z.number().int("Montant entier XAF requis.").positive("Le prix doit être positif.").optional(),
    driverId: z.string().trim().min(1).nullable().optional(),
    busId: z.string().trim().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "trip:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const trip = await db.trip.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");

    // Scope agence : un non-global ne gère que les voyages de son agence
    resolveAgencyScope(auth, trip.agencyId);

    // --- Transitions de statut contrôlées ---
    if (body.status && body.status !== trip.status) {
      const allowed = ALLOWED_TRANSITIONS[trip.status] ?? [];
      if (!allowed.includes(body.status)) {
        throw new ApiError(
          409,
          ERROR_CODES.CONFLICT,
          `Transition impossible : ${trip.status} → ${body.status}.`
        );
      }
    }

    // --- Réaffectations cohérentes avec l'agence du voyage ---
    if (body.busId && body.busId !== trip.busId) {
      const bus = await db.bus.findUnique({ where: { id: body.busId } });
      if (!bus) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Bus inconnu.");
      if (bus.agencyId !== trip.agencyId) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Le bus n'appartient pas à l'agence du voyage.");
      }
    }
    if (body.driverId) {
      const driver = await db.driver.findUnique({ where: { id: body.driverId } });
      if (!driver) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Chauffeur inconnu.");
      if (driver.agencyId !== trip.agencyId) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Le chauffeur n'appartient pas à l'agence du voyage.");
      }
    }

    // --- Mise à jour ---
    await db.trip.update({
      where: { id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.driverId !== undefined ? { driverId: body.driverId } : {}),
        ...(body.busId !== undefined ? { busId: body.busId } : {}),
      },
    });

    // --- Annulation : TOUTES les réservations actives (PENDING + CONFIRMED) ---
    // PENDING  : verrous libérés, aucun argent encaissé.
    // CONFIRMED: billets VOID, places libérées, paiements laissés SUCCESS —
    //            le remboursement est traité par l'agence via la liste de
    //            contacts (POST /api/admin/payments/{id}/refund §3.16) puis
    //            journalisé (événement PAYMENT_REFUNDED).
    // Événements §14 émis par le service : TRIP_CANCELLED + BOOKING_CANCELLED
    // (reason=TRIP_CANCELLED) + SEAT_RELEASED ×N + TICKET_CANCELLED —
    // le SITE AGENCES et le SITE CLIENT répercutent l'annulation en temps réel.
    let cancellation: Awaited<ReturnType<typeof cancelTripBookingsForCancellation>> | null = null;
    if (body.status === "CANCELLED") {
      cancellation = await cancelTripBookingsForCancellation(id, auth.userId);

      // Notifications : créateurs des réservations + responsables de l'agence
      const affected = await db.booking.findMany({
        where: { tripId: id, status: "CANCELLED", createdById: { not: null } },
        select: { createdById: true },
      });
      const recipients = new Set<string>();
      for (const b of affected) if (b.createdById) recipients.add(b.createdById);
      const managers = await db.user.findMany({
        where: { agencyId: trip.agencyId, isActive: true, role: { code: "AGENCY_MANAGER" } },
        select: { id: true },
      });
      for (const m of managers) recipients.add(m.id);
      const totalCancelled = cancellation.cancelledPending + cancellation.cancelledConfirmed;
      for (const userId of recipients) {
        await db.notification
          .create({
            data: {
              userId,
              title: "Voyage annulé",
              message: `Le voyage ${trip.code} a été annulé. ${
                totalCancelled > 0
                  ? `${totalCancelled} réservation(s) ont été annulées${cancellation.refundDue > 0 ? ` — ${cancellation.cancelledConfirmed} billet(s) payé(s) à rembourser (${cancellation.refundDue} FCFA, liste dans « Contacts annulation »)` : ""}.`
                  : "Aucune réservation active."
              }`,
              type: "ALERT",
            },
          })
          .catch(() => {});
      }
    }

    // --- DTO enrichi (même include que la recherche) ---
    const now = new Date();
    const updated = await db.trip.findUnique({
      where: { id },
      include: {
        route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
        bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
        agency: true,
        occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
      },
    });
    if (!updated) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de recharger le voyage.");

    await logAudit({
      userId: auth.userId,
      action:
        body.status !== undefined && body.status !== trip.status
          ? "TRIP_STATUS_CHANGED"
          : body.price !== undefined
            ? "PRICE_CHANGED"
            : "TRIP_UPDATED",
      entity: "Trip",
      entityId: id,
      metadata: {
        code: trip.code,
        fields: Object.keys(body),
        ...(body.status !== undefined && body.status !== trip.status
          ? {
              oldStatus: trip.status,
              newStatus: body.status,
              ...(cancellation
                ? {
                    cancelledPending: cancellation.cancelledPending,
                    cancelledConfirmed: cancellation.cancelledConfirmed,
                    refundDue: cancellation.refundDue,
                    freedSeats: cancellation.freedSeats,
                  }
                : {}),
            }
          : {}),
        ...(body.price !== undefined ? { oldPrice: trip.price, newPrice: body.price } : {}),
      },
      ipAddress: ip,
    });

    return ok({
      ...toTripSearchDTO(updated, updated.bus.seatLayout.seats.length, updated.occupancies.length),
      ...(cancellation ? { cancellation } : {}),
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/trips/[id]");
  }
}
