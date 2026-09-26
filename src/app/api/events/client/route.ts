// GET /api/events/client — contrat API centrale §14/§15 : flux d'événements
// pour le SITE CLIENT (rafraîchissement contrôlé).
//
// Mécanisme : POLLING à curseur (léger, fiable sur serverless) — le client
// rappelle avec `since=<id du dernier événement vu>` ; le serveur renvoie
// les événements suivants (ordre chronologique, max 100).
//
// Filtres possibles (combinables) :
//   tripId=...      → événements d'un voyage (plan de sièges temps réel §15)
//   bookingId=...   → suivi d'une réservation (référence ou id)
//   types=A,B       → filtre par types (sous-ensemble du vocabulaire §14)
//
// Sécurité : payloads SANS PII (pas de noms/téléphones) — les événements
// voyage sont publics par conception ; bookingId est imprévisible (cuid).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import { DOMAIN_EVENT_TYPES } from "@/services/domain-events";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`events:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    const { searchParams } = new URL(req.url);
    const since = searchParams.get("since");
    const tripId = searchParams.get("tripId");
    const bookingRef = searchParams.get("bookingId");
    const typesParam = searchParams.get("types");

    // Résolution bookingRef → id (le client ne connaît que la référence).
    let bookingId: string | null = bookingRef;
    if (bookingRef && !bookingRef.startsWith("cm")) {
      const b = await db.booking.findFirst({
        where: { bookingReference: bookingRef.toUpperCase() },
        select: { id: true },
      });
      bookingId = b?.id ?? "___none___"; // référence inconnue → aucun événement
    }

    const types =
      typesParam
        ?.split(",")
        .map((t) => t.trim())
        .filter((t): t is (typeof DOMAIN_EVENT_TYPES)[number] =>
          (DOMAIN_EVENT_TYPES as readonly string[]).includes(t)
        ) ?? undefined;

    // Curseur : l'id est un cuid (ordonnable approximativement) — on utilise
    // createdAt pour la robustesse : tout événement créé après le curseur.
    let sinceDate: Date | null = null;
    if (since) {
      const anchor = await db.domainEvent.findUnique({ where: { id: since }, select: { createdAt: true } });
      sinceDate = anchor?.createdAt ?? null;
    }

    const events = await db.domainEvent.findMany({
      where: {
        ...(tripId ? { tripId } : {}),
        ...(bookingId ? { bookingId } : {}),
        ...(types && types.length > 0 ? { type: { in: types } } : {}),
        ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    return ok({
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        tripId: e.tripId,
        bookingId: e.bookingId,
        payload: JSON.parse(e.payload) as Record<string, unknown>,
        createdAt: e.createdAt.toISOString(),
      })),
      cursor: lastEvent ? lastEvent.id : since,
      hasMore: events.length === 100,
      // Le client rappelle toutes les 3-5 s avec cursor (§15 : le serveur
      // reste la source de vérité — le cache frontend n'est jamais définitif).
      pollAfterMs: 4000,
    });
  } catch (err) {
    return routeError(err, "GET /api/events/client");
  }
}
