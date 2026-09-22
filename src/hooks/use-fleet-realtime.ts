"use client";

// ============================================================
// NZOKO TRANSPORT — Hook temps réel de la flotte (dashboards
// agence/admin). Une seule source d'état : snapshot + journal
// d'événements.
//
//   1. Chargement initial REST : api.tracking.current + events(30)
//   2. Socket.io (passerelle Caddy) : jeton HMAC 60 s demandé à
//      /api/tracking/stream-token AVANT la connexion, renouvelé
//      toutes les 45 s via `renew`.
//        - "bus_location"   → upsert du SEUL bus concerné
//        - "tracking_event" → ajout en tête du journal
//        - "trip_status"    → mise à jour du voyage/bus concerné
//   3. Fallback polling 15 s : realtime=false côté serveur OU
//      socket déconnecté depuis plus de 10 s.
//
// Aucun rechargement global de liste : React ne re-render que la
// tranche modifiée (upsert par busId, prepend d'événement).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api-client";
import { friendlyApiError, type ApiErrorInfo } from "@/components/shared/nzoko-use-api";
import { normalizeSnapshot, withDerivedStats } from "@/features/fleet/fleet-utils";
import type { FleetBusDTO, FleetSnapshotDTO, TrackingEventDTO } from "@/types";

// ---------- Contrat du mini-service tracking-realtime ----------

interface StreamTokenData {
  token: string;
  expiresAt: number;
  agencyIds: string[];
  realtime: boolean;
}

type ServerMessage =
  | { type: "bus_location"; agencyId: string; bus: FleetBusDTO }
  | { type: "tracking_event"; agencyId: string; event: TrackingEventDTO }
  | {
    type: "trip_status";
    agencyId: string;
    tripId: string;
    tripCode: string;
    status: string;
    actualDepartureAt: string | null;
    actualArrivalAt: string | null;
    busLabel: string;
    routeLabel: string;
  };

const MAX_EVENTS = 80; // plafond mémoire du journal côté client
const RENEW_INTERVAL_MS = 45_000; // jeton valable 60 s → renouvellement à 45 s
const DISCONNECT_GRACE_MS = 10_000; // grâce avant bascule en polling
const POLL_INTERVAL_MS = 15_000; // fallback REST

/** GET /api/tracking/stream-token (enveloppe API standard). */
async function fetchStreamToken(agencyId?: string): Promise<StreamTokenData | null> {
  try {
    const qs = agencyId ? `?agencyId=${encodeURIComponent(agencyId)}` : "";
    const res = await fetch(`/api/tracking/stream-token${qs}`, { credentials: "same-origin" });
    const body = (await res.json()) as { success?: boolean; data?: StreamTokenData } | null;
    if (res.ok && body?.success && body.data?.token) return body.data;
    return null;
  } catch {
    return null;
  }
}

/** Rechargement de page anti-boucle (auth_error) : 15 s min entre deux recharges. */
function canReloadAfterAuthError(): boolean {
  try {
    const key = "nzoko-rt-reload-at";
    const prev = window.sessionStorage.getItem(key);
    const now = Date.now();
    if (prev && now - Number(prev) < 15_000) return false;
    window.sessionStorage.setItem(key, String(now));
    return true;
  } catch {
    return true;
  }
}

export interface UseFleetRealtimeResult {
  snapshot: FleetSnapshotDTO | null;
  events: TrackingEventDTO[];
  connected: boolean;
  /** true = le serveur propose le flux socket.io (env configuré). */
  realtime: boolean;
  loading: boolean;
  error: ApiErrorInfo | null;
  reload: () => void;
}

