"use client";

// ============================================================
// NZOKO TRANSPORT — Panneau GPS du CHAUFFEUR (module 13-a)
// Suivi temps réel smartphone : état du trajet, badges GPS /
// Internet / dernière position, gros boutons d'action, sélection
// du voyage, résumé de fin — file offline via useDriverGps.
// Mobile-first 320px · PWA · aucune route backend modifiée.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRight, BusFront, CheckCircle2, Flag, Info, Loader2, MapPin, Pause, Play,
  Radio, Signal, TriangleAlert, Wifi, WifiOff,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/components/shared/nzoko-use-api";
import { NzokoEmptyState } from "@/components/shared/nzoko-empty-state";
import { NzokoErrorBox } from "@/components/shared/nzoko-error-box";
import { formatDuration, todayCongoISO } from "@/components/shared/nzoko-format";
import { api, ApiClientError } from "@/lib/api-client";
import {
  TRACKING_SESSION_STATUS_LABELS, TRIP_STATUS_COLORS, TRIP_STATUS_LABELS, type TripStatus,
} from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import { useDriverGps, type GpsStatus } from "@/hooks/use-driver-gps";
import type { DriverTripDTO, TrackingSessionDTO } from "@/types";
import { cn } from "@/lib/utils";

// ---------- Badges d'état (contrastes AA, pas de bleu/indigo) ----------

