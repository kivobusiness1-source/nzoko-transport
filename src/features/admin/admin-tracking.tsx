"use client";

// ============================================================
// NZOKO TRANSPORT — Onglet admin « Suivi GPS »
// Flotte live : carte Leaflet + liste des sessions, temps réel
// socket.io (repli polling 10 s), trail de la session choisie.
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { Loader2, MapPinned, Radar, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { TRACKING_STATUS_LABELS, DRIVER_STATE_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import type { GpsPointDTO, TrackingFleetDTO, TrackingSessionDTO } from "@/types";

// Leaflet ne doit JAMAIS être évalué côté serveur (accès window à l'import).
const FleetMap = lazy(() => import("@/features/admin/admin-tracking-map"));

interface LiveGpsEvent {
  sessionId: string;
  agencyId: string;
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  recordedAt: string;
}

type RealtimeState = "connecting" | "live" | "polling";

export function AdminTracking() {
  const { data, loading, error, reload } = useApiData<TrackingFleetDTO>(() => api.admin.tracking(), {
    autoRefreshMs: 10_000, // repli polling — le socket prend le relais en live
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ sessionId: string; points: GpsPointDTO[] } | null>(null);
  // État du cycle de vie socket — l'affichage final est DÉRIVÉ : si le service
  // temps réel est désactivé (TRACKING_PUBLIC_SOCKET_URL vide en production),
  // on affiche directement « polling » sans état intermédiaire.
  const [socketState, setSocketState] = useState<"connecting" | "live" | "polling">("connecting");
  // État live maintenu uniquement par les callbacks socket/timer (jamais dans
  // un corps d'effet) : map id → session patchée + horodatage de dernière vue.
  // seenAt sert à l'évicteur TTL (nettoie les sessions « fantômes » si un
  // événement stop était manqué — cf. effet d'éviction plus bas).
  const [liveById, setLiveById] = useState<Record<string, { session: TrackingSessionDTO; seenAt: number }>>({});
  const socketRef = useRef<Socket | null>(null);

  // Fusion au rendu (pure) : polling = base de vérité, sockets = rafraîchissement.
  const sessions = useMemo(() => {
    const map = new Map<string, TrackingSessionDTO>();
    for (const s of data?.sessions ?? []) map.set(s.id, s);
    for (const { session } of Object.values(liveById)) map.set(session.id, session);
    return Array.from(map.values());
  }, [data, liveById]);

  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Temps réel : abonnement signé au salon flotte (repli silencieux → polling).
  const socketEnabled = Boolean(data?.socketToken && data.socketUrl);
  const realtime: RealtimeState = socketEnabled ? socketState : "polling";
  useEffect(() => {
    if (!data?.socketToken || !data.socketUrl) return;
    let disposed = false;
    const socket = io(data.socketUrl, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 3,
      timeout: 5000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit(
        "subscribe-fleet",
        { token: data.socketToken },
        (result: { ok: boolean }) => {
          if (disposed) return;
          setSocketState(result.ok ? "live" : "polling");
        }
      );
    });
    socket.on("disconnect", () => {
      if (!disposed) setSocketState("polling");
    });
    socket.on("connect_error", () => {
      if (!disposed) setSocketState("polling");
    });
    socket.on("gps", (event: LiveGpsEvent) => {
      setLiveById((previous) => {
        const current = sessionsRef.current.find((s) => s.id === event.sessionId);
        if (!current) return previous; // session inconnue → le polling la récupère
        return {
          ...previous,
          [event.sessionId]: {
            session: {
              ...current,
              lastPoint: {
                latitude: event.latitude,
                longitude: event.longitude,
                speed: event.speed ?? null,
                heading: event.heading ?? null,
                recordedAt: event.recordedAt,
              },
            },
            seenAt: Date.now(),
          },
        };
      });
    });
    socket.on("session-started", (session: TrackingSessionDTO) => {
      setLiveById((previous) => ({ ...previous, [session.id]: { session, seenAt: Date.now() } }));
    });
    socket.on("session-updated", (session: TrackingSessionDTO) => {
      setLiveById((previous) => {
        const entry = previous[session.id];
        const current = entry?.session ?? sessionsRef.current.find((s) => s.id === session.id);
        if (!current) return previous;
        return { ...previous, [session.id]: { session: { ...current, status: session.status }, seenAt: Date.now() } };
      });
    });
    socket.on("session-stopped", (session: TrackingSessionDTO) => {
      setLiveById((previous) => {
        const next = { ...previous };
        delete next[session.id];
        return next;
      });
      setSelectedId((current) => (current === session.id ? null : current));
    });

    return () => {
      disposed = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [data?.socketToken, data?.socketUrl]);

  // Évictor TTL : purge les sessions live « fantômes » (événement stop
  // manqué) — on garde une entrée si le polling la connaît encore OU si elle
  // a été vue récemment (< 45 s). Date.now vit dans le callback du timer,
  // jamais pendant le rendu (règle de pureté).
  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveById((previous) => {
        const polled = new Set((dataRef.current?.sessions ?? []).map((s) => s.id));
        let changed = false;
        const next: typeof previous = {};
        for (const [id, entry] of Object.entries(previous)) {
          if (polled.has(id) || Date.now() - entry.seenAt < 45_000) {
            next[id] = entry;
          } else {
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Trail de la session sélectionnée (rechargé périodiquement — les
  // setTrail vivent dans les callbacks async/timer, jamais dans le corps
  // de l'effet).
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await api.admin.tracking(selectedId);
        if (!cancelled) setTrail({ sessionId: selectedId, points: detail.trail ?? [] });
      } catch {
        if (!cancelled) setTrail({ sessionId: selectedId, points: [] });
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  const displayTrail = useMemo(
    () => (trail && trail.sessionId === selectedId ? trail.points : []),
    [trail, selectedId]
  );

  const handleSelect = useCallback((sessionId: string) => {
    setSelectedId((current) => (current === sessionId ? null : sessionId));
  }, []);

  const activeCount = sessions.filter((s) => s.status === "ACTIVE").length;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Chargement du suivi GPS…">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }
  if (error) return <NzokoErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-800">
          <Radar className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {activeCount} car{activeCount > 1 ? "s" : ""} en ligne
        </Badge>
        <Badge variant="outline" className={realtime === "live" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}>
          {realtime === "live" ? "Temps réel" : realtime === "connecting" ? "Connexion…" : "Actualisation 10 s"}
        </Badge>
        <Button variant="outline" size="sm" className="ml-auto min-h-[40px]" onClick={() => { reload(); toast.success("Données GPS actualisées."); }}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Actualiser
        </Button>
      </div>

      {sessions.length === 0 ? (
        <NzokoEmptyState
          icon={MapPinned}
          title="Aucun car suivi pour le moment"
          description="Les sessions démarrent depuis l'espace chauffeur (onglet « Suivi GPS »). Les positions apparaîtront ici en temps réel."
        />
      ) : (
        <>
          <Suspense
            fallback={
              <div className="flex h-[420px] items-center justify-center rounded-xl border" role="status" aria-label="Chargement de la carte…">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              </div>
            }
          >
            <FleetMap
              sessions={sessions}
              selectedId={selectedId}
              onSelect={handleSelect}
              trail={displayTrail.map((p) => [p.latitude, p.longitude] as [number, number])}
            />
          </Suspense>

          {selected && (
            <div className="rounded-xl border bg-card p-4 text-sm shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {selected.driver.firstName} {selected.driver.lastName}
                  {selected.trip ? ` · ${selected.trip.originCityName} → ${selected.trip.destinationCityName}` : " · hors voyage"}
                </p>
                <Badge variant="outline">
                  {TRACKING_STATUS_LABELS[selected.status] ?? selected.status}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.bus ? `Car ${selected.bus.registrationNumber}` : "Car non renseigné"} · {selected.agency.name} ·{" "}
                {selected.pointsCount} points · démarré à {formatDateTime(selected.startedAt)}
                {selected.lastPoint ? ` · dernière position ${formatDateTime(selected.lastPoint.recordedAt)}` : ""}
              </p>
              {selected.driver.phone && (
                <p className="mt-1 text-xs text-muted-foreground">Tél. chauffeur : {selected.driver.phone}</p>
              )}
            </div>
          )}

          <div className="rounded-xl border bg-card shadow-sm">
            <div className="border-b px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Users className="h-4 w-4" aria-hidden="true" />
                Sessions en cours ({sessions.length})
              </h3>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              <ul className="space-y-1">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => handleSelect(s.id)}
                      aria-pressed={s.id === selectedId}
                      className={`flex min-h-[48px] w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        s.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      }`}
                    >
                      <span className="font-medium">
                        {s.driver.firstName} {s.driver.lastName}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {s.trip ? `${s.trip.originCityName} → ${s.trip.destinationCityName}` : "hors voyage"}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {s.lastPoint?.speed !== null && s.lastPoint?.speed !== undefined && (
                          <span className="text-xs text-muted-foreground">{Math.round(s.lastPoint.speed)} km/h</span>
                        )}
                        <Badge
                          variant="outline"
                          className={
                            s.status === "ACTIVE"
                              ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                              : "border-amber-300 bg-amber-100 text-amber-800"
                          }
                        >
                          {TRACKING_STATUS_LABELS[s.status] ?? s.status}
                        </Badge>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            États chauffeur : {Object.values(DRIVER_STATE_LABELS).join(" · ")} — mis à jour au démarrage/arrêt du suivi.
          </p>
        </>
      )}
    </div>
  );
}
