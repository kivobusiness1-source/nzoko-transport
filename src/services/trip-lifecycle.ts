// ============================================================
// OCÉAN DU NORD — Cycle de vie d'un VOYAGE annulé (côté réservations)
//
// L'annulation d'un voyage par l'exploitant doit emporter TOUTES les
// réservations actives, pas seulement les PENDING :
//   - PENDING   : verrous libérés, aucun argent encaissé ;
//   - CONFIRMED : billets VOID + places libérées ; les paiements restent
//     SUCCESS (l'argent est réellement encaissé) → le remboursement est
//     TRAITÉ PAR L'AGENCE via la liste de contacts (POST refund — §3.16)
//     et journalisé (PAYMENT_REFUNDED). Marquer REFUNDED avant d'avoir
//     rendu l'argent mentirait à la comptabilité.
//
// Événements §14 : TRIP_CANCELLED (1) + BOOKING_CANCELLED (par réservation,
// payload.reason = TRIP_CANCELLED) + SEAT_RELEASED (par place) +
// TICKET_CANCELLED (par billet) — le SITE AGENCES et le SITE CLIENT
// répercutent l'annulation en temps réel (SSE §3.15 / polling §3.13).
// ============================================================

import { db } from "@/lib/db";
import { emitDomainEvents } from "@/services/domain-events";

export interface TripCancellationSummary {
  cancelledPending: number;
  cancelledConfirmed: number;
  /** Total XAF encaissé NON remboursé (à traiter par l'agence). */
  refundDue: number;
  /** Places libérées (déjà reflétées dans le plan de sièges). */
  freedSeats: number;
}

export async function cancelTripBookingsForCancellation(
  tripId: string,
  actorUserId: string | null
): Promise<TripCancellationSummary> {
  // Réservations actives uniquement (annulées/expirées/complétées : rien à faire).
  const bookings = await db.booking.findMany({
    where: { tripId, status: { in: ["PENDING", "CONFIRMED"] } },
    select: {
      id: true,
      status: true,
      createdById: true,
      ticket: { select: { id: true } },
      payment: { where: { status: "SUCCESS" }, select: { amount: true } },
    },
  });

  // Places à libérer capturées AVANT les transactions (elles suppriment les verrous).
  const occupancies = await db.seatOccupancy.findMany({
    where: { bookingId: { in: bookings.map((b) => b.id) } },
    select: { bookingId: true, seatId: true },
  });
  const seatsByBooking = new Map<string, string[]>();
  for (const o of occupancies) {
    seatsByBooking.set(o.bookingId, [...(seatsByBooking.get(o.bookingId) ?? []), o.seatId]);
  }

  let cancelledPending = 0;
  let cancelledConfirmed = 0;
  let refundDue = 0;
  let freedSeats = 0;

  for (const booking of bookings) {
    const seatIds = seatsByBooking.get(booking.id) ?? [];
    await db.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
      await tx.seatOccupancy.deleteMany({ where: { bookingId: booking.id } });
      if (booking.ticket) {
        await tx.ticket.update({ where: { id: booking.ticket.id }, data: { status: "CANCELLED" } });
      }
      // Paiements volontairement INTACTS (voir en-tête) : SUCCESS reste SUCCESS
      // jusqu'au traitement réel du remboursement par l'agence (§3.16).
    });
    freedSeats += seatIds.length;
    if (booking.status === "CONFIRMED") {
      cancelledConfirmed += 1;
      refundDue += booking.payment.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);
    } else {
      cancelledPending += 1;
    }
  }

  // Événements POST-transaction (fire-and-forget, jamais bloquant).
  await emitDomainEvents([
    {
      type: "TRIP_CANCELLED",
      aggregateType: "Trip",
      aggregateId: tripId,
      tripId,
      payload: { cancelledBookings: cancelledPending + cancelledConfirmed },
    },
    ...bookings.flatMap((b) => [
      {
        type: "BOOKING_CANCELLED" as const,
        aggregateType: "Booking" as const,
        aggregateId: b.id,
        tripId,
        bookingId: b.id,
        payload: { reason: "TRIP_CANCELLED" },
      },
      ...(seatsByBooking.get(b.id) ?? []).map((seatId) => ({
        type: "SEAT_RELEASED" as const,
        aggregateType: "Seat" as const,
        aggregateId: seatId,
        tripId,
        bookingId: b.id,
        payload: { reason: "TRIP_CANCELLED" },
      })),
      ...(b.ticket
        ? [{
            type: "TICKET_CANCELLED" as const,
            aggregateType: "Ticket" as const,
            aggregateId: b.ticket.id,
            tripId,
            bookingId: b.id,
            payload: { reason: "TRIP_CANCELLED" },
          }]
        : []),
    ]),
  ]);

  void actorUserId; // réservé (audit assuré par la route appelante)
  return { cancelledPending, cancelledConfirmed, refundDue, freedSeats };
}
