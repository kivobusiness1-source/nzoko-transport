"use client";

// ============================================================
// NZOKO TRANSPORT — Historique GPS des voyages (agence/admin)
// Sélecteur de voyage (mode « par voyage » ou « par bus ») →
// carte Leaflet avec la polyligne du parcours réel + panneau de
// statistiques (distance, durées, vitesses, sorties d'itinéraire)
// + pagination « Charger plus » (nextCursor).
// ============================================================

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Bus as BusIcon, CalendarClock, Flag, Gauge, History as HistoryIcon, Loader2, MapPin,
  Route as RouteIcon, Timer, TrendingUp, TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { GLOBAL_ROLES, TRIP_STATUS_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { friendlyApiError, useApiData, type ApiErrorInfo } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { NzokoSubTabs, type NzokoTabDef } from "@/components/shared/nzoko-chips";
import { computePointStats } from "./fleet-utils";
import type { TripHistoryDTO } from "@/types";

// Leaflet exige window → chargement dynamique côté client uniquement.
const FleetHistoryMap = dynamic(() => import("./fleet-history-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[45vh] min-h-[280px] w-full items-center justify-center rounded-2xl border bg-muted/40 lg:h-[420px]" role="status" aria-label="Chargement de la carte…">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <MapPin className="h-6 w-6 animate-pulse" aria-hidden />
        <p className="text-xs">Chargement du parcours…</p>
      </div>
    </div>
  ),
});

const MODES: NzokoTabDef[] = [
  { key: "trip", label: "Par voyage", icon: RouteIcon },
  { key: "bus", label: "Par bus", icon: BusIcon },
];

const NO_SELECTION = "none";

interface TripOption {
  tripId: string;
  tripCode: string | null;
  label: string;
  sub: string;
  at: string;
}

