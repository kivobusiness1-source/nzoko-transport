"use client";

// ============================================================
// NZOKO TRANSPORT — Dashboard « Suivi de flotte » (agence/admin)
// Carte interactive Leaflet + temps réel socket.io + panneau
// latéral (liste des bus) + journal des événements.
// La carte est chargée dynamiquement (ssr:false — Leaflet exige
// window) ; le hook use-fleet-realtime gère socket + fallback
// polling de façon transparente.
// ============================================================

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Activity, Bus as BusIcon, Gauge, MapPin, Radar, Search, Signal, SignalHigh, SignalZero,
  UserRound, ChevronDown, Phone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { FLEET_BUS_STATE_LABELS, GLOBAL_ROLES, TRACKING_EVENT_LABELS, type TrackingEventType } from "@/lib/constants";
import { formatTime, relativeTime } from "@/lib/format";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { useFleetRealtime } from "@/hooks/use-fleet-realtime";
import { cn } from "@/lib/utils";
import type { FleetBusDTO, TrackingEventDTO } from "@/types";
import {
  BUS_STATE_BADGE_CLASS,
  FLEET_STATUS_FILTERS,
  driverNameOf,
  filterBuses,
  lastSeenLabel,
  type FleetStatusFilter,
} from "./fleet-utils";

// Leaflet exige window → chargement dynamique côté client uniquement.
const FleetMap = dynamic(() => import("./fleet-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[45vh] min-h-[280px] w-full items-center justify-center rounded-2xl border bg-muted/40 lg:h-full" role="status" aria-label="Chargement de la carte…">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Radar className="h-6 w-6 animate-pulse" aria-hidden />
        <p className="text-xs">Chargement de la carte…</p>
      </div>
    </div>
  ),
});

// ---------- Icône par type d'événement du journal ----------

const EVENT_ICONS: Partial<Record<TrackingEventType, LucideIcon>> = {
  TRIP_STARTED: Activity,
  TRIP_PAUSED: Activity,
  TRIP_RESUMED: Activity,
  TRIP_ARRIVED: MapPin,
  GPS_STARTED: SignalHigh,
  GPS_STOPPED: Signal,
  GPS_OFFLINE: SignalZero,
  GPS_ONLINE: SignalHigh,
  OFF_ROUTE: Radar,
  DESTINATION_NEAR: MapPin,
  DRIVER_CHANGED: UserRound,
  BUS_CHANGED: BusIcon,
};

const METADATA_KEY_LABELS: Record<string, string> = {
  reason: "motif",
  distanceM: "distance",
  speedKmh: "vitesse",
  heading: "cap",
  accuracyM: "précision",
  minutes: "minutes",
  radiusM: "rayon",
  city: "ville",
  recovered: "récupéré",
  sessionId: "session",
};

function eventIcon(type: string): LucideIcon {
  return EVENT_ICONS[type as TrackingEventType] ?? Activity;
}

function eventLabel(event: TrackingEventDTO): string {
  const known = TRACKING_EVENT_LABELS[event.eventType as TrackingEventType];
  return event.eventTypeLabel || known || event.eventType;
}

