"use client";

// ============================================================
// NZOKO — Vue publique « Carte des lignes NZOKO » (exigences 21, 41)
// Accessible SANS connexion : agences officielles, tracés des
// lignes interurbaines, arrêts par ville et (si activé côté
// serveur) positions des bus volontairement minimales.
// Tuiles : /api/tracking/config → map.tileUrl (SEULE source),
// repli GPS_MAP de @/lib/gps-config si l'appel échoue.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Map as MapIcon, MapPin, RefreshCw, Route as RouteIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { friendlyApiError, type ApiErrorInfo } from "@/components/shared/nzoko-use-api";
import { api } from "@/lib/api-client";
import { GPS_MAP } from "@/lib/gps-config";
import { BUS_STATUS_LABELS, type BusStatus } from "@/lib/geo";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { MapConfigDTO, MapPublicDTO } from "@/types";
import PublicMapCanvas, { BUS_STATUS_COLORS } from "@/features/client/public-map-canvas";

/** Rafraîchissement des positions bus (uniquement si des bus sont affichés). */
const BUS_POLL_INTERVAL_MS = 30_000;

const CHIP_BASE =
  "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";
const CHIP_ACTIVE = "border-primary bg-primary text-primary-foreground";
const CHIP_IDLE = "border-border bg-background hover:border-primary/40 hover:bg-primary/5";

/** Une étape de l'itinéraire chronologique (départ, arrêt, arrivée). */
function StopItem({
  circle,
  circleClass,
  name,
  label,
  minutes = null,
}: {
  circle: string;
  circleClass: string;
  name: string;
  label: string;
  minutes?: number | null;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
          circleClass
        )}
        aria-hidden
      >
        {circle}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      {minutes !== null && (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
          +{minutes} min
        </span>
      )}
    </li>
  );
}

