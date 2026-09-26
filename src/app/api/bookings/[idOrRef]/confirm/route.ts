// POST /api/bookings/[idOrRef]/confirm — contrat API centrale §12 :
// confirme une réservation APRÈS paiement réellement confirmé côté serveur.
// Jamais sur parole du navigateur : s'il n'existe AUCUN paiement SUCCESS,
// la confirmation est refusée (409 PAYMENT_REQUIRED).
// Idempotent : re-confirmer une réservation déjà CONFIRMED renvoie le détail.

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, assertSameOriginPost, ApiError, ERROR_CODES } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import { getBookingDetail } from "@/services/booking";

export async function POST(req: NextRequest, { params }: { params: Promise<{ idOrRef: string }> }) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    enforceRateLimit(`confirm:${getClientIp(req)}`, RATE_LIMITS.booking.limit, RATE_LIMITS.booking.windowMs);
    const { idOrRef } = await params;

    const booking = await db.booking.findFirst({
      where: { OR: [{ id: idOrRef }, { bookingReference: idOrRef.toUpperCase() }] },
      include: { payment: true },
    });
    if (!booking) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Réservation introuvable.");

    if (["CANCELLED", "EXPIRED"].includes(booking.status)) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette réservation ne peut plus être confirmée.");
    }

    if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") {
      // §10/§12 : un paiement est réellement SUCCESS côté serveur ? Sinon refus.
      const success = booking.payment.find((p) => p.status === "SUCCESS");
      if (!success) {
        throw new ApiError(
          409,
          ERROR_CODES.PAYMENT_REQUIRED,
          "Le paiement n'a pas été confirmé côté serveur. Finalisez le paiement avant de confirmer la réservation."
        );
      }
      // Passage PENDING → CONFIRMED (le billet est émis par le même chemin
      // idempotent que le webhook : confirmPaymentAndIssueTicket).
      const { confirmPaymentAndIssueTicket } = await import("@/services/payment");
      await confirmPaymentAndIssueTicket(success.id, null, ip);
    }

    const detail = await getBookingDetail(booking.id);
    return ok(detail);
  } catch (err) {
    return routeError(err, "POST /api/bookings/[idOrRef]/confirm");
  }
}