function metadataSummary(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const label = METADATA_KEY_LABELS[key] ?? key;
      parts.push(`${label} : ${value}`);
    }
    if (parts.length >= 2) break;
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function FleetView({ refreshKey = 0 }: { refreshKey?: number }) {
  const { session } = useApp();
  const isGlobalRole = session ? GLOBAL_ROLES.includes(session.role) : false;

  // ---------- Données temps réel (socket.io + fallback polling) ----------
  const [agencyFilter, setAgencyFilter] = useState<string>("all");
  const hookAgencyId = isGlobalRole && agencyFilter !== "all" ? agencyFilter : undefined;
  const fleet = useFleetRealtime(hookAgencyId, { enabled: true });

  useEffect(() => {
    if (refreshKey > 0) fleet.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh global piloté par l'espace parent
  }, [refreshKey]);

  // ---------- Filtres du panneau ----------
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>("all");
  const [driverFilter, setDriverFilter] = useState<string>("all");
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ busId: string; lat: number; lng: number; nonce: number } | null>(null);
  const [journalOpen, setJournalOpen] = useState(true);

  // Horloge partagée : recalcul des « il y a X s » sans recharger les données.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // Agences (filtre réservé aux rôles voyant plusieurs agences).
  const { data: agencies } = useApiData(
    () => (isGlobalRole ? api.admin.agencies() : Promise.resolve([])),
    { refetchKey: [isGlobalRole] },
  );

  const buses = useMemo(() => fleet.snapshot?.buses ?? [], [fleet.snapshot]);
  const filtered = useMemo(
    () => filterBuses(buses, {
      q: query,
      status: statusFilter,
      driver: driverFilter === "all" ? null : driverFilter,
    }),
    [buses, query, statusFilter, driverFilter],
  );

  const drivers = useMemo(() => {
    const set = new Set(buses.map(driverNameOf));
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [buses]);

  const stats = fleet.snapshot?.stats;

  const selectBus = (bus: FleetBusDTO) => {
    setSelectedBusId(bus.busId);
    if (bus.latitude !== null && bus.longitude !== null) {
      setFocus((prev) => ({
        busId: bus.busId,
        lat: bus.latitude as number,
        lng: bus.longitude as number,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    } else {
      toast.info(`${bus.fleetNumber ?? bus.registrationNumber} n'a pas de position GPS pour le moment (hors ligne ?).`);
    }
  };

  // ---------- Chargement / erreur ----------

  if (fleet.loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-6 w-28" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-[45vh] min-h-[280px] rounded-2xl lg:h-[520px]" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (fleet.error) {
    return <NzokoErrorBox error={fleet.error} onRetry={fleet.reload} />;
  }

  const realtimeBadge = fleet.connected ? (
    <Badge className="gap-1.5 border-transparent bg-emerald-600 text-white" aria-label="Connexion temps réel active">
      <span className="relative flex size-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-200" />
      </span>
      Temps réel
    </Badge>
  ) : fleet.realtime ? (
    <Badge variant="outline" className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
      <Signal className="h-3 w-3" aria-hidden /> Reconnexion…
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1.5">
      <Signal className="h-3 w-3" aria-hidden /> Polling 15 s
    </Badge>
  );

  return (
    <div className="space-y-4">
      {/* ---------- En-tête + mode de connexion ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Radar className="h-5 w-5 text-primary" aria-hidden /> Suivi de flotte
          </h2>
          <p className="text-xs text-muted-foreground">
            Localisation des bus en direct{stats ? ` · ${stats.total} bus suivis` : ""}
          </p>
        </div>
        {realtimeBadge}
      </div>

      {/* ---------- Bandeau de statistiques ---------- */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          aria-label="Statistiques de la flotte"
        >
          <StatCard icon={<SignalHigh className="h-4 w-4" aria-hidden />} label="En ligne" value={stats.online} dot="bg-emerald-500" />
          <StatCard icon={<Signal className="h-4 w-4" aria-hidden />} label="Connexion instable" value={stats.unstable} dot="bg-amber-500" />
          <StatCard icon={<SignalZero className="h-4 w-4" aria-hidden />} label="Hors ligne" value={stats.offline} dot="bg-red-500" />
          <StatCard icon={<BusIcon className="h-4 w-4" aria-hidden />} label="Bus au total" value={stats.total} dot="bg-primary" />
        </motion.div>
      )}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border bg-card/60 px-4 py-2.5 text-xs text-muted-foreground" aria-label="Détail des états">
          <DetailStat label={FLEET_BUS_STATE_LABELS.EN_ROUTE} value={stats.enRoute} className="text-emerald-700 dark:text-emerald-400" />
          <DetailStat label={FLEET_BUS_STATE_LABELS.ARRIVED} value={stats.arrived} className="text-teal-700 dark:text-teal-400" />
          <DetailStat label={FLEET_BUS_STATE_LABELS.PAUSED} value={stats.paused} className="text-amber-700 dark:text-amber-400" />
          <DetailStat label={FLEET_BUS_STATE_LABELS.OFF_ROUTE} value={stats.offRoute} className="text-red-700 dark:text-red-400" />
          <DetailStat label="En retard" value={stats.delayed} className="text-orange-700 dark:text-orange-400" />
        </div>
      )}

      {/* ---------- Filtres ---------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un bus, un chauffeur, un code voyage…"
                className="h-10 pl-9"
                aria-label="Rechercher un bus, un chauffeur ou un code voyage"
                inputMode="search"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={driverFilter} onValueChange={setDriverFilter}>
                <SelectTrigger size="sm" className="h-10 w-[170px]" aria-label="Filtrer par chauffeur">
                  <SelectValue placeholder="Chauffeur" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les chauffeurs</SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isGlobalRole && (
                <Select value={agencyFilter} onValueChange={setAgencyFilter}>
                  <SelectTrigger size="sm" className="h-10 w-[190px]" aria-label="Filtrer par agence">
                    <SelectValue placeholder="Agence" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les agences</SelectItem>
                    {(agencies ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="nzoko-scroll flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Filtrer par statut">
            {FLEET_STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(f.key)}
                  className={cn(
                    "min-h-[36px] shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ---------- Carte + panneau latéral ---------- */}
      {buses.length === 0 ? (
        <NzokoEmptyState
          icon={Radar}
          title="Aucun bus à suivre"
          description="Aucun voyage suivi pour le moment. Le suivi démarre automatiquement quand un chauffeur lance le GPS depuis son téléphone."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-h-0 lg:h-[520px]">
            <FleetMap
              buses={filtered}
              now={now}
              focus={focus}
              onSelectBus={(id) => {
                setSelectedBusId(id);
                const bus = filtered.find((b) => b.busId === id);
                if (bus) {
                  setFocus((prev) => ({
                    busId: id,
                    lat: bus.latitude as number,
                    lng: bus.longitude as number,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }));
                }
              }}
            />
          </div>

          <Card className="flex min-h-0 flex-col">
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <p className="text-sm font-semibold">
                  Bus ({filtered.length}
                  {filtered.length !== buses.length ? `/${buses.length}` : ""})
                </p>
                {selectedBusId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelectedBusId(null)}
                    aria-label="Effacer la sélection"
                  >
                    Effacer la sélection
                  </Button>
                )}
              </div>
              <div className="nzoko-scroll max-h-96 divide-y overflow-y-auto lg:max-h-[452px]" role="list" aria-label="Liste des bus suivis">
                {filtered.length === 0 ? (
                  <div className="p-6">
                    <NzokoEmptyState title="Aucun bus ne correspond aux filtres" description="Modifiez la recherche ou les filtres de statut." />
                  </div>
                ) : (
                  filtered.map((bus) => (
                    <BusCard
                      key={bus.busId}
                      bus={bus}
                      now={now}
                      selected={bus.busId === selectedBusId}
                      onSelect={() => selectBus(bus)}
                    />
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---------- Journal des événements ---------- */}
      <Collapsible open={journalOpen} onOpenChange={setJournalOpen}>
        <Card>
          <CardContent className="p-0">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-h-[52px] w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                aria-expanded={journalOpen}
                aria-label="Journal des événements de suivi"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Activity className="h-4 w-4 text-primary" aria-hidden />
                  Journal des événements
                  <Badge variant="secondary" className="text-[10px]">{fleet.events.length}</Badge>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", journalOpen && "rotate-180")} aria-hidden />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t">
                {fleet.events.length === 0 ? (
                  <div className="p-6">
                    <NzokoEmptyState icon={Activity} title="Aucun événement" description="Les événements de suivi (départs, pauses, hors itinéraire…) apparaîtront ici." />
                  </div>
                ) : (
                  <ul className="nzoko-scroll max-h-96 divide-y overflow-y-auto" aria-label="Événements de suivi">
                    {fleet.events.map((event) => {
                      const Icon = eventIcon(event.eventType);
                      const summary = metadataSummary(event.metadata);
                      return (
                        <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight">{eventLabel(event)}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {event.busLabel}
                              {event.tripCode ? ` · ${event.tripCode}` : ""}
                              {event.driverName ? ` · ${event.driverName}` : ""}
                            </p>
                            {summary && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{summary}</p>}
                          </div>
                          <time className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground" dateTime={event.createdAt}>
                            {relativeTime(event.createdAt)}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </CollapsibleContent>
          </CardContent>
        </Card>
      </Collapsible>
    </div>
  );
}

// ---------- Sous-composants ----------

function StatCard({ icon, label, value, dot }: { icon: React.ReactNode; label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />
          {label}
        </p>
        <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

function DetailStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("font-semibold tabular-nums", className)}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function BusCard({ bus, now, selected, onSelect }: { bus: FleetBusDTO; now: number; selected: boolean; onSelect: () => void }) {
  const title = bus.fleetNumber ?? bus.registrationNumber;
  const route = bus.originCityName && bus.destinationCityName
    ? `${bus.originCityName} → ${bus.destinationCityName}`
    : "Trajet non défini";

  return (
    <button
      type="button"
      role="listitem"
      onClick={onSelect}
      aria-label={`Centrer la carte sur le bus ${title} — ${bus.stateLabel}`}
      className={cn(
        "w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:bg-muted/60",
        selected ? "bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-sm font-bold">{title}</span>
          {bus.delayed && (
            <span className="inline-flex items-center rounded border border-orange-200 bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-800 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300">
              EN RETARD
            </span>
          )}
        </span>
        <span className={cn("inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold", BUS_STATE_BADGE_CLASS[bus.state])}>
          {bus.stateLabel}
        </span>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {route}
        {bus.tripCode ? ` · ${bus.tripCode}` : ""}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <UserRound className="size-3" aria-hidden />
          {driverNameOf(bus)}
        </span>
        <span className="flex items-center gap-1">
          <Gauge className="size-3" aria-hidden />
          {bus.speed !== null ? `${Math.round(bus.speed)} km/h` : "—"}
        </span>
        <span>{bus.lastSeenAt ? lastSeenLabel(bus.lastSeenAt, now) : "signal inconnu"}</span>
        {bus.driverPhone && (
          <span className="flex items-center gap-1">
            <Phone className="size-3" aria-hidden />
            <span className="font-mono">{bus.driverPhone}</span>
          </span>
        )}
      </div>
      <span className="sr-only">Dernier signal {bus.lastSeenAt ? formatTime(bus.lastSeenAt) : "inconnu"}</span>
    </button>
  );
}