export default function PublicMapView() {
  const setView = useApp((s) => s.setView);

  const [config, setConfig] = useState<MapConfigDTO | null>(null);
  const [data, setData] = useState<MapPublicDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  // Tuiles de la carte : config serveur (source unique), repli local si indisponible.
  useEffect(() => {
    let cancelled = false;
    api.tracking.config()
      .then((cfg) => {
        if (!cancelled) setConfig(cfg.map);
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({
            provider: GPS_MAP.provider,
            tileUrl: GPS_MAP.tileUrl,
            attribution: GPS_MAP.attribution,
            defaultLat: GPS_MAP.defaultLat,
            defaultLng: GPS_MAP.defaultLng,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Données de la carte (publiques, sans authentification).
  const loadData = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    setRefreshing(true);
    try {
      const result = await api.mapPublic();
      setData(result);
      setError(null);
    } catch (err) {
      // En rafraîchissement silencieux : conserver les données affichées.
      if (!silent) setError(friendlyApiError(err));
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  // Polling léger (30 s) UNIQUEMENT si des bus sont affichés —
  // buses=[] → aucun rafraîchissement inutile.
  const busCount = data?.buses.length ?? 0;
  useEffect(() => {
    if (busCount === 0) return;
    const timer = setInterval(() => {
      void loadData(true);
    }, BUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [busCount, loadData]);

  const goHome = useCallback(() => {
    setView("home");
    window.scrollTo({ top: 0 });
  }, [setView]);

  // Sélection depuis la carte (clic tracé) — les chips gèrent elles-mêmes le basculement.
  const handleSelectRoute = useCallback((routeId: string) => {
    setSelectedRouteId(routeId);
  }, []);

  const toggleRoute = useCallback((routeId: string) => {
    setSelectedRouteId((current) => (current === routeId ? null : routeId));
  }, []);

  const selectedRoute = useMemo(
    () => (data && selectedRouteId ? data.routes.find((r) => r.id === selectedRouteId) ?? null : null),
    [data, selectedRouteId]
  );

  const servedCityCount = useMemo(
    () => new Set((data?.routes ?? []).flatMap((r) => r.stops.map((s) => s.name))).size,
    [data]
  );

  const sortedStops = useMemo(
    () => (selectedRoute ? [...selectedRoute.stops].sort((a, b) => a.position - b.position) : []),
    [selectedRoute]
  );

  const providerLabel = !config || config.provider === "openstreetmap" ? "OpenStreetMap" : config.provider;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6" aria-label="Carte des lignes NZOKO">
      {/* ---------- En-tête de vue ---------- */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          onClick={goHome}
          aria-label="Retour à l'accueil"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
            <MapIcon className="size-5 shrink-0 text-primary" aria-hidden /> Carte des lignes NZOKO
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Nos agences, nos trajets interurbains</p>
        </div>
        <Badge variant="outline" className="mt-1 shrink-0 gap-1.5 bg-background">
          <MapPin className="size-3 text-primary" aria-hidden /> {providerLabel}
        </Badge>
      </div>

      {error ? (
        <div className="mt-6">
          <NzokoErrorBox error={error} onRetry={() => void loadData(false)} />
        </div>
      ) : loading || !data ? (
        /* ---------- Chargement ---------- */
        <div className="mt-4 space-y-4" aria-busy="true">
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-36 shrink-0 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-[320px] w-full rounded-xl sm:h-[480px]" />
          <span className="sr-only">Chargement de la carte des lignes…</span>
        </div>
      ) : data.routes.length === 0 && data.agencies.length === 0 ? (
        <div className="mt-6">
          <NzokoEmptyState
            icon={MapIcon}
            title="Carte en préparation"
            description="Nos lignes et agences seront bientôt visibles ici. Revenez très vite !"
          />
        </div>
      ) : (
        <>
          {/* ---------- Chips de lignes (défilement horizontal) ---------- */}
          <div
            className="nzoko-scroll mt-4 flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label="Sélectionner une ligne"
          >
            <button
              type="button"
              aria-pressed={selectedRouteId === null}
              onClick={() => setSelectedRouteId(null)}
              className={cn(CHIP_BASE, selectedRouteId === null ? CHIP_ACTIVE : CHIP_IDLE)}
            >
              <RouteIcon className="h-3.5 w-3.5" aria-hidden />
              Toutes les lignes
            </button>
            {data.routes.map((route) => {
              const active = route.id === selectedRouteId;
              return (
                <button
                  key={route.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleRoute(route.id)}
                  title={`${route.originCityName} → ${route.destinationCityName}`}
                  className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE)}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                    {route.code}
                  </span>
                  {route.originCityName} → {route.destinationCityName}
                </button>
              );
            })}
          </div>

          {/* ---------- Carte ---------- */}
          <div className="mt-3">
            {config ? (
              <PublicMapCanvas
                tileUrl={config.tileUrl}
                attribution={config.attribution}
                centerLat={config.defaultLat}
                centerLng={config.defaultLng}
                data={data}
                selectedRouteId={selectedRouteId}
                onSelectRoute={handleSelectRoute}
              />
            ) : (
              <Skeleton className="h-[320px] w-full rounded-xl sm:h-[480px]" />
            )}
          </div>

          {/* ---------- Résumé ---------- */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{data.routes.length} lignes</span>
            <span aria-hidden>·</span>
            <span>{data.agencies.length} agences</span>
            <span aria-hidden>·</span>
            <span>{servedCityCount} villes desservies</span>
            {data.buses.length > 0 && (
              <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                <span className="relative flex size-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                {data.buses.length} bus suivis en direct
                <RefreshCw className={cn("size-3", refreshing && "animate-spin")} aria-hidden />
              </span>
            )}
            {selectedRoute === null && (
              <span className="basis-full sm:basis-auto">
                Touchez une ligne (sur la carte ou dans la liste) pour découvrir ses arrêts.
              </span>
            )}
          </div>

          {/* ---------- Légende des états bus (si affichés) ---------- */}
          {data.buses.length > 0 && (
            <div className="mt-3 rounded-xl border bg-muted/30 px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground">
                État des bus en direct — actualisation toutes les 30 s
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {(Object.keys(BUS_STATUS_COLORS) as BusStatus[]).map((status) => (
                  <li key={status} className="inline-flex items-center gap-1.5 text-xs">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: BUS_STATUS_COLORS[status] }}
                      aria-hidden
                    />
                    {BUS_STATUS_LABELS[status]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---------- Arrêts de la ligne sélectionnée ---------- */}
          {selectedRoute && (
            <motion.div
              key={selectedRoute.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <Card className="mt-4">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <RouteIcon className="size-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 truncate">
                      {selectedRoute.originCityName} → {selectedRoute.destinationCityName}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    Ligne {selectedRoute.code} · {Math.round(selectedRoute.distanceKm)} km ·{" "}
                    {selectedRoute.stops.length === 0
                      ? "trajet direct"
                      : `${selectedRoute.stops.length} arrêt${selectedRoute.stops.length > 1 ? "s" : ""} intermédiaire${selectedRoute.stops.length > 1 ? "s" : ""}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol
                    className="nzoko-scroll max-h-96 space-y-3 overflow-y-auto pr-1"
                    aria-label={`Itinéraire de la ligne ${selectedRoute.code}`}
                  >
                    <StopItem
                      circle="D"
                      circleClass="border-primary bg-primary text-primary-foreground"
                      name={selectedRoute.originCityName}
                      label="Ville de départ"
                    />
                    {sortedStops.map((stop, index) => (
                      <StopItem
                        key={`${stop.name}-${stop.position}`}
                        circle={String(index + 1)}
                        circleClass="border-border bg-muted text-muted-foreground"
                        name={stop.name}
                        label="Arrêt intermédiaire"
                        minutes={stop.minutesFromStart}
                      />
                    ))}
                    <StopItem
                      circle="A"
                      circleClass="border-primary/40 bg-primary/10 text-primary"
                      name={selectedRoute.destinationCityName}
                      label="Ville d&apos;arrivée"
                    />
                  </ol>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}
    </section>
  );
}
