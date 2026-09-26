// ============================================================
// OCÉAN DU NORD — Événements de domaine (bus de synchronisation)
// Architecture multi-sites : le SITE AGENCES et le SITE CLIENT
// consomment les MÊMES événements via GET /api/events/client.
//
// Règles :
//  - L'émission est TOUJOURS best-effort : un échec d'écriture
//    d'événement ne fait JAMAIS échouer la mutation métier.
//  - Les payloads ne contiennent JAMAIS de PII (ni téléphone,
//    ni noms) : les événements voyage sont publics (plan de
//    sièges temps réel côté client).
//  - Vocabulaire partagé, documenté dans docs/api-centrale-contract.md
// ============================================================

import { db } from "@/lib/db";

export const DOMAIN_EVENT_TYPES = [
  "SEAT_HELD",
  "SEAT_RELEASED",
  "SEAT_PAID",
  "SEAT_CANCELLED",
  "BOOKING_CREATED",
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "BOOKING_EXPIRED",
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
  "TICKET_CREATED",
  "TICKET_CANCELLED",
  "TICKET_BOARDED",
  "TRIP_CANCELLED",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEventInput {
  type: DomainEventType;
  aggregateType: "Trip" | "Booking" | "Payment" | "Ticket" | "Seat";
  aggregateId: string;
  /** Voyage concerné — permet au SITE CLIENT de rafraîchir un plan de sièges. */
  tripId?: string | null;
  /** Réservation concernée — permet le suivi de commande temps réel. */
  bookingId?: string | null;
  /** Payload JSON-sérialisable, SANS PII. */
  payload?: Record<string, unknown>;
}

/**
 * Émet une ou plusieurs événements de domaine (fire-and-forget).
 * Jamais bloquant : toute erreur est journalisée et avalée.
 */
export async function emitDomainEvents(events: DomainEventInput[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await db.domainEvent.createMany({
      data: events.map((e) => ({
        type: e.type,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        tripId: e.tripId ?? null,
        bookingId: e.bookingId ?? null,
        payload: JSON.stringify(e.payload ?? {}),
      })),
    });
  } catch (err) {
    // Best-effort : l'événement ne doit jamais casser la mutation métier.
    console.error("[domain-events] émission échouée", err);
  }
}

/** Variante mono-événement. */
export async function emitDomainEvent(event: DomainEventInput): Promise<void> {
  await emitDomainEvents([event]);
}
