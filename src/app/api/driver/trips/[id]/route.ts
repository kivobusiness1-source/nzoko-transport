// PATCH /api/driver/trips/[id] — le CHAUFFEUR fait avancer le statut de SON voyage
// (§4/§18) : SCHEDULED→READY→WAITING→BOARDING→DEPARTED→ARRIVED.
// Interdits : annulation, sauts de statut, prix/bus/chauffeur (réservés admin).
// Synchronise driver.status : ON_TRIP au départ, AVAILABLE à l'arrivée.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { TRIP_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";

const DRIVER_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["READY", "WAITING"],
  READY: ["WAITING", "BOARDING"],
  WAITING: ["BOARDING"],
  BOARDING: ["DEPARTED"],
  DEPARTED: ["ARRIVED"],
  ARRIVED: [],
  CANCELLED: [],
  COMPLETED: [],
};

const schema = z.object({
  status: z.enum(TRIP_STATUSES, "Statut invalide."),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertAuthenticated(await getAuth(req));
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux chauffeurs.");
    }
    const body = schema.parse(await req.json().catch(() => null));

    const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
    if (!driver) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
    }

    const trip = await db.trip.findUnique({ where: { id } });
    if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
    // Le chauffeur ne pilote QUE ses propres voyages
    if (trip.driverId !== driver.id) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce voyage n'est pas assigné à votre compte.");
    }

    const allowed = DRIVER_TRANSITIONS[trip.status] ?? [];
    if (!allowed.includes(body.status)) {
      throw new ApiError(
        409,
        ERROR_CODES.CONFLICT,
        `Transition impossible : ${trip.status} → ${body.status}. Suivez l'ordre : prêt → attente → embarquement → en voyage → arrivé.`
      );
    }

    await db.$transaction(async (tx) => {
      await tx.trip.update({ where: { id }, data: { status: body.status } });
      // Synchronisation du statut du chauffeur
      if (body.status === "DEPARTED") {
        await tx.driver.update({ where: { id: driver.id }, data: { status: "ON_TRIP" } }).catch(() => {});
      } else if (body.status === "ARRIVED") {
        await tx.driver.update({ where: { id: driver.id }, data: { status: "AVAILABLE" } }).catch(() => {});
      }
    });

    // À l'arrivée : les réservations CONFIRMÉES passent COMPLETED
    if (body.status === "ARRIVED") {
      await db.booking.updateMany({ where: { tripId: id, status: "CONFIRMED" }, data: { status: "COMPLETED" } }).catch(() => {});
    }

    await logAudit({
      userId: auth.userId,
      action: "TRIP_STATUS_CHANGED",
      entity: "Trip",
      entityId: id,
      metadata: { code: trip.code, oldStatus: trip.status, newStatus: body.status, by: "DRIVER" },
      ipAddress: getClientIp(req),
    });

    return ok({ id, status: body.status });
  } catch (err) {
    return routeError(err, "PATCH /api/driver/trips/[id]");
  }
}