export function useFleetRealtime(
  agencyId?: string,
  opts: { enabled?: boolean } = {},
): UseFleetRealtimeResult {
  const enabled = opts.enabled ?? true;

  const [snapshot, setSnapshot] = useState<FleetSnapshotDTO | null>(null);
  const [events, setEvents] = useState<TrackingEventDTO[]>([]);
  const [connected, setConnected] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [polling, setPolling] = useState(false);

  const agencyIdRef = useRef(agencyId);
  agencyIdRef.current = agencyId;

  // ---------- Traitement d'un message temps réel (upsert ciblé) ----------

  const handleMessage = useCallback((msg: ServerMessage) => {
    if (!msg || typeof msg.type !== "string") return;
    const scopeAgency = agencyIdRef.current;

    if (msg.type === "bus_location") {
      const bus = msg.bus;
      if (!bus?.busId) return;
      // Double garde : le jeton scope déjà les salons, mais le salon global
      // (super admin) peut recevoir toutes les agences — on filtre le select.
      if (scopeAgency && bus.agencyId !== scopeAgency) return;
      setSnapshot((prev) => {
        if (!prev) return prev; // premier chargement REST en cours → ignoré
        const exists = prev.buses.some((b) => b.busId === bus.busId);
        const buses = exists
          ? prev.buses.map((b) => (b.busId === bus.busId ? bus : b))
          : [...prev.buses, bus];
        return withDerivedStats({ ...prev, buses, serverTime: new Date().toISOString() });
      });
      return;
    }

    if (msg.type === "tracking_event") {
      const event = msg.event;
      if (!event?.id) return;
      if (scopeAgency && msg.agencyId !== scopeAgency) return;
      setEvents((prev) => {
        if (prev.some((e) => e.id === event.id)) return prev; // anti-doublon
        return [event, ...prev].slice(0, MAX_EVENTS);
      });
      return;
    }

    if (msg.type === "trip_status") {
      setSnapshot((prev) => {
        if (!prev) return prev;
        const buses = prev.buses.map((b) => {
          if (b.tripId !== msg.tripId) return b;
          const arrived = msg.status === "ARRIVED" || msg.status === "COMPLETED";
          return {
            ...b,
            tripStatus: msg.status,
            state: arrived ? ("ARRIVED" as const) : b.state,
            stateLabel: arrived ? "Arrivé" : b.stateLabel,
          };
        });
        return withDerivedStats({ ...prev, buses });
      });
    }
  }, []);

  // ---------- Chargement initial (REST) + rechargement manuel ----------

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.tracking.current(agencyId ? { agencyId } : undefined),
      api.tracking.events(agencyId ? { agencyId, limit: 30 } : { limit: 30 }),
    ])
      .then(([snap, evts]) => {
        if (cancelled) return;
        setSnapshot(normalizeSnapshot(snap));
        setEvents(evts);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, agencyId, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // ---------- Connexion socket.io (jeton HMAC + renouvellement) ----------

  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: Socket | null = null;
    let renewTimer: ReturnType<typeof setInterval> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const schedulePollingAfterGrace = () => {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = setTimeout(() => {
        if (!socket?.connected) setPolling(true);
      }, DISCONNECT_GRACE_MS);
    };

    const connect = async () => {
      const data = await fetchStreamToken(agencyId);
      if (disposed) return;
      if (!data || !data.realtime) {
        // Serveur sans flux temps réel (env non configuré) → polling direct.
        setRealtime(false);
        setPolling(true);
        return;
      }
      setRealtime(true);

      // Connexion OBLIGATOIRE via la passerelle Caddy : jamais d'URL absolue
      // ni de port direct — le path est TOUJOURS "/" et le port transite par
      // le paramètre de requête XTransformPort.
      socket = io("/?XTransformPort=3005", {
        auth: { token: data.token },
        transports: ["websocket", "polling"],
        reconnection: true,
        forceNew: true,
        timeout: 15_000,
      });

      socket.on("connect", () => {
        setConnected(true);
        setPolling(false);
        if (graceTimer) clearTimeout(graceTimer);
      });
      socket.on("disconnect", () => {
        setConnected(false);
        schedulePollingAfterGrace();
      });
      socket.on("connect_error", () => {
        // La reconnexion est gérée par socket.io ; la grâce polling couvre
        // les coupures longues.
        schedulePollingAfterGrace();
      });
      socket.on("auth_error", () => {
        // Jeton invalide/expiré : le plus sûr est de recharger la page pour
        // redemander un jeton fraîchement signé (garde anti-boucle).
        if (canReloadAfterAuthError()) {
          window.location.reload();
        } else {
          socket?.disconnect();
          setRealtime(false);
          setPolling(true);
        }
      });
      socket.on("message", (msg: ServerMessage) => handleMessageRef.current(msg));

      // Renouvellement du jeton (60 s de validité) toutes les ~45 s.
      renewTimer = setInterval(async () => {
        const fresh = await fetchStreamToken(agencyIdRef.current);
        if (!disposed && fresh?.token && socket?.connected) {
          socket.emit("renew", { token: fresh.token });
        }
      }, RENEW_INTERVAL_MS);
    };

    void connect();

    return () => {
      disposed = true;
      if (renewTimer) clearInterval(renewTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      setConnected(false);
      setPolling(false);
    };
  }, [enabled, agencyId]);

  // ---------- Fallback polling (15 s sur api.tracking.current) ----------

  useEffect(() => {
    if (!enabled || !polling) return;
    let stopped = false;
    let ticks = 0;
    const poll = async () => {
      try {
        const snap = await api.tracking.current(agencyId ? { agencyId } : undefined);
        if (!stopped) setSnapshot(normalizeSnapshot(snap));
      } catch {
        // silencieux : le polling retentera au tick suivant
      }
      // Journal rafraîchi plus rarement (1 fois / 4 ticks ≈ 60 s).
      if (++ticks % 4 === 0) {
        try {
          const evts = await api.tracking.events(agencyId ? { agencyId, limit: 30 } : { limit: 30 });
          if (!stopped) setEvents(evts);
        } catch {
          // silencieux
        }
      }
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, polling, agencyId]);

  return { snapshot, events, connected, realtime, loading, error, reload };
}
