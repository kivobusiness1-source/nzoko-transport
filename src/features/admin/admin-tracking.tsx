"use client";

// ============================================================
// NZOKO TRANSPORT — Onglet admin « Suivi GPS » V4
// Flotte live : barre KPI par état GPS, filtres persistants
// (agence / état / ligne), carte Leaflet multi-couches (tuiles
// depuis la config serveur), panneau détail bus (exigence 24),
// replay du trail (exigence 32), liste des sessions enrichie.
// Temps réel socket.io (repli polling 10 s) : gps,
// session-started/updated/stopped et bus-arrived.
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import {
  BatteryMedium,
  Eye,
  EyeOff,
  ExternalLink,
  Gauge,
  History,
  Loader2,
  MapPinned,
  Navigation,
  Phone,
  Radar,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { DRIVER_STATE_LABELS, TRACKING_STATUS_LABELS } from "@/lib/constants";
import { formatTime } from "@/lib/format";
import { GPS_MAP, GPS_SERVER } from "@/lib/gps-config";
import { deriveBusStatus, haversineMeters, humanDistance } from "@/lib/geo";
import type { FleetMapSnapshot, FleetReplayPoint } from "@/features/admin/admin-tracking-map";
import {
  BusStatusBadge,
  busStatusOf,
  DelayBadge,
  deriveFleetKpi,
  GpsStatusBadge,
  headingLabel,
  routeKeyOf,
  trackingEventEmoji,
  TRACKING_EVENT_LABELS,
  TripPhaseBadge,
} from "@/features/admin/admin-tracking-shared";
import {
  AdminTrackingFilters,
  AGENCY_FILTER_ALL,
  DRIVER_FILTER_ALL,
  ROUTE_FILTER_ALL,
  STATUS_FILTER_ALL,
  type AgencyFilterOption,
  type DriverFilterOption,
  type MapLayersState,
  type RouteFilterOption,
  type StatusFilterValue,
} from "@/features/admin/admin-tracking-filters";
import { AdminTrackingReplay, type ReplaySpeed } from "@/features/admin/admin-tracking-replay";
import type {
  GpsPointDTO,
  MapCityDTO,
  MapPublicDTO,
  TrackingConfigDTO,
  TrackingEventItemDTO,
  TrackingFleetDTO,
  TrackingSessionDTO,
} from "@/types";

// Leaflet ne doit JAMAIS être évalué côté serveur (accès window à l'import).
const FleetMap = lazy(() => import("@/features/admin/admin-tracking-map"));

/** Événement socket « gps » (position live d'un bus) — V5 : payload enrichi
 *  (busId, tripId, tripPhase, accuracy, batteryLevel voyagent désormais). */
interface LiveGpsEvent {
  sessionId: string;
  agencyId: string;
  busId?: string | null;
  tripId?: string | null;
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  batteryLevel?: number | null;
  tripPhase?: string | null;
  recordedAt: string;
}

/** Événement socket « tracking-event » V5 (alerte temps réel §35). */
interface LiveTrackingEvent {
  type: string;
  severity: string;
  sessionId: string | null;
  tripId: string | null;
  busId: string | null;
  agencyId: string | null;
  message: string | null;
  at: string;
}

/** Événement socket « bus-arrived » (détection d'arrivée côté serveur). */
interface BusArrivedEvent {
  sessionId: string;
  tripId: string;
  routeLabel: string;
  at: string;
}

/** État du replay (un seul à la fois, rattaché à la session sélectionnée). */
interface ReplayState {
  sessionId: string;
  index: number;
  playing: boolean;
  speed: ReplaySpeed;
}

/** « il y a X s » → secondes, puis minutes, puis heures. */
function secondsAgoLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.floor(minutes / 60)} h`;
}

/** Clé de ligne d'une session (origin → destination), null hors voyage. */
function sessionRouteKey(session: TrackingSessionDTO): string | null {
  return session.trip
    ? routeKeyOf(session.trip.originCityName, session.trip.destinationCityName)
    : null;
}

/** Puce KPI colorée par état GPS. */
function KpiChip({ label, value, dotClassName }: { label: string; value: number; dotClassName: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 bg-card">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClassName}`} aria-hidden="true" />
      {label} : {value}
    </Badge>
  );
}

/** Ligne d'information du panneau détail bus. */
function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}