export default function FleetHistoryView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { session } = useApp();
  const isGlobalRole = session ? GLOBAL_ROLES.includes(session.role) : false;

  const [agencyFilter, setAgencyFilter] = useState<string>("all");
  const agencyId = isGlobalRole && agencyFilter !== "all" ? agencyFilter : undefined;

  // Sources des sélecteurs (voyages et bus connus du snapshot/journal).
  const { data: snapshot, loading: snapshotLoading, error: snapshotError, reload: reloadSnapshot } = useApiData(
    () => api.tracking.current(agencyId ? { agencyId } : undefined),
    { refetchKey: [agencyId], refreshKey, autoRefreshMs: 60_000 },
  );
  const { data: events } = useApiData(
    () => api.tracking.events(agencyId ? { agencyId, limit: 30 } : { limit: 30 }),
    { refetchKey: [agencyId], refreshKey },
  );

  const [mode, setMode] = useState("trip");
  const [tripId, setTripId] = useState<string>(NO_SELECTION);
  const [busId, setBusId] = useState<string>(NO_SELECTION);
  const [busTrips, setBusTrips] = useState<TripHistoryDTO[] | null>(null);
  const [busTripsLoading, setBusTripsLoading] = useState(false);
  const [busTripsError, setBusTripsError] = useState<ApiErrorInfo | null>(null);

  // Historique du voyage sélectionné (points + pagination).
  const [history, setHistory] = useState<TripHistoryDTO | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<ApiErrorInfo | null>(null);
  const [historyRetryTick, setHistoryRetryTick] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const buses = snapshot?.buses ?? [];

  // Options « par voyage » : voyages du snapshot + voyages du journal.
  const tripOptions = useMemo<TripOption[]>(() => {
    const map = new Map<string, TripOption>();
    for (const b of buses) {
      if (!b.tripId) continue;
      map.set(b.tripId, {
        tripId: b.tripId,
        tripCode: b.tripCode,
        label: `${b.tripCode ?? "Voyage"} — ${b.originCityName ?? "?"} → ${b.destinationCityName ?? "?"}`,
        sub: `${b.fleetNumber ?? b.registrationNumber} · en direct`,
        at: b.lastSeenAt ?? "",
      });
    }
    for (const e of events ?? []) {
      if (map.has(e.tripId)) continue;
      map.set(e.tripId, {
        tripId: e.tripId,
        tripCode: e.tripCode,
        label: `${e.tripCode ?? "Voyage"} — ${e.busLabel}`,
        sub: e.driverName ? `chauffeur ${e.driverName}` : "voyage terminé",
        at: e.createdAt,
      });
    }
    return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomposé quand les sources arrivent
  }, [snapshot, events]);

  // Options « par bus » : voyages suivis du bus choisi (7 derniers jours).
  useEffect(() => {
    if (mode !== "bus" || busId === NO_SELECTION) {
      setBusTrips(null);
      setBusTripsError(null);
      return;
    }
    let cancelled = false;
    setBusTripsLoading(true);
    setBusTripsError(null);
    api.tracking
      .busHistory(busId)
      .then((trips) => {
        if (!cancelled) setBusTrips(trips);
      })
      .catch((err) => {
        if (!cancelled) setBusTripsError(friendlyApiError(err));
      })
      .finally(() => {
        if (!cancelled) setBusTripsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, busId]);

  // Chargement de l'historique du voyage choisi.
  useEffect(() => {
    if (tripId === NO_SELECTION) {
      setHistory(null);
      setHistoryError(null);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    api.tracking
      .tripHistory(tripId)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((err) => {
        if (!cancelled) {
          setHistory(null);
          setHistoryError(friendlyApiError(err));
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, historyRetryTick]);

  const changeMode = (key: string) => {
    setMode(key);
    setTripId(NO_SELECTION);
    setBusId(NO_SELECTION);
    setHistory(null);
    setHistoryError(null);
  };

  /** Pagination : les pages suivantes contiennent les points PLUS ANCIENS. */
  const loadMore = async () => {
    if (!history?.hasMore || !history.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.tracking.tripHistory(history.tripId, history.nextCursor);
      setHistory((prev) => {
        if (!prev) return page;
        return { ...page, points: [...page.points, ...prev.points] };
      });
    } catch {
      toast.error("Impossible de charger la suite du parcours. Réessayez.");
    } finally {
      setLoadingMore(false);
    }
  };

  // Statistiques cumulées (fusion des pages) + valeurs stables du voyage.
  const pointStats = useMemo(() => computePointStats(history?.points ?? []), [history?.points]);
  const selectedOptionLabel =
    tripOptions.find((o) => o.tripId === tripId)?.label ??
    busTrips?.find((t) => t.tripId === tripId)?.tripCode ??
    null;

  if (snapshotLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-[45vh] min-h-[280px] rounded-2xl lg:h-[420px]" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (snapshotError) {
    return <NzokoErrorBox error={snapshotError} onRetry={reloadSnapshot} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <HistoryIcon className="h-5 w-5 text-primary" aria-hidden /> Historique GPS
        </h2>
        <p className="text-xs text-muted-foreground">
          Parcours réel, arrêts et statistiques des voyages suivis.
        </p>
      </div>

      {/* ---------- Sélecteurs ---------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <NzokoSubTabs tabs={MODES} active={mode} onChange={changeMode} ariaLabel="Mode de sélection de l'historique" />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            {mode === "trip" ? (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="history-trip" className="text-xs font-medium text-muted-foreground">Voyage suivi</label>
                <Select value={tripId} onValueChange={setTripId}>
                  <SelectTrigger id="history-trip" className="h-10 w-full sm:w-[330px]" aria-label="Choisir un voyage suivi">
                    <SelectValue placeholder={tripOptions.length === 0 ? "Aucun voyage suivi" : "Choisir un voyage…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {tripOptions.length === 0 && <SelectItem value={NO_SELECTION} disabled>Aucun voyage suivi actuellement</SelectItem>}
                    {tripOptions.map((o) => (
                      <SelectItem key={o.tripId} value={o.tripId}>
                        <span className="max-w-[280px] truncate">{o.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor="history-bus" className="text-xs font-medium text-muted-foreground">Bus</label>
                  <Select
                    value={busId}
                    onValueChange={(v) => {
                      setBusId(v);
                      setTripId(NO_SELECTION);
                    }}
                  >
                    <SelectTrigger id="history-bus" className="h-10 w-full sm:w-[240px]" aria-label="Choisir un bus">
                      <SelectValue placeholder={buses.length === 0 ? "Aucun bus" : "Choisir un bus…"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SELECTION} disabled>Sélectionnez un bus</SelectItem>
                      {buses.map((b) => (
                        <SelectItem key={b.busId} value={b.busId}>
                          {b.fleetNumber ?? b.registrationNumber} — {b.originCityName ?? "?"} → {b.destinationCityName ?? "?"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <label htmlFor="history-bus-trip" className="text-xs font-medium text-muted-foreground">Voyage du bus</label>
                  <Select value={tripId} onValueChange={setTripId} disabled={busId === NO_SELECTION || busTripsLoading}>
                    <SelectTrigger id="history-bus-trip" className="h-10 w-full sm:w-[260px]" aria-label="Choisir un voyage du bus">
                      <SelectValue placeholder={busId === NO_SELECTION ? "—" : busTripsLoading ? "Chargement…" : "Choisir un voyage…"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(busTrips ?? []).length === 0 && <SelectItem value={NO_SELECTION} disabled>Aucun voyage suivi (7 derniers jours)</SelectItem>}
                      {(busTrips ?? []).map((t) => (
                        <SelectItem key={t.tripId} value={t.tripId}>
                          {t.tripCode} · {formatDateTime(t.scheduledDeparture)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {isGlobalRole && (
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor="history-agency" className="text-xs font-medium text-muted-foreground">Agence</label>
                <Select value={agencyFilter} onValueChange={setAgencyFilter}>
                  <SelectTrigger id="history-agency" className="h-10 w-full sm:w-[200px]" aria-label="Filtrer par agence">
                    <SelectValue placeholder="Toutes les agences" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les agences</SelectItem>
                    {[...new Map(buses.map((b) => [b.agencyId, b])).values()].map((b) => (
                      <SelectItem key={b.agencyId} value={b.agencyId}>{b.agencyName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {mode === "bus" && busTripsError && (
            <p className="text-sm text-red-700 dark:text-red-300">{busTripsError.message}</p>
          )}
          {mode === "bus" && busId !== NO_SELECTION && !busTripsLoading && busTrips && busTrips.length === 0 && (
            <NzokoEmptyState
              icon={BusIcon}
              title="Aucun voyage suivi pour ce bus"
              description="Aucune position GPS enregistrée sur les 7 derniers jours pour ce bus."
            />
          )}
        </CardContent>
      </Card>

      {/* ---------- Carte + statistiques du voyage ---------- */}
      {tripId === NO_SELECTION ? (
        <NzokoEmptyState
          icon={MapPin}
          title="Choisissez un voyage"
          description="Sélectionnez un voyage suivi (ou un bus puis un de ses voyages) pour afficher son parcours GPS."
        />
      ) : historyLoading ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-[45vh] min-h-[280px] rounded-2xl lg:h-[420px]" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      ) : historyError ? (
        <NzokoErrorBox error={historyError} onRetry={() => setHistoryRetryTick((t) => t + 1)} />
      ) : !history ? (
        <NzokoEmptyState icon={MapPin} title="Parcours indisponible" description="Aucune donnée GPS pour ce voyage." />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]"
        >
          <FleetHistoryMap history={history} />

          <Card className="h-fit">
            <CardContent className="space-y-4 p-4">
              <div>
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <span className="font-mono text-sm">{history.tripCode}</span>
                  {history.tripStatus && (
                    <Badge variant="secondary" className="text-[10px]">
                      {TRIP_STATUS_LABELS[history.tripStatus as keyof typeof TRIP_STATUS_LABELS] ?? history.tripStatus}
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {history.originCityName} → {history.destinationCityName}
                  {" · "}
                  {history.busFleetNumber ?? history.busRegistration}
                  {" · "}
                  {history.driverName}
                </p>
                {selectedOptionLabel && selectedOptionLabel !== history.tripCode && (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{selectedOptionLabel}</p>
                )}
              </div>

              {/* Statistiques du parcours */}
              <div className="grid grid-cols-2 gap-2.5" aria-label="Statistiques du parcours">
                <HistoryStat icon={RouteIcon} label="Distance" value={`${pointStats.distanceKm} km`} />
                <HistoryStat icon={Timer} label="Durée du voyage" value={history.stats.durationMinutes !== null ? `${history.stats.durationMinutes} min` : "—"} />
                <HistoryStat icon={Gauge} label="Vitesse moyenne" value={pointStats.averageSpeedKmh !== null ? `${pointStats.averageSpeedKmh} km/h` : "—"} />
                <HistoryStat icon={TrendingUp} label="Vitesse max" value={pointStats.maxSpeedKmh !== null ? `${pointStats.maxSpeedKmh} km/h` : "—"} />
                <HistoryStat icon={HistoryIcon} label="En mouvement" value={`${pointStats.movingMinutes} min`} />
                <HistoryStat icon={MapPin} label="À l'arrêt" value={`${pointStats.stoppedMinutes} min`} />
                <HistoryStat icon={Flag} label="Points GPS" value={String(pointStats.pointCount)} />
                <HistoryStat
                  icon={TriangleAlert}
                  label="Sorties d'itinéraire"
                  value={String(history.stats.offRouteEvents)}
                  tone={history.stats.offRouteEvents > 0 ? "red" : "neutral"}
                />
              </div>

              {/* Horaires prévus vs réels */}
              <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-xs" aria-label="Horaires du voyage">
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Départ prévu</span>
                  <span className="font-medium">{formatDateTime(history.scheduledDeparture)}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Départ réel</span>
                  <span className="font-medium">
                    {history.actualDepartureAt ? formatDateTime(history.actualDepartureAt) : "—"}
                  </span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Arrivée prévue</span>
                  <span className="font-medium">{formatDateTime(history.scheduledArrival)}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Arrivée réelle</span>
                  <span className="font-medium">
                    {history.actualArrivalAt ? formatDateTime(history.actualArrivalAt) : "—"}
                  </span>
                </p>
              </div>

              {/* Arrêts de l'itinéraire */}
              {history.stops.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> Arrêts ({history.stops.length})
                  </p>
                  <ul className="nzoko-scroll max-h-32 space-y-1 overflow-y-auto pr-1 text-xs">
                    {history.stops.map((s) => (
                      <li key={`${s.position}-${s.name}`} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
                        <span className="min-w-0 truncate">{s.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {s.minutesFromStart > 0 ? `+${s.minutesFromStart} min` : "origine"}
                          {s.latitude === null ? " · position inconnue" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pagination des points */}
              {history.hasMore ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full gap-2"
                  onClick={loadMore}
                  disabled={loadingMore}
                  aria-label="Charger les points GPS plus anciens"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…
                    </>
                  ) : (
                    <>
                      <CalendarClock className="h-4 w-4" aria-hidden /> Charger plus ({pointStats.pointCount} points)
                    </>
                  )}
                </Button>
              ) : (
                <p className="text-center text-[11px] text-muted-foreground">
                  Parcours complet · {pointStats.pointCount} points
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

function HistoryStat({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "neutral" | "red";
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          tone === "red" ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300" : "bg-primary/10 text-primary"
        }`}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
