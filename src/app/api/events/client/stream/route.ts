// GET /api/events/client/stream — contrat API centrale §3.15 (extension
// documentée §24 AVANT usage pour le SITE AGENCES) : variante SSE du flux
// d'événements §3.13.
//
// POURQUOI : le polling à curseur (§3.13) reste la référence fiable sur
// serverless ; le stream SSE réduit la latence (poussée ~3 s) et le nombre
// de requêtes pour les écrans longtemps ouverts (plan de sièges, paiement
// en attente au guichet, suivi de réservation).
//
// MÊME MODÈLE DE SÉCURITÉ que §3.13 : payloads SANS PII, `bookingId`
// imprévisible (cuid ou référence), filtrage serveur. Aucun secret requis.
//
// Format (SSE standard) :
//   retry: 5000                       ← délai de reconnexion conseillé
//   data: {"type":"RESYNC"}           ← envoyé à l'ouverture : le client
//                                       doit recharger la vérité serveur
//   data: {…événement §3.13…}         ← un frame par événement (sans
//                                       champ `event:`, id SSE = id BDD)
//   : ping                            ← heartbeat ~15 s (anti-timeout proxy)
//
// Cycle de vie : le flux se ferme SEUL après STREAM_MAX_MS — le client
// EventSource se reconnecte automatiquement (Last-Event-ID repris comme
// curseur). Le polling §3.13 reste le repli si SSE indisponible.

import { NextRequest } from "next/server";
import { getClientIp, routeError } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import { DOMAIN_EVENT_TYPES, type DomainEventType } from "@/services/domain-events";

/** Durée maximale d'un flux (le client se reconnecte ensuite). */
const STREAM_MAX_MS = 4 * 60_000; // 4 min — EventSource reconnecte tout seul
/** Intervalle de scrutation serveur (latence maximale de poussée). */
const TICK_MS = 3_000;
/** Intervalle des heartbeats (commentaires SSE invisibles pour le client). */
const HEARTBEAT_MS = 15_000;
/** Taille de lot maximale par tick (identique au take §3.13). */
const BATCH = 100;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sseFrame(id: string | null, payload: unknown): Uint8Array {
  const lines = [
    ...(id ? [`id: ${id}`] : []),
    `data: ${JSON.stringify(payload)}`,
    "",
    "",
  ];
  return new TextEncoder().encode(lines.join("\n"));
}

export async function GET(req: NextRequest) {
  try {
    // Limiteur sur la POIGNÉE DE MAIN uniquement (reconnexions ≤ 1 / 4 min
    // par client en usage normal — les frames suivants ne re-passent pas ici).
    enforceRateLimit(`events-stream:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);

    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get("tripId");
    const bookingRef = searchParams.get("bookingId");
    const typesParam = searchParams.get("types");

    // Curseur : header Last-Event-ID (reconnexion EventSource) prioritaire
    // sur ?since= (première ouverture avec état déjà connu).
    const since = req.headers.get("last-event-id") ?? searchParams.get("since");

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
        .filter((t): t is DomainEventType =>
          (DOMAIN_EVENT_TYPES as readonly string[]).includes(t)
        ) ?? undefined;

    // Curseur temporel identique à §3.13 (createdAt de l'ancre).
    let sinceDate: Date | null = null;
    if (since) {
      const anchor = await db.domainEvent.findUnique({ where: { id: since }, select: { createdAt: true } });
      sinceDate = anchor?.createdAt ?? null;
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;

        const close = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // déjà fermé (abort client) — silencieux
          }
        };
        const onAbort = () => close();
        req.signal.addEventListener("abort", onAbort);

        const send = (payload: unknown, id: string | null = null) => {
          if (closed) return;
          try {
            controller.enqueue(sseFrame(id, payload));
          } catch {
            closed = true;
          }
        };

        // En-tête SSE : délai de reconnexion conseillé au client.
        try {
          controller.enqueue(encoder.encode("retry: 5000\n\n"));
        } catch {
          closed = true;
        }
        // RESYNC : après TOUTE (re)connexion, le client recharge la vérité
        // serveur (GET seats / booking) — les deltas manqués pendant la
        // coupure deviennent indifférents (règle §15).
        send({ type: "RESYNC", at: new Date().toISOString() });

        const deadline = Date.now() + STREAM_MAX_MS;
        let lastBeat = Date.now();

        while (!closed && Date.now() < deadline) {
          try {
            const events = await db.domainEvent.findMany({
              where: {
                ...(tripId ? { tripId } : {}),
                ...(bookingId ? { bookingId } : {}),
                ...(types && types.length > 0 ? { type: { in: types } } : {}),
                ...(sinceDate ? { createdAt: { gt: sinceDate } } : {}),
              },
              orderBy: { createdAt: "asc" },
              take: BATCH,
            });
            for (const e of events) {
              send(
                {
                  id: e.id,
                  type: e.type,
                  aggregateType: e.aggregateType,
                  aggregateId: e.aggregateId,
                  tripId: e.tripId,
                  bookingId: e.bookingId,
                  payload: JSON.parse(e.payload) as Record<string, unknown>,
                  createdAt: e.createdAt.toISOString(),
                },
                e.id
              );
              sinceDate = e.createdAt;
            }
          } catch (err) {
            // Best-effort : une erreur DB ponctuelle ne tue pas le flux.
            console.error("[events-stream] tick échoué", err);
          }
          if (closed) break;

          if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            lastBeat = Date.now();
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              break;
            }
          }
          await new Promise((r) => setTimeout(r, TICK_MS));
        }

        req.signal.removeEventListener("abort", onAbort);
        // Fin propre : le client EventSource se reconnecte (son curseur
        // Last-Event-ID = dernier frame `id:` reçu — repris à l'ouverture).
        close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return routeError(err, "GET /api/events/client/stream");
  }
}
