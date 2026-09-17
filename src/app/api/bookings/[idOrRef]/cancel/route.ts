// PATCH /api/bookings/[idOrRef]/cancel — annulation d'une réservation
// - Connecté avec booking:manage → annulation via le service (scope agence)
// - Non connecté porteur de la référence → PENDING uniquement (statut vérifié serveur)

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { GLOBAL_ROLES } from "@/lib/constants";
import { cancelBooking } from "@/services/booking";
import { db } from "@/lib/db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ idOrRef: string }> }) {
  try {
    assertSameOriginPost(req);
    const { idOrRef } = await params;
    const key = decodeURIComponent(idOrRef);
    const ip = getClientIp(req);
    const auth = await getAuth(req);

    if (auth && auth.permissions.includes("booking:manage")) {
      // Personnel autorisé : le service applique le scope multi-agences
      const detail = await cancelBooking(
        key,
        auth.userId,
        auth.agencyId,
        GLOBAL_ROLES.includes(auth.role)
      );
      await logAudit({
        userId: auth.userId,
        action: "BOOKING_CANCELLED",
        entity: "Booking",
        entityId: detail.id,
        metadata: { reference: detail.bookingReference, previousStatus: detail.status, by: "staff" },
        ipAddress: ip,
      });
      return ok(detail);
    }

    // Passager (non connecté ou sans permission) porteur de la référence :
    // uniquement une réservation PENDING encore valide.
    const booking = await db.booking.findFirst({
      where: { OR: [{ id: key }, { bookingReference: key.toUpperCase() }] },
      select: { id: true, bookingReference: true, status: true, payment: { select: { status: true } } },
    });
    if (!booking) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable. Vérifiez la référence.");
    }
    if (booking.status !== "PENDING") {
      throw new ApiError(
        403,
        ERROR_CODES.FORBIDDEN,
        "Seule une réservation en attente de paiement peut être annulée par le passager."
      );
    }
    if (booking.payment.some((p) => p.status === "SUCCESS")) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Contactez l'agence : ce paiement est déjà confirmé.");
    }

    // La référence non prédictible EST l'autorisation (isGlobal pour contourner
    // le scope agence) ; aucune écriture FK n'utilise l'acteur sur ce chemin PENDING.
    const detail = await cancelBooking(key, "", null, true);
    await logAudit({
      action: "BOOKING_CANCELLED",
      entity: "Booking",
      entityId: detail.id,
      metadata: { reference: detail.bookingReference, by: "passenger" },
      ipAddress: ip,
    });
    return ok(detail);
  } catch (err) {
    return routeError(err, "PATCH /api/bookings/[idOrRef]/cancel");
  }
}