// ============================================================
// V5 — Panneau d'alertes (§35) : événements WARN/CRITICAL du serveur
// + événements temps réel reçus par socket, dédupliqués par clé
// type:sessionId:at. Repliable, jamais bloquant.
// ============================================================
interface AlertsPanelProps {
  serverEvents: TrackingEventItemDTO[];
  liveAlerts: TrackingEventItemDTO[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nowMs: number | null;
}

function AlertsPanel({ serverEvents, liveAlerts, open, onOpenChange, nowMs }: AlertsPanelProps) {
  // Fusion : alertes live en tête (les plus fraîches), puis serveur — sans doublon.
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: TrackingEventItemDTO[] = [];
    for (const e of [liveAlerts, serverEvents].flat()) {
      const key = `${e.type}:${e.sessionId ?? "-"}:${e.createdAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out.slice(0, 60);
  }, [serverEvents, liveAlerts]);

  const criticalCount = merged.filter((e) => e.severity === "CRITICAL").length;

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="tracking-alerts-body"
        className="flex min-h-[48px] w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span aria-hidden>⚠️</span>
          Alertes de la flotte
          {merged.length > 0 && (
            <Badge variant="outline" className={criticalCount > 0 ? "border-red-300 bg-red-100 text-red-700" : "border-amber-300 bg-amber-100 text-amber-800"}>
              {merged.length}
            </Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Masquer" : "Afficher"}</span>
      </button>
      {open && (
        <div id="tracking-alerts-body" className="nzoko-scroll max-h-96 overflow-y-auto border-t p-2" role="region" aria-label="Alertes récentes">
          {merged.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Aucune alerte — la flotte roule sans incident signalé.
            </p>
          ) : (
            <ul className="space-y-1">
              {merged.map((e) => {
                const critical = e.severity === "CRITICAL";
                return (
                  <li
                    key={e.id}
                    className={`flex min-h-[44px] items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                      critical ? "bg-red-50 dark:bg-red-950/30" : "bg-amber-50 dark:bg-amber-950/30"
                    }`}
                  >
                    <span className="mt-0.5 shrink-0" aria-hidden>{trackingEventEmoji(e.type)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{TRACKING_EVENT_LABELS[e.type] ?? e.type}</span>
                      {e.message ? <span className="ml-1.5 text-muted-foreground">— {e.message}</span> : null}
                      <span className="block text-[11px] text-muted-foreground">
                        {nowMs !== null ? secondsAgoLabel(nowMs - new Date(e.createdAt).getTime()) : formatTime(e.createdAt)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminTracking() {
  const { data, loading, error, reload } = useApiData<TrackingFleetDTO>(() => api.admin.tracking(), {
    autoRefreshMs: 10_000, // repli polling — le socket prend le relais en live
  });

  // Configuration GPS serveur (tuiles de carte + seuils de dérivation).
  const { data: trackingConfig } = useApiData<TrackingConfigDTO>(() => api.tracking.config());
  // Carte publique (agences, arrêts, tracés de lignes) — une seule fois.
  const { data: mapData } = useApiData<MapPublicDTO>(() => api.mapPublic());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ sessionId: string; points: GpsPointDTO[] } | null>(null);
  const [showTrail, setShowTrail] = useState(false);
  const [replay, setReplay] = useState<ReplayState | null>(null);

  // Filtres persistants pendant la session d'affichage (état React local).
  const [agencyFilter, setAgencyFilter] = useState<string>(AGENCY_FILTER_ALL);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(STATUS_FILTER_ALL);
  const [routeFilter, setRouteFilter] = useState<string>(ROUTE_FILTER_ALL);
  // V5 (§18) — filtre chauffeur.
  const [driverFilter, setDriverFilter] = useState<string>(DRIVER_FILTER_ALL);
  // V5 (§35) — panneau d'alertes : événements temps réel reçus par socket
  // (en tête, dédupliqués, NORMALISÉS en TrackingEventItemDTO) ; la base
  // reste data.events (polling 10 s).
  const [liveAlerts, setLiveAlerts] = useState<TrackingEventItemDTO[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // V5 (§44) — événements de la session sélectionnée (mode détail).
  const [sessionEvents, setSessionEvents] = useState<{ sessionId: string; events: TrackingEventItemDTO[] } | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  // Couches de la carte : bus + agences visibles par défaut, arrêts et
  // tracés masqués par défaut (exigence 16).
  const [layers, setLayers] = useState<MapLayersState>({ buses: true, agencies: true, stops: false, routes: false });

  // État du cycle de vie socket — l'affichage final est DÉRIVÉ : si le service
  // temps réel est désactivé, on affiche directement « polling ».
  const [socketState, setSocketState] = useState<"connecting" | "live" | "polling">("connecting");
  // État live maintenu uniquement par les callbacks socket/timer (jamais dans
  // un corps d'effet) : map id → session patchée + horodatage de dernière vue.
  const [liveById, setLiveById] = useState<Record<string, { session: TrackingSessionDTO; seenAt: number }>>({});
  const socketRef = useRef<Socket | null>(null);
  // Sélection courante lue par les callbacks socket (sans closure périmée).
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Changement de sélection (clic carte/liste, arrêt de session) : affichage
  // repartant de zéro — trail masqué, replay arrêté (un seul replay à la fois,
  // exigence 32). Réinitialisé DANS les gestionnaires d'événements (pas d'effet
  // synchronisé qui mettrait l'état en cascade).
  const applySelection = useCallback((sessionId: string | null) => {
    setSelectedId(sessionId);
    setReplay(null);
    setShowTrail(false);
  }, []);

  // Horloge d'affichage (rafraîchie toutes les 5 s) pour « il y a X s » —
  // Date.now vit uniquement dans les callbacks de timer, jamais au rendu
   // (l'amorçage passe par un setTimeout : pas de setState synchrone d'effet).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowMs(Date.now());
    const bootstrap = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 5_000);
    return () => {
      window.clearTimeout(bootstrap);
      window.clearInterval(timer);
    };
  }, []);

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

  // Références lues par les handlers socket (sans reconnexion à chaque poll).
  const citiesRef = useRef<MapCityDTO[]>([]);
  useEffect(() => {
    citiesRef.current = mapData?.cities ?? [];
  }, [mapData]);
  const thresholdsRef = useRef({
    offlineThresholdMs: GPS_SERVER.offlineThresholdMs,
    stoppedSpeedKmh: GPS_SERVER.stoppedSpeedKmh,
  });
  useEffect(() => {
    if (trackingConfig) {
      thresholdsRef.current = {
        offlineThresholdMs: trackingConfig.offlineThresholdMs,
        stoppedSpeedKmh: trackingConfig.stoppedSpeedKmh,
      };
    }
  }, [trackingConfig]);

  // Instantané de configuration carte — SEULE source légitime des tuiles ;
  // repli sur les constantes locales si l'endpoint config est indisponible.
  const mapConfig = useMemo<FleetMapSnapshot>(
    () => ({
      tileUrl: trackingConfig?.map.tileUrl ?? GPS_MAP.tileUrl,
      attribution: trackingConfig?.map.attribution ?? GPS_MAP.attribution,
      defaultLat: trackingConfig?.map.defaultLat ?? GPS_MAP.defaultLat,
      defaultLng: trackingConfig?.map.defaultLng ?? GPS_MAP.defaultLng,
    }),
    [trackingConfig]
  );

  // Rapprochement session ↔ ligne de la carte publique (par paire de villes).
  const routeIdByPair = useMemo(() => {
    const map = new Map<string, string>();
    for (const route of mapData?.routes ?? []) {
      const key = routeKeyOf(route.originCityName, route.destinationCityName);
      if (!map.has(key)) map.set(key, route.id); // première ligne si paires multiples
    }
    return map;
  }, [mapData]);

  // Clé de ligne visée par le filtre (null = toutes les lignes).
  const filterRouteKey = useMemo(() => {
    if (routeFilter === ROUTE_FILTER_ALL) return null;
    const route = (mapData?.routes ?? []).find((r) => r.id === routeFilter);
    return route
      ? routeKeyOf(route.originCityName, route.destinationCityName)
      : routeFilter; // repli sessions : l'identifiant est déjà une clé de paire
  }, [routeFilter, mapData]);

  // Sessions filtrées (marqueurs + liste + cadrage).
  const filteredSessions = useMemo(
    () =>
      sessions.filter((s) => {
        if (agencyFilter !== AGENCY_FILTER_ALL && s.agency.id !== agencyFilter) return false;
        if (statusFilter !== STATUS_FILTER_ALL && busStatusOf(s) !== statusFilter) return false;
        if (filterRouteKey && sessionRouteKey(s) !== filterRouteKey) return false;
        // V5 (§18) — filtre chauffeur.
        if (driverFilter !== DRIVER_FILTER_ALL && s.driver.id !== driverFilter) return false;
        return true;
      }),
    [sessions, agencyFilter, statusFilter, filterRouteKey, driverFilter]
  );

  // KPI : base serveur puis re-déduction locale des sessions fusionnées
  // (polling + correctifs temps réel) — exactitude entre polls documentée :
  // un état OFFLINE/STOPPED peut être frôlé quelques secondes, le poll 10 s
  // ré-affirme la vérité serveur.
  const kpi = useMemo(() => deriveFleetKpi(sessions, data?.kpi), [sessions, data?.kpi]);

  // Options des filtres (repli sur les sessions si carte publique absente).
  const agencyOptions = useMemo<AgencyFilterOption[]>(() => {
    if (mapData?.agencies.length) return mapData.agencies;
    const seen = new Map<string, AgencyFilterOption>();
    for (const s of sessions) if (!seen.has(s.agency.id)) seen.set(s.agency.id, s.agency);
    return Array.from(seen.values());
  }, [mapData, sessions]);
  const routeOptions = useMemo<RouteFilterOption[]>(() => {
    if (mapData?.routes.length) return mapData.routes;
    const seen = new Map<string, RouteFilterOption>();
    for (const s of sessions) {
      const key = sessionRouteKey(s);
      if (key && s.trip && !seen.has(key)) {
        seen.set(key, {
          id: key,
          code: s.trip.code,
          originCityName: s.trip.originCityName,
          destinationCityName: s.trip.destinationCityName,
        });
      }
    }
    return Array.from(seen.values());
  }, [mapData, sessions]);

  // V5 (§18) — options du filtre chauffeur (déduites des sessions vivantes).
  const driverOptions = useMemo<DriverFilterOption[]>(() => {
    const seen = new Map<string, DriverFilterOption>();
    for (const s of sessions) {
      if (!seen.has(s.driver.id)) {
        seen.set(s.driver.id, { id: s.driver.id, name: `${s.driver.firstName} ${s.driver.lastName}` });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [sessions]);

  const hasActiveFilters =
    agencyFilter !== AGENCY_FILTER_ALL || statusFilter !== STATUS_FILTER_ALL || routeFilter !== ROUTE_FILTER_ALL || driverFilter !== DRIVER_FILTER_ALL;
  const resetFilters = useCallback(() => {
    setAgencyFilter(AGENCY_FILTER_ALL);
    setStatusFilter(STATUS_FILTER_ALL);
    setRouteFilter(ROUTE_FILTER_ALL);
    setDriverFilter(DRIVER_FILTER_ALL);
  }, []);
  const handleLayerToggle = useCallback((layer: keyof MapLayersState) => {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  }, []);

  // Couches filtrées pour la carte.
  const visibleAgencies = useMemo(() => {
    const all = mapData?.agencies ?? [];
    if (agencyFilter === AGENCY_FILTER_ALL) return all;
    return all.filter((a) => a.id === agencyFilter);
  }, [mapData, agencyFilter]);
  const visibleRoutes = useMemo(() => {
    const all = mapData?.routes ?? [];
    if (!filterRouteKey) return all;
    return all.filter((r) => routeKeyOf(r.originCityName, r.destinationCityName) === filterRouteKey);
  }, [mapData, filterRouteKey]);

  // Temps réel : abonnement signé au salon flotte (repli silencieux → polling).
  const socketEnabled = Boolean(data?.socketToken && data.socketUrl);
  const realtime = socketEnabled ? socketState : "polling";
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
        // État GPS re-dérivé localement (règles @/lib/geo, seuils serveur) :
        // une ARRIVÉE déjà prononcée reste définitive.
        const status = deriveBusStatus({
          speedKmh: event.speed ?? null,
          lastPointAt: new Date(event.recordedAt),
          offlineThresholdMs: thresholdsRef.current.offlineThresholdMs,
          stoppedSpeedKmh: thresholdsRef.current.stoppedSpeedKmh,
          tripArrived: current.busStatus === "ARRIVED",
        });
        // Distance restante recalculée au vol si la destination est cartographiée.
        let distance = current.distanceToDestinationM ?? null;
        const destinationName = current.trip?.destinationCityName;
        if (destinationName) {
          const destination = citiesRef.current.find((c) => c.name === destinationName);
          if (destination) {
            distance = Math.round(
              haversineMeters(
                { latitude: event.latitude, longitude: event.longitude },
                { latitude: destination.latitude, longitude: destination.longitude }
              )
            );
          }
        }
        // V5 : une position fraîche est la preuve d'un GPS actif ; la phase
        // technique voyagent désormais dans l'événement (sinon conservée).
        return {
          ...previous,
          [event.sessionId]: {
            session: {
              ...current,
              busStatus: status,
              distanceToDestinationM: distance,
              gpsStatus: current.gpsStatus === "TERMINATED" ? current.gpsStatus : "GPS_ACTIVE",
              tripPhase: (event.tripPhase as TrackingSessionDTO["tripPhase"]) ?? current.tripPhase,
              lastSignalAt: event.recordedAt,
              lastPoint: {
                latitude: event.latitude,
                longitude: event.longitude,
                speed: event.speed ?? null,
                heading: event.heading ?? null,
                // V5 : précision et batterie voyagent désormais dans l'événement
                // (repli sur les dernières valeurs connues sinon).
                accuracy: event.accuracy ?? current.lastPoint?.accuracy ?? null,
                batteryLevel: event.batteryLevel ?? current.lastPoint?.batteryLevel ?? null,
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
        return {
          ...previous,
          [session.id]: {
            session: {
              ...current,
              status: session.status,
              busStatus: session.busStatus ?? current.busStatus,
            },
            seenAt: Date.now(),
          },
        };
      });
    });
    socket.on("session-stopped", (session: TrackingSessionDTO) => {
      setLiveById((previous) => {
        const next = { ...previous };
        delete next[session.id];
        return next;
      });
      if (selectedIdRef.current === session.id) applySelection(null);
    });

    // Arrivée détectée côté serveur (exigence 17) : toast admin + refresh.
    socket.on("bus-arrived", (event: BusArrivedEvent) => {
      toast.success(`🚌 Arrivée détectée : ${event.routeLabel}`);
      setLiveById((previous) => {
        const entry = previous[event.sessionId];
        const current = entry?.session ?? sessionsRef.current.find((s) => s.id === event.sessionId);
        if (!current) return previous; // le refresh immédiat la récupérera
        return { ...previous, [event.sessionId]: { session: { ...current, busStatus: "ARRIVED" }, seenAt: Date.now() } };
      });
      reload();
    });

    // V5 (§35) — événements d'alerte temps réel : head de liste dédupliqué
    // (clé type+sessionId+at), plafonné à 50 entrées locales.
    socket.on("tracking-event", (event: LiveTrackingEvent) => {
      const key = `${event.type}:${event.sessionId ?? "-"}:${event.at}`;
      const normalized: TrackingEventItemDTO = {
        id: `live:${key}`,
        type: event.type,
        severity: event.severity,
        message: event.message,
        sessionId: event.sessionId,
        tripId: event.tripId,
        busId: event.busId,
        driverId: null,
        agencyId: event.agencyId,
        payload: null,
        createdAt: event.at,
      };
      setLiveAlerts((previous) => {
        if (previous.some((e) => e.id === normalized.id)) return previous;
        return [normalized, ...previous].slice(0, 50);
      });
    });

    return () => {
      disposed = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [data?.socketToken, data?.socketUrl, reload, applySelection]);

  // Évictor TTL : purge les sessions live « fantômes » (événement stop
  // manqué) — on garde une entrée si le polling la connaît encore OU si elle
  // a été vue récemment (< 45 s).
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

  // Trail de la session sélectionnée (rechargé périodiquement — sert au
  // tracé ET au replay ; les setTrail vivent dans les callbacks async/timer).
  // V5 : la même réponse détail fournit les ÉVÉNEMENTS de la session (§44).
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const detail = await api.admin.tracking(selectedId);
        if (!cancelled) {
          setTrail({ sessionId: selectedId, points: detail.trail ?? [] });
          setSessionEvents({ sessionId: selectedId, events: detail.events ?? [] });
        }
      } catch {
        if (!cancelled) {
          setTrail({ sessionId: selectedId, points: [] });
          setSessionEvents({ sessionId: selectedId, events: [] });
        }
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
  const displayEvents = useMemo(
    () => (sessionEvents && sessionEvents.sessionId === selectedId ? sessionEvents.events : []),
    [sessionEvents, selectedId]
  );

  // ----- Replay (exigence 32) : lecture pas-à-pas (~400 ms / point) -----
  const replayActive = replay !== null && replay.sessionId === selectedId;
  const replayPoints = replayActive ? displayTrail : [];

  useEffect(() => {
    if (!replay?.playing) return;
    const stepMs = Math.max(80, Math.round(400 / replay.speed));
    const timer = window.setInterval(() => {
      setReplay((current) => {
        if (!current) return current;
        if (current.index >= replayPoints.length - 1) {
          return { ...current, playing: false }; // fin du trail → pause en bout
        }
        return { ...current, index: current.index + 1 };
      });
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [replay?.playing, replay?.speed, replayPoints.length]);

  const startReplay = useCallback(() => {
    if (!selectedId) return;
    setShowTrail(true); // le trail complet reste affiché pendant le replay
    setReplay({ sessionId: selectedId, index: 0, playing: true, speed: 1 });
  }, [selectedId]);
  const stopReplay = useCallback(() => setReplay(null), []);
  const toggleReplayPlay = useCallback(() => {
    setReplay((current) => {
      if (!current) return current;
      if (current.index >= replayPoints.length - 1) {
        return { ...current, index: 0, playing: true }; // relance depuis le début
      }
      return { ...current, playing: !current.playing };
    });
  }, [replayPoints.length]);
  const seekReplay = useCallback(
    (index: number) => {
      setReplay((current) =>
        current
          ? { ...current, index: Math.min(Math.max(index, 0), Math.max(replayPoints.length - 1, 0)), playing: false }
          : current
      );
    },
    [replayPoints.length]
  );
  const changeReplaySpeed = useCallback((speed: ReplaySpeed) => {
    setReplay((current) => (current ? { ...current, speed } : current));
  }, []);

  const replayPoint = useMemo<FleetReplayPoint | null>(() => {
    if (!replay || replay.sessionId !== selectedId) return null;
    const point = displayTrail[replay.index];
    if (!point) return null;
    return { latitude: point.latitude, longitude: point.longitude, heading: point.heading ?? null };
  }, [replay, selectedId, displayTrail]);

  // Trail affiché : bouton « Voir le trajet » OU replay actif.
  const trailVisible = showTrail || replayActive;
  const trailLatLngs = useMemo(
    () => (trailVisible ? displayTrail.map((p) => [p.latitude, p.longitude] as [number, number]) : []),
    [trailVisible, displayTrail]
  );

  const handleSelect = useCallback(
    (sessionId: string) => {
      applySelection(selectedIdRef.current === sessionId ? null : sessionId);
    },
    [applySelection]
  );

  const selected = filteredSessions.find((s) => s.id === selectedId) ?? null;
  const highlightRouteId = useMemo(() => {
    if (!selected) return null;
    const key = sessionRouteKey(selected);
    return key ? (routeIdByPair.get(key) ?? null) : null;
  }, [selected, routeIdByPair]);

  // Lien externe OpenStreetMap : itinéraire position bus → destination
  // officielle si elle est cartographiée, sinon simple vue de la position.
  const osmUrl = useMemo(() => {
    if (!selected?.lastPoint) return null;
    const destinationName = selected.trip?.destinationCityName;
    const destination = destinationName
      ? (mapData?.cities ?? []).find((c) => c.name === destinationName)
      : undefined;
    const from = `${selected.lastPoint.latitude.toFixed(5)},${selected.lastPoint.longitude.toFixed(5)}`;
    if (destination) {
      const to = `${destination.latitude},${destination.longitude}`;
      return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${from};${to}`)}`;
    }
    return `https://www.openstreetmap.org/#map=15/${selected.lastPoint.latitude.toFixed(5)}/${selected.lastPoint.longitude.toFixed(5)}`;
  }, [selected, mapData]);

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
      {/* --- Barre KPI par état GPS (exigence 4 + §43 V5) --- */}
      <div className="flex flex-wrap items-center gap-2">
        <KpiChip label="Bus en ligne" value={kpi.total} dotClassName="bg-primary" />
        <KpiChip label="En mouvement" value={kpi.moving} dotClassName="bg-emerald-600" />
        <KpiChip label="Arrêtés" value={kpi.stopped} dotClassName="bg-amber-600" />
        <KpiChip label="Hors ligne" value={kpi.offline} dotClassName="bg-gray-500" />
        {(kpi.delayed ?? 0) > 0 && <KpiChip label="En retard" value={kpi.delayed ?? 0} dotClassName="bg-red-600" />}
        {(kpi.stale ?? 0) > 0 && <KpiChip label="GPS silencieux" value={kpi.stale ?? 0} dotClassName="bg-amber-400" />}
        <KpiChip label="Arrivés" value={kpi.arrived} dotClassName="bg-teal-600" />
        {kpi.paused > 0 && <KpiChip label="En pause" value={kpi.paused} dotClassName="bg-slate-400" />}
        <Badge
          variant="outline"
          className={realtime === "live" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}
        >
          <Radar className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {realtime === "live" ? "Temps réel" : realtime === "connecting" ? "Connexion…" : "Actualisation 10 s"}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto min-h-[40px]"
          onClick={() => {
            reload();
            toast.success("Données GPS actualisées.");
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Actualiser
        </Button>
      </div>

      {/* --- Filtres + légende des couches (exigences 5-6 + §18 V5) --- */}
      <AdminTrackingFilters
        agencies={agencyOptions}
        routes={routeOptions}
        drivers={driverOptions}
        agencyFilter={agencyFilter}
        statusFilter={statusFilter}
        routeFilter={routeFilter}
        driverFilter={driverFilter}
        onAgencyFilterChange={setAgencyFilter}
        onStatusFilterChange={setStatusFilter}
        onRouteFilterChange={setRouteFilter}
        onDriverFilterChange={setDriverFilter}
        layers={layers}
        onLayerToggle={handleLayerToggle}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
      />

      {/* --- Panneau d'alertes V5 (§35) : événements WARN/CRITICAL --- */}
      <AlertsPanel
        serverEvents={data?.events ?? []}
        liveAlerts={liveAlerts}
        open={alertsOpen}
        onOpenChange={setAlertsOpen}
        nowMs={nowMs}
      />

      {/* --- Carte multi-couches (exigences 14, 16-17, 22-23) --- */}
      <Suspense
        fallback={
          <div
            className="flex h-[300px] items-center justify-center rounded-xl border sm:h-[420px]"
            role="status"
            aria-label="Chargement de la carte…"
          >
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          </div>
        }
      >
        <FleetMap
          sessions={filteredSessions}
          selectedId={selectedId}
          onSelect={handleSelect}
          trail={trailLatLngs}
          snapshot={mapConfig}
          layers={layers}
          agencies={visibleAgencies}
          cities={mapData?.cities ?? []}
          routes={visibleRoutes}
          highlightRouteId={highlightRouteId}
          replay={replayPoint}
        />
      </Suspense>

      {/* --- Panneau détail bus (exigence 24 + §15/§44 V5) --- */}
      {selected && (
        <div className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {selected.driver.firstName} {selected.driver.lastName}
              {selected.trip ? ` · ${selected.trip.originCityName} → ${selected.trip.destinationCityName}` : " · hors voyage"}
            </p>
            <span className="flex flex-wrap items-center gap-2">
              {/* V5 (§11/§22) — état GPS technique + phase du trajet. */}
              <GpsStatusBadge status={selected.gpsStatus} />
              <TripPhaseBadge phase={selected.tripPhase} />
              <BusStatusBadge status={busStatusOf(selected)} />
              {selected.status === "PAUSED" && (
                <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-700">
                  {TRACKING_STATUS_LABELS[selected.status]}
                </Badge>
              )}
            </span>
          </div>

          {/* V5 (§15) — bloc « prochain arrêt » : arrêt, distance, ETA, retard. */}
          {selected.trip && selected.nextStop && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prochain arrêt</p>
                <p className="truncate font-semibold">📍 {selected.nextStop.name}</p>
                {selected.nextStop.distanceM != null && (
                  <p className="text-xs text-muted-foreground">
                    {humanDistance(selected.nextStop.distanceM)}
                    {selected.nextStop.etaIso ? ` · arrivée estimée ${formatTime(selected.nextStop.etaIso)}` : ""}
                  </p>
                )}
              </div>
              <DelayBadge delay={selected.nextStop} />
            </div>
          )}
          {/* V5 (§20) — arrêt en cours (géofence confirmée). */}
          {selected.tripPhase === "AT_STOP" && selected.geofenceStopName && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" role="status">
              🛑 Arrêt en cours : {selected.geofenceStopName}
            </p>
          )}

          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem
              label="Vitesse"
              value={
                selected.lastPoint?.speed != null ? (
                  <span className="flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {Math.round(selected.lastPoint.speed)} km/h
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              label="Cap / direction"
              value={
                selected.lastPoint?.heading != null ? (
                  <span className="flex items-center gap-1">
                    <Navigation
                      className="h-3.5 w-3.5 text-muted-foreground"
                      style={{ transform: `rotate(${selected.lastPoint.heading}deg)` }}
                      aria-hidden="true"
                    />
                    {Math.round(selected.lastPoint.heading)}° ({headingLabel(selected.lastPoint.heading)})
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              label="Position"
              value={
                selected.lastPoint
                  ? `${selected.lastPoint.latitude.toFixed(5)}, ${selected.lastPoint.longitude.toFixed(5)}`
                  : "—"
              }
            />
            <InfoItem
              label="Précision GPS"
              value={selected.lastPoint?.accuracy != null ? `± ${Math.round(selected.lastPoint.accuracy)} m` : "—"}
            />
            <InfoItem
              label="Dernière mise à jour"
              value={
                selected.lastPoint && nowMs !== null
                  ? secondsAgoLabel(nowMs - new Date(selected.lastPoint.recordedAt).getTime())
                  : "—"
              }
            />
            {/* V5 (§11) — dernier signal quelconque (heartbeat OU position). */}
            <InfoItem
              label="Dernier signal"
              value={
                selected.lastSignalAt && nowMs !== null
                  ? secondsAgoLabel(nowMs - new Date(selected.lastSignalAt).getTime())
                  : "—"
              }
            />
            <InfoItem
              label="Batterie téléphone"
              value={
                selected.lastPoint?.batteryLevel != null ? (
                  <span
                    className={`flex items-center gap-1 font-medium ${
                      selected.lastPoint.batteryLevel < 20
                        ? "text-red-600"
                        : selected.lastPoint.batteryLevel < 50
                          ? "text-amber-600"
                          : "text-emerald-700"
                    }`}
                  >
                    <BatteryMedium className="h-3.5 w-3.5" aria-hidden="true" />
                    {Math.round(selected.lastPoint.batteryLevel)} %
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <InfoItem
              label="Distance restante"
              value={selected.distanceToDestinationM != null ? humanDistance(selected.distanceToDestinationM) : "—"}
            />
            <InfoItem label="Agence" value={selected.agency.name} />
            <InfoItem
              label="Points de la session"
              value={`${selected.pointsCount} point${selected.pointsCount > 1 ? "s" : ""}`}
            />
            <InfoItem label="Démarrée à" value={formatTime(selected.startedAt)} />
            {selected.driver.phone && (
              <InfoItem
                label="Téléphone chauffeur"
                value={
                  <span className="flex items-center gap-1">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {selected.driver.phone}
                  </span>
                }
              />
            )}
            {osmUrl && (
              <InfoItem
                label="Carte externe"
                value={
                  <a
                    href={osmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Ouvrir dans OpenStreetMap
                  </a>
                }
              />
            )}
          </dl>

          {selected.bus && (
            <p className="mt-3 text-xs text-muted-foreground">
              Car {selected.bus.registrationNumber}
              {selected.bus.model ? ` (${selected.bus.model})` : ""}
            </p>
          )}

          {/* V5 (§44) — Événements de la session (tous niveaux, repliable). */}
          <div className="mt-3 rounded-lg border">
            <button
              type="button"
              onClick={() => setEventsOpen(!eventsOpen)}
              aria-expanded={eventsOpen}
              aria-controls="tracking-session-events"
              className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              <span className="flex items-center gap-2">
                <History className="h-3.5 w-3.5" aria-hidden />
                Événements de la session ({displayEvents.length})
              </span>
              <span>{eventsOpen ? "Masquer" : "Afficher"}</span>
            </button>
            {eventsOpen && (
              <div id="tracking-session-events" className="nzoko-scroll max-h-64 overflow-y-auto border-t p-2">
                {displayEvents.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">Aucun événement enregistré pour cette session.</p>
                ) : (
                  <ul className="space-y-1">
                    {displayEvents.map((e) => (
                      <li key={e.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs">
                        <span aria-hidden>{trackingEventEmoji(e.type)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{TRACKING_EVENT_LABELS[e.type] ?? e.type}</span>
                          {e.message ? <span className="text-muted-foreground"> — {e.message}</span> : null}
                          <span className="block text-[10px] text-muted-foreground">{formatTime(e.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Actions : trail + replay (exigence 32) */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={() => setShowTrail((visible) => !visible)}
              aria-pressed={trailVisible}
            >
              {trailVisible ? (
                <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {trailVisible ? "Masquer le trajet" : "Voir le trajet"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-[40px]"
              onClick={startReplay}
              disabled={displayTrail.length < 2}
              title={displayTrail.length < 2 ? "Trail GPS trop court pour un replay (au moins 2 points requis)." : undefined}
            >
              <History className="mr-2 h-4 w-4" aria-hidden="true" />
              ▶ Replay
            </Button>
          </div>
        </div>
      )}

      {/* --- Contrôles du replay (exigence 32) --- */}
      {replay && (
        <AdminTrackingReplay
          points={replayPoints}
          index={replay.index}
          playing={replay.playing}
          speed={replay.speed}
          label={
            selected
              ? `${selected.driver.firstName} ${selected.driver.lastName}${
                  selected.trip ? ` · ${selected.trip.originCityName} → ${selected.trip.destinationCityName}` : ""
                }`
              : "session"
          }
          onTogglePlay={toggleReplayPlay}
          onSeek={seekReplay}
          onSpeedChange={changeReplaySpeed}
          onStop={stopReplay}
        />
      )}

      {/* --- Liste des sessions (exigence 6) --- */}
      {sessions.length === 0 ? (
        <NzokoEmptyState
          icon={MapPinned}
          title="Aucun car suivi pour le moment"
          description="Les sessions démarrent depuis l'espace chauffeur (onglet « Suivi GPS »). Les positions apparaîtront ici en temps réel — les agences et les lignes restent visibles sur la carte."
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="border-b px-4 py-3">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="h-4 w-4" aria-hidden="true" />
              Sessions en cours ({filteredSessions.length}
              {filteredSessions.length !== sessions.length ? ` sur ${sessions.length}` : ""})
            </h3>
          </div>
          <div className="nzoko-scroll max-h-96 overflow-y-auto p-2">
            {filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-sm text-muted-foreground">
                <p>Aucune session ne correspond aux filtres sélectionnés.</p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" className="min-h-[40px]" onClick={resetFilters}>
                    Réinitialiser les filtres
                  </Button>
                )}
              </div>
            ) : (
              <ul className="space-y-1">
                {filteredSessions.map((s) => {
                  const status = busStatusOf(s);
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => handleSelect(s.id)}
                        aria-pressed={s.id === selectedId}
                        className={`flex min-h-[48px] w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          s.id === selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted"
                        }`}
                      >
                        <span className="min-w-0 font-medium">
                          {s.driver.firstName} {s.driver.lastName}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {s.trip ? `${s.trip.originCityName} → ${s.trip.destinationCityName}` : "hors voyage"}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          {s.lastPoint?.speed != null && (
                            <span className="text-xs text-muted-foreground">{Math.round(s.lastPoint.speed)} km/h</span>
                          )}
                          {s.lastPoint?.batteryLevel != null && (
                            <span
                              className={`flex items-center gap-1 text-xs ${
                                s.lastPoint.batteryLevel < 20
                                  ? "text-red-600"
                                  : s.lastPoint.batteryLevel < 50
                                    ? "text-amber-600"
                                    : "text-muted-foreground"
                              }`}
                              title="Batterie du téléphone chauffeur"
                            >
                              <BatteryMedium className="h-3.5 w-3.5" aria-hidden="true" />
                              {Math.round(s.lastPoint.batteryLevel)} %
                            </span>
                          )}
                          <BusStatusBadge status={status} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        États chauffeur : {Object.values(DRIVER_STATE_LABELS).join(" · ")} — mis à jour au démarrage/arrêt du suivi.
      </p>
    </div>
  );
}