const GPS_BADGES: Record<GpsStatus, { label: string; className: string }> = {
  idle: { label: "GPS : EN ATTENTE", className: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  requesting: { label: "GPS : RECHERCHE…", className: "animate-pulse border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
  active: { label: "GPS : ACTIF", className: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300" },
  denied: { label: "GPS : REFUSÉ", className: "border-red-300 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300" },
  unavailable: { label: "GPS : INDISPONIBLE", className: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300" },
  stopped: { label: "GPS : STOPPÉ", className: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300" },
};

// ---------- Petits helpers ----------

/** "il y a 8 s" / "il y a 3 min" — horloge pilotée par le ticker du panneau. */
function secondsAgoLabel(epochMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.floor(m / 60)} h`;
}

function tripStatusBadge(status: string): { label: string; className: string } {
  return {
    label: TRIP_STATUS_LABELS[status as TripStatus] ?? status,
    className: TRIP_STATUS_COLORS[status as TripStatus] ?? "",
  };
}

const fadeUp = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

// ---------- Blocs locaux ----------

function StatCell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl border bg-muted/40 p-2 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-bold leading-tight tabular-nums">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

function StatusBanner({ tone, icon: Icon, children }: { tone: "amber" | "red"; icon: typeof WifiOff; children: React.ReactNode }) {
  return (
    <motion.div {...fadeUp} role="status">
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-xl border p-3 text-xs font-medium",
          tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </motion.div>
  );
}

// ============================================================
// PANNEAU PRINCIPAL
// ============================================================

export default function DriverTrackingPanel() {
  const { session: user } = useApp();

  // Session GPS (ACTIVE / PAUSED, ou ENDED < 1 h → résumé de clôture).
  const sessionApi = useApiData(() => api.tracking.session(), { autoRefreshMs: 30_000 });
  const tracking: TrackingSessionDTO | null = sessionApi.data;

  // Voyages du chauffeur (sélecteur de départ).
  const tripsApi = useApiData(() => api.driver.trips(), { autoRefreshMs: 60_000 });

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [action, setAction] = useState<"start" | "pause" | "resume" | "stop" | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [permission, setPermission] = useState<"unknown" | "granted" | "prompt" | "denied">("unknown");
  const [nowTick, setNowTick] = useState(() => Date.now());

  const gps = useDriverGps({
    onFlushed: ({ sent, rejected }) => {
      const suffix = rejected > 0 ? ` (${rejected} refusée${rejected > 1 ? "s" : ""})` : "";
      toast.success(
        `${sent} position${sent > 1 ? "s" : ""} synchronisée${sent > 1 ? "s" : ""}${suffix}`,
      );
    },
    onConflict: (message) => {
      toast.error(message);
      sessionApi.reload();
    },
  });
  const { status: gpsStatus, startWatching, stopWatching } = gps;

  const hasLiveSession = tracking?.status === "ACTIVE" || tracking?.status === "PAUSED";
  const activeSessionId = tracking?.status === "ACTIVE" ? tracking.id : null;
  const endedRecently =
    tracking?.status === "ENDED" &&
    !!tracking.endedAt &&
    Date.now() - new Date(tracking.endedAt).getTime() < 60 * 60 * 1000;

  // ---------- Effets ----------

  const hasLastFix = gps.lastFix != null;

  // Horloge 1 s (âge de la dernière position, résumé de fin).
  useEffect(() => {
    if (!hasLastFix && !hasLiveSession) return;
    const t = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [hasLastFix, hasLiveSession]);

  // Autorisation GPS (encart « Autorisation de localisation nécessaire »).
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, []);

  // Réconciliation GPS ↔ session : rechargement de page en plein trajet →
  // le watch repart tout seul ; session terminée/pause → il s'arrête.
  useEffect(() => {
    if (action !== null) return; // une action pilote le GPS elle-même
    if (activeSessionId) {
      if (gpsStatus === "idle" || gpsStatus === "stopped") startWatching(activeSessionId);
    } else if (gpsStatus === "active" || gpsStatus === "requesting") {
      stopWatching();
    }
  }, [activeSessionId, action, gpsStatus, startWatching, stopWatching]);

  // Voyages démarrables : SCHEDULED, aujourd'hui d'abord.
  const candidateTrips = useMemo(() => {
    const today = todayCongoISO();
    const list = (tripsApi.data ?? []).filter((t) => t.status === "SCHEDULED");
    list.sort((a, b) => {
      const aToday = a.departureTime.slice(0, 10) === today;
      const bToday = b.departureTime.slice(0, 10) === today;
      if (aToday !== bToday) return aToday ? -1 : 1;
      return a.departureTime.localeCompare(b.departureTime);
    });
    return list;
  }, [tripsApi.data]);

  // Pré-sélection du prochain voyage (le chauffeur n'a qu'à appuyer).
  useEffect(() => {
    if (hasLiveSession || candidateTrips.length === 0) return;
    if (!candidateTrips.some((t) => t.id === selectedTripId)) {
      setSelectedTripId(candidateTrips[0].id);
    }
  }, [candidateTrips, selectedTripId, hasLiveSession]);

  const selectedTrip: DriverTripDTO | null = useMemo(
    () => candidateTrips.find((t) => t.id === selectedTripId) ?? null,
    [candidateTrips, selectedTripId],
  );

  // ---------- Actions ----------

  const handleStart = async () => {
    if (!selectedTrip) {
      toast.error("Sélectionnez d'abord un voyage à démarrer.");
      return;
    }
    setAction("start");
    try {
      // 1. Autorisation GPS AVANT de lancer le voyage.
      const granted = await gps.requestPermission();
      if (!granted) {
        toast.error("Veuillez autoriser la localisation pour démarrer le suivi.");
        return;
      }
      // 2. Démarrage côté serveur (201 → session ACTIVE + trip DEPARTED).
      const result = await api.tracking.start({ tripId: selectedTrip.id });
      gps.startWatching(result.sessionId);
      toast.success(result.message || "Suivi GPS démarré — bonne route !");
      setSelectedTripId(null);
      sessionApi.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible de démarrer le suivi. Réessayez.");
    } finally {
      setAction(null);
    }
  };

  const handlePause = async () => {
    setAction("pause");
    gps.stopWatching(); // positions interrompues immédiatement
    try {
      const result = await api.tracking.pause();
      toast.success(result.message || "Suivi en pause.");
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible de mettre le suivi en pause.");
    } finally {
      sessionApi.reload(); // la réconciliation relance le GPS si toujours ACTIVE
      setAction(null);
    }
  };

  const handleResume = async () => {
    setAction("resume");
    try {
      const result = await api.tracking.resume();
      gps.startWatching(result.sessionId);
      toast.success(result.message || "Suivi repris. Bonne route !");
      sessionApi.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible de reprendre le suivi.");
      sessionApi.reload();
    } finally {
      setAction(null);
    }
  };

  const handleStop = async () => {
    setAction("stop");
    try {
      // 1. Synchroniser la file offline AVANT la clôture (le batch
      //    serait refusé ensuite : session ENDED).
      await gps.flushNow();
      // 2. Arrêter le GPS local puis clore la session.
      gps.stopWatching();
      const result = await api.tracking.stop();
      toast.success(result.message || "Trajet terminé. Merci et bon repos !");
      sessionApi.reload();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Impossible de terminer le trajet.");
      sessionApi.reload();
    } finally {
      setAction(null);
      setConfirmStop(false);
    }
  };

  // ---------- Données d'affichage ----------

  const origin = tracking?.originCityName ?? selectedTrip?.originCityName;
  const destination = tracking?.destinationCityName ?? selectedTrip?.destinationCityName;
  const busLabel = tracking
    ? `${tracking.busFleetNumber ?? tracking.busRegistration}${tracking.busFleetNumber ? ` (${tracking.busRegistration})` : ""}`
    : selectedTrip
      ? `${selectedTrip.busRegistration} · ${selectedTrip.busModel}`
      : null;
  const tripCode = tracking?.tripCode ?? selectedTrip?.code ?? null;
  const shownStatus = tracking?.tripStatus ?? selectedTrip?.status ?? null;
  const statusBadge = shownStatus ? tripStatusBadge(shownStatus) : null;

  const lastFix = gps.lastFix;
  const speedLabel = lastFix?.speedKmh != null ? `${Math.round(lastFix.speedKmh)}` : "—";
  const accuracyLabel = lastFix?.accuracy != null ? `±${Math.round(lastFix.accuracy)}` : "—";
  const positionLabel = lastFix ? secondsAgoLabel(lastFix.recordedAt, nowTick) : "en attente…";

  // Résumé de fin (heure départ réelle, arrivée, durée).
  const endStart = tracking?.actualDepartureAt ?? tracking?.startedAt ?? null;
  const endArrival = tracking?.actualArrivalAt ?? tracking?.endedAt ?? null;
  const durationMin =
    endStart && endArrival
      ? Math.round((new Date(endArrival).getTime() - new Date(endStart).getTime()) / 60_000)
      : null;

  const actionPending = action !== null;
  const gpsBadge = GPS_BADGES[gpsStatus];
  const internetBadge = gps.online
    ? { label: "Internet : CONNECTÉ", icon: Wifi, className: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300" }
    : { label: "Internet : HORS LIGNE", icon: WifiOff, className: "border-red-300 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300" };

  // ---------- Rendu ----------

  return (
    <section aria-label="Suivi GPS du trajet" className="space-y-4">
      {/* ---------- En-tête état du trajet ---------- */}
      {sessionApi.loading && !tracking && !sessionApi.error ? (
        <div className="space-y-3" aria-busy="true" aria-label="Chargement du suivi">
          <Skeleton className="h-36 w-full rounded-2xl" />
          <Skeleton className="h-8 w-2/3 rounded-full" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
      ) : sessionApi.error && !tracking ? (
        // Hors ligne au premier chargement : l'UI reste utilisable (boutons,
        // badges, bannière offline) — le GPS continue de tourner/empiler.
        <NzokoErrorBox error={sessionApi.error} onRetry={sessionApi.reload} />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="space-y-3 p-4">
            {/* chauffeur + bus */}
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{user ? `${user.fullName} · ${user.roleLabel}` : "Chauffeur NZOKO"}</span>
              <span className="flex shrink-0 items-center gap-1">
                <BusFront className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono font-semibold text-foreground">{busLabel ?? "—"}</span>
              </span>
            </div>

            {/* code voyage + statuts */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="font-mono text-xs font-bold text-primary">{tripCode ?? "—"}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {tracking && (
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                    <Radio className="mr-1 h-3 w-3" aria-hidden="true" />
                    {TRACKING_SESSION_STATUS_LABELS[tracking.status]}
                  </Badge>
                )}
                {statusBadge && (
                  <Badge variant="outline" className={statusBadge.className}>{statusBadge.label}</Badge>
                )}
              </div>
            </div>

            {/* trajet */}
            <p className="flex flex-wrap items-center gap-1.5 text-lg font-bold leading-tight">
              <span>{origin ?? "—"}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>{destination ?? "—"}</span>
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Destination : {destination ?? "—"}
              {tracking?.destinationLatitude != null && tracking?.destinationLongitude != null && (
                <span className="font-mono text-[10px]">
                  ({tracking.destinationLatitude.toFixed(4)}, {tracking.destinationLongitude.toFixed(4)})
                </span>
              )}
            </p>
            {(tracking || selectedTrip) && (
              <p className="text-xs text-muted-foreground">
                Départ prévu{" "}
                {formatTime(tracking?.scheduledDeparture ?? selectedTrip?.departureTime ?? new Date())} → Arrivée prévue{" "}
                {formatTime(tracking?.scheduledArrival ?? selectedTrip?.estimatedArrivalTime ?? new Date())}
                {tracking && tracking.agencyName ? ` · ${tracking.agencyName}` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {sessionApi.error && tracking && (
        <StatusBanner tone="amber" icon={WifiOff}>
          Impossible de rafraîchir l&apos;état du trajet — affichage de la dernière position connue.
        </StatusBanner>
      )}

      {/* ---------- Badges GPS / Internet ---------- */}
      <div className="flex flex-wrap items-center gap-1.5" role="status" aria-label="État GPS et connexion">
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold", gpsBadge.className)}>
          <Signal className="h-3 w-3" aria-hidden="true" />
          {gpsBadge.label}
        </span>
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold", internetBadge.className)}>
          <internetBadge.icon className="h-3 w-3" aria-hidden="true" />
          {internetBadge.label}
        </span>
      </div>

      {/* ---------- Dernière position ---------- */}
      <div className="rounded-xl border bg-card p-3">
        <div className="grid grid-cols-3 gap-2">
          <StatCell label="Vitesse" value={speedLabel} unit="km/h" />
          <StatCell label="Précision" value={accuracyLabel} unit="m" />
          <StatCell label="Dernier point" value={positionLabel} />
        </div>
        <p className="mt-2 text-center font-mono text-[11px] text-muted-foreground" aria-live="polite">
          {lastFix
            ? `${lastFix.latitude.toFixed(5)}, ${lastFix.longitude.toFixed(5)}${gps.sentCount > 0 ? ` · ${gps.sentCount} position${gps.sentCount > 1 ? "s" : ""} envoyée${gps.sentCount > 1 ? "s" : ""}` : ""}`
            : "Position : en attente du signal GPS…"}
        </p>
      </div>

      {/* ---------- Bannières dynamiques ---------- */}
      <AnimatePresence>
        {hasLiveSession && tracking?.offRoute && (
          <StatusBanner key="offroute" tone="red" icon={TriangleAlert}>
            Vous êtes hors itinéraire. Vérifiez votre route — votre agence a été alertée.
          </StatusBanner>
        )}
        {!gps.online && (
          <StatusBanner key="offline" tone="amber" icon={WifiOff}>
            Connexion Internet interrompue. Vos positions seront synchronisées dès le retour du réseau.
            {gps.queuedCount > 0 && (
              <span className="ml-1 inline-flex items-center rounded-full bg-amber-200/70 px-1.5 py-0.5 font-bold tabular-nums dark:bg-amber-900/50">
                {gps.queuedCount} en attente
              </span>
            )}
          </StatusBanner>
        )}
        {gps.online && gps.queuedCount > 0 && (
          <StatusBanner key="sync" tone="amber" icon={Loader2}>
            <span className="inline-flex items-center gap-1.5">
              {gps.flushing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Synchronisation de {gps.queuedCount} position{gps.queuedCount > 1 ? "s" : ""} en attente…
            </span>
          </StatusBanner>
        )}
        {gps.statusMessage && (
          <StatusBanner key="gpsmsg" tone={gpsStatus === "denied" ? "red" : "amber"} icon={TriangleAlert}>
            {gps.statusMessage}
            {gpsStatus === "denied" && (
              <span className="mt-1 block text-[11px] font-normal opacity-90">
                Autorisez la localisation depuis l&apos;icône de sécurité dans la barre d&apos;adresse, puis réessayez.
              </span>
            )}
          </StatusBanner>
        )}
        {!hasLiveSession && permission !== "granted" && permission !== "unknown" && (
          <StatusBanner key="perm" tone="amber" icon={Info}>
            <span className="font-semibold">Autorisation de localisation nécessaire.</span>{" "}
            Au premier démarrage, votre navigateur demandera l&apos;accès à votre position : choisissez
            « Autoriser », le suivi GPS en dépend.
          </StatusBanner>
        )}
      </AnimatePresence>

      {/* ---------- Actions (gros boutons ≥ 56 px) ---------- */}
      {hasLiveSession ? (
        <motion.div key="live" {...fadeUp} className="space-y-2">
          {tracking?.status === "ACTIVE" ? (
            <Button
              size="lg"
              disabled={actionPending}
              onClick={handlePause}
              aria-label="Mettre le suivi du trajet en pause"
              className="h-14 w-full bg-orange-600 text-base font-bold text-white hover:bg-orange-500"
            >
              {action === "pause" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Pause className="h-5 w-5" aria-hidden="true" />}
              ⏸ PAUSE
            </Button>
          ) : (
            <Button
              size="lg"
              disabled={actionPending}
              onClick={handleResume}
              aria-label="Reprendre le suivi du trajet"
              className="h-14 w-full text-base font-bold"
            >
              {action === "resume" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
              ▶ REPRENDRE
            </Button>
          )}
          {tracking?.status === "PAUSED" && (
            <p className="text-center text-xs text-muted-foreground" role="status">
              Suivi en pause — vos positions ne sont pas envoyées.
            </p>
          )}
          <Button
            size="lg"
            variant="destructive"
            disabled={actionPending}
            onClick={() => setConfirmStop(true)}
            aria-label="Terminer le trajet et arrêter le suivi GPS"
            className="h-14 w-full text-base font-bold"
          >
            <Flag className="h-5 w-5" aria-hidden="true" />
            🏁 TERMINER LE TRAJET
          </Button>
        </motion.div>
      ) : (
        <motion.div key="start" {...fadeUp} className="space-y-3">
          {/* Résumé du trajet qui vient de se terminer (< 1 h) */}
          {endedRecently && tracking && (
            <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-bold">Voyage terminé</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {tracking.tripCode} · {tracking.originCityName} → {tracking.destinationCityName}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-background/70 p-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Départ réel</p>
                    <p className="text-sm font-bold tabular-nums">
                      {tracking.actualDepartureAt ? formatTime(tracking.actualDepartureAt) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-background/70 p-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Arrivée</p>
                    <p className="text-sm font-bold tabular-nums">
                      {endArrival ? formatTime(endArrival) : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-background/70 p-2">
                    <p className="text-[10px] uppercase text-muted-foreground">Durée</p>
                    <p className="text-sm font-bold tabular-nums">
                      {durationMin != null ? formatDuration(durationMin) : "—"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Trajet clôturé et transmis à votre agence. Bon repos !
                </p>
              </CardContent>
            </Card>
          )}

          {/* Sélecteur de voyage (SCHEDULED, aujourd'hui d'abord) */}
          <div aria-label="Sélection du voyage à démarrer">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BusFront className="h-4 w-4" aria-hidden="true" />
              Voyage à démarrer
            </p>
            {tripsApi.loading && !tripsApi.data ? (
              <div className="space-y-2" aria-busy="true" aria-label="Chargement des voyages">
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            ) : tripsApi.error ? (
              <NzokoErrorBox error={tripsApi.error} onRetry={tripsApi.reload} />
            ) : candidateTrips.length === 0 ? (
              <NzokoEmptyState
                icon={BusFront}
                title="Aucun voyage à démarrer"
                description="Vos voyages planifiés apparaîtront ici dès qu'une agence vous en assignera un."
              />
            ) : (
              <RadioGroup
                value={selectedTripId ?? ""}
                onValueChange={(v) => setSelectedTripId(v || null)}
                aria-label="Choisir le voyage à démarrer"
                className="space-y-2"
              >
                {candidateTrips.map((trip) => {
                  const tripBadge = tripStatusBadge(trip.status);
                  const isSelected = selectedTripId === trip.id;
                  return (
                    <label
                      key={trip.id}
                      className={cn(
                        "block cursor-pointer rounded-xl border p-3 transition-colors",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <RadioGroupItem
                          value={trip.id}
                          className="mt-0.5"
                          aria-label={`Voyage ${trip.code} de ${trip.originCityName} à ${trip.destinationCityName}, départ ${formatTime(trip.departureTime)}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-primary">{trip.code}</span>
                            <Badge variant="outline" className={cn("text-[10px]", tripBadge.className)}>
                              {tripBadge.label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-sm font-semibold">
                            {trip.originCityName} → {trip.destinationCityName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(trip.departureTime)} · {formatTime(trip.departureTime)} →{" "}
                            {formatTime(trip.estimatedArrivalTime)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {trip.busRegistration} · {trip.busModel}
                          </p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            )}
          </div>

          {/* DÉMARRER */}
          <Button
            size="lg"
            disabled={actionPending || !selectedTrip}
            onClick={handleStart}
            aria-label="Démarrer le trajet sélectionné avec le suivi GPS"
            className="h-14 w-full text-base font-bold"
          >
            {action === "start" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <BusFront className="h-5 w-5" aria-hidden="true" />}
            🚌 DÉMARRER LE TRAJET
          </Button>
        </motion.div>
      )}

      {/* ---------- Confirmation de fin ---------- */}
      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminer le trajet ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                Le suivi GPS sera arrêté et le voyage
                {tracking ? ` « ${tracking.originCityName} → ${tracking.destinationCityName} »` : ""}{" "}
                sera marqué comme terminé. Les positions encore en attente seront synchronisées avant
                la clôture. Cette action est définitive.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={action === "stop"}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={action === "stop"}
              onClick={(e) => {
                e.preventDefault(); // on garde le dialog ouvert pendant l'appel
                void handleStop();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {action === "stop" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Terminer le trajet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
