"use client";

// ============================================================
// useDomainEvents — flux d'événements de domaine (contrat §3.13/§3.15)
//
// Stratégie §15 : le SERVEUR reste la source de vérité. À réception d'un
// événement, le consommateur recharge l'état concerné
// (GET /api/trips/{id}/seats, GET /api/bookings/{id}…) — JAMAIS
// d'application locale des deltas.
//
// Transport :
//   1. SSE (§3.15, EventSource) quand le navigateur le supporte —
//      poussée ~3 s, reconnexion automatique (Last-Event-ID), frame
//      RESYNC à chaque (re)connexion ;
//   2. repli automatique : polling à curseur (§3.13) si EventSource
//      indisponible ou si le flux échoue (proxy sans streaming…).
// ============================================================

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { DomainEventDTO } from "@/types";

/** Événement synthétique envoyé à l'ouverture/fermeture d'un flux SSE. */
export interface ResyncEvent {
  type: "RESYNC";
  at?: string;
}

export type StreamedEvent = DomainEventDTO | ResyncEvent;

export type EventsTransport = "connecting" | "sse" | "polling";

export interface DomainEventsParams {
  tripId?: string;
  bookingId?: string;
  types?: string[];
}

interface UseDomainEventsOptions {
  /** null/undefined = flux inactif (étape sans écoute). */
  params: DomainEventsParams | null;
  /** Appelé pour chaque événement (dont RESYNC) — recharger la vérité serveur. */
  onEvent: (event: StreamedEvent) => void;
  /** Intervalle du repli polling (ms). Défaut : 5 000 (§15). */
  pollMs?: number;
}

/** Construit la query string partagée SSE / polling. */
function buildQuery(params: DomainEventsParams, extra: { since?: string } = {}): string {
  const q = new URLSearchParams();
  if (params.tripId) q.set("tripId", params.tripId);
  if (params.bookingId) q.set("bookingId", params.bookingId);
  if (params.types?.length) q.set("types", params.types.join(","));
  if (extra.since) q.set("since", extra.since);
  return q.toString();
}

export function useDomainEvents({ params, onEvent, pollMs = 5000 }: UseDomainEventsOptions): EventsTransport {
  const [transport, setTransport] = useState<EventsTransport>("connecting");
  // Dernier callback (évite de redémarrer le flux à chaque render) —
  // synchronisé DANS un effet (jamais pendant le rendu).
  const onEventRef = useRef(onEvent);
  const key = params ? JSON.stringify(params) : null;

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!key) return;
    const parsed: DomainEventsParams = JSON.parse(key);

    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cursor: string | undefined;

    const handle = (e: StreamedEvent) => {
      if (cancelled) return;
      if (e.type !== "RESYNC" && "id" in e && e.id) cursor = e.id;
      onEventRef.current(e);
    };

    // ---------- Repli : polling à curseur (§3.13) ----------
    const startPolling = () => {
      if (cancelled || pollTimer) return;
      const poll = async () => {
        pollTimer = null;
        if (!cancelled) setTransport("polling");
        try {
          const res = await api.events.list({ ...parsed, since: cursor });
          if (cancelled) return;
          cursor = res.cursor ?? cursor;
          for (const ev of res.events) handle(ev);
        } catch {
          // réseau ponctuel → la prochaine itération réessaie
        }
        if (!cancelled) pollTimer = setTimeout(poll, pollMs);
      };
      pollTimer = setTimeout(poll, 300);
    };

    // ---------- Transport préféré : SSE (§3.15) ----------
    if (typeof EventSource !== "undefined") {
      try {
        source = new EventSource(`/api/events/client/stream?${buildQuery(parsed)}`);
        // onopen = connexion SSE réellement établie (callback externe —
        // jamais un setState synchrone dans le corps de l'effet).
        source.onopen = () => {
          if (!cancelled) setTransport("sse");
        };
        source.onmessage = (msg) => {
          try {
            handle(JSON.parse(msg.data) as StreamedEvent);
          } catch {
            // frame illisible → ignoré (le RESYNC/reconnexion couvre l'écart)
          }
        };
        source.onerror = () => {
          // readyState CLOSED = reconnect impossible (proxy, 5xx persistants)
          // → bascule définitive vers le polling. Sinon EventSource
          // re-connecte tout seul (Last-Event-ID repris par le serveur).
          if (source && source.readyState === EventSource.CLOSED) {
            source.close();
            source = null;
            startPolling();
          }
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      cancelled = true;
      if (source) {
        source.close();
        source = null;
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };
  }, [key, pollMs]);

  return transport;
}
