"use client";

// ============================================================
// NZOKO TRANSPORT — Panneau GPS du chauffeur (mobile-first 320px)
// Démarrage/arrêt du suivi, état du signal, file offline, voyage
// rattaché. Réconciliation : rechargement en plein trajet → la
// session est relue et le watch repart automatiquement.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BusFront, Gauge, Loader2, MapPin, Navigation, Pause, Play, Satellite, Square, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { useDriverGps, requestGpsPermission } from "@/hooks/use-driver-gps";
import { geoDeniedMessage } from "@/lib/geo-permissions";
import { todayCongoISO } from "@/components/shared/nzoko-format";
import { formatTime } from "@/lib/format";
import { TRACKING_STATUS_LABELS } from "@/lib/constants";
import type { DriverTripDTO, TrackingSessionDTO } from "@/types";

const STATUS_STYLES: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-100 text-emerald-800",
  idle: "border-border bg-muted text-muted-foreground",
  requesting: "border-amber-300 bg-amber-100 text-amber-800",
  denied: "border-red-300 bg-red-100 text-red-800",
  unavailable: "border-red-300 bg-red-100 text-red-800",
  stopped: "border-border bg-muted text-muted-foreground",
};
const STATUS_LABELS: Record<string, string> = {
  active: "Suivi actif",
  idle: "Inactif",
  requesting: "Demande…",
  denied: "Permission refusée",
  unavailable: "GPS indisponible",
  stopped: "Arrêté",
};

export function DriverGpsPanel({ trips }: { trips: DriverTripDTO[] }) {
  const [session, setSession] = useState<TrackingSessionDTO | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [tripId, setTripId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  /** Refus persistant de la permission au démarrage (le toast est
   *  éphémère — le bandeau guide l'utilisateur jusqu'à ce qu'il agisse). */
  const [permissionDenied, setPermissionDenied] = useState(false);
  const sessionRef = useRef<TrackingSessionDTO | null>(null);
  sessionRef.current = session;

  const onConflict = useCallback((message: string) => {
    toast.warning(message);
    setSession(null);
  }, []);

  const gps = useDriverGps({ sessionId: session?.id ?? null, onConflict });

  // Réconciliation initiale : session vivante ? → le watch repart.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await api.tracking.session();
        if (cancelled) return;
        setSession(current);
        if (current?.trip) setTripId(current.trip.id);
        if (current?.status === "ACTIVE") gps.startWatching();
      } catch {
        // Silencieux — l'état « aucune session » est légitime.
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // gps.startWatching est stable (useCallback) ; la réconciliation ne
    // doit tourner qu'au montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voyages du jour (rattachement du suivi).
  const todayTrips = useMemo(() => {
    const today = todayCongoISO();
    return trips.filter((t) => t.departureTime.slice(0, 10) === today);
  }, [trips]);

  const startSession = useCallback(async () => {
    setBusy(true);
    try {
      const granted = await requestGpsPermission();
      if (!granted) {
        setPermissionDenied(true);
        // Guidance précise au lieu d'un échec muet : l'utilisateur sait
        // EXACTEMENT où cliquer pour autoriser la localisation.
        toast.error("La localisation est refusée.", {
          description: geoDeniedMessage(),
          duration: 10000,
        });
        return;
      }
      const created = await api.tracking.start(tripId === "none" ? {} : { tripId });
      setSession(created);
      gps.startWatching();
      toast.success("Suivi GPS démarré. Bonne route !");
    } catch (error) {
      toast.error((error as Error).message ?? "Impossible de démarrer le suivi.");
    } finally {
      setBusy(false);
    }
  }, [tripId, gps]);

  const pauseSession = useCallback(async () => {
    setBusy(true);
    try {
      const updated = await api.tracking.pause();
      setSession(updated);
      gps.stopWatching();
      toast.info("Suivi en pause — reprenez au départ.");
    } catch (error) {
      toast.error((error as Error).message ?? "Action impossible.");
    } finally {
      setBusy(false);
    }
  }, [gps]);

  const resumeSession = useCallback(async () => {
    setBusy(true);
    try {
      const updated = await api.tracking.resume();
      setSession(updated);
      gps.startWatching();
      toast.success("Suivi repris.");
    } catch (error) {
      toast.error((error as Error).message ?? "Action impossible.");
    } finally {
      setBusy(false);
    }
  }, [gps]);

  const stopSession = useCallback(async () => {
    setBusy(true);
    try {
      await api.tracking.stop();
      setSession(null);
      gps.stopWatching();
      toast.success("Suivi terminé — positions enregistrées.");
    } catch (error) {
      toast.error((error as Error).message ?? "Action impossible.");
    } finally {
      setBusy(false);
    }
  }, [gps]);

  // Réessai après refus/indisponibilité : l'utilisateur vient d'autoriser
  // la localisation dans le navigateur → on repart sans créer de doublon
  // (session existante = simple reprise du watch, sinon démarrage complet).
  const retryPermission = useCallback(async () => {
    const granted = await requestGpsPermission();
    if (!granted) {
      setPermissionDenied(true);
      toast.error("La localisation est toujours refusée.", {
        description: geoDeniedMessage(),
        duration: 10000,
      });
      return;
    }
    setPermissionDenied(false);
    if (sessionRef.current?.status === "ACTIVE") {
      gps.startWatching();
      toast.success("Suivi GPS rétabli.");
    } else {
      await startSession();
    }
  }, [gps, startSession]);

  const activeTrip = todayTrips.find((t) => t.id === tripId);

  return (
    <div className="space-y-4">
      {/* ---- Carte d'état ---- */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Satellite className="h-4 w-4" aria-hidden="true" />
            État du suivi
          </h3>
          <Badge variant="outline" className={STATUS_STYLES[gps.status] ?? ""}>
            {STATUS_LABELS[gps.status] ?? gps.status}
          </Badge>
        </div>

        {loadingSession ? (
          <div className="flex items-center justify-center py-6" role="status" aria-label="Lecture de la session…">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          </div>
        ) : session ? (
          <div className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-muted-foreground">Session</span>
              <span className="font-semibold">{TRACKING_STATUS_LABELS[session.status] ?? session.status}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-muted-foreground">Voyage</span>
              <span className="font-semibold">
                {session.trip
                  ? `${session.trip.originCityName} → ${session.trip.destinationCityName}`
                  : "Hors voyage"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-muted-foreground">Points enregistrés</span>
              <span className="font-semibold">{session.pointsCount}</span>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Démarrez le suivi avant de prendre la route — la position du car est transmise aux équipes NZOKO.
          </p>
        )}

        {gps.message && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
            {gps.message}
          </p>
        )}

        {/* Permission refusée / GPS indisponible → guidance pas-à-pas +
            bouton Réessayer (le navigateur ne ré-affiche JAMAIS la popup
            après un refus : il faut passer par ses réglages). */}
        {(gps.status === "denied" || gps.status === "unavailable" || permissionDenied) && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 dark:border-red-900 dark:bg-red-950/40" role="alert">
            <p className="text-xs font-semibold text-red-800 dark:text-red-300">
              {gps.status === "unavailable" ? "GPS indisponible" : "Localisation bloquée"}
            </p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-300">
              {gps.status === "unavailable"
                ? "Vérifiez que le GPS de votre appareil est activé, puis réessayez."
                : geoDeniedMessage()}
            </p>
            <Button
              onClick={() => void retryPermission()}
              disabled={busy}
              variant="outline"
              className="mt-2 min-h-[40px] h-9 w-full text-xs"
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Satellite className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Réessayer la localisation
            </Button>
          </div>
        )}

        {/* Lecture en direct */}
        {gps.reading && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/60 px-2 py-2">
              <MapPin className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
              <p className="mt-1 text-[11px] text-muted-foreground">Précision</p>
              <p className="text-sm font-bold">
                {gps.reading.accuracy !== null ? `± ${Math.round(gps.reading.accuracy)} m` : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-2 py-2">
              <Gauge className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
              <p className="mt-1 text-[11px] text-muted-foreground">Vitesse</p>
              <p className="text-sm font-bold">
                {gps.reading.speed !== null ? `${Math.round(gps.reading.speed)} km/h` : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/60 px-2 py-2">
              <Navigation className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
              <p className="mt-1 text-[11px] text-muted-foreground">Dernier envoi</p>
              <p className="text-sm font-bold">{gps.lastSentAt ? formatTime(gps.lastSentAt) : "—"}</p>
            </div>
          </div>
        )}

        {/* File offline */}
        {gps.queued > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            {gps.queued} point{gps.queued > 1 ? "s" : ""} en attente — envoi automatique au retour du réseau.
          </div>
        )}
      </div>

      {/* ---- Commandes ---- */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        {!session && (
          <div className="space-y-3">
            <label htmlFor="gps-trip" className="block text-sm font-medium">
              Voyage rattaché (aujourd’hui)
            </label>
            <Select value={tripId} onValueChange={setTripId}>
              <SelectTrigger id="gps-trip" className="min-h-[44px] w-full">
                <SelectValue placeholder="Choisir un voyage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Hors voyage (repositionnement)</SelectItem>
                {todayTrips.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.originCityName} → {t.destinationCityName} · {formatTime(t.departureTime)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTrip && (
              <p className="text-xs text-muted-foreground">
                Car {activeTrip.busRegistration} · {activeTrip.passengers.length} passager{activeTrip.passengers.length > 1 ? "s" : ""} à bord
              </p>
            )}
            <Button onClick={startSession} disabled={busy} className="min-h-[48px] w-full">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="mr-2 h-4 w-4" aria-hidden="true" />}
              Démarrer le suivi
            </Button>
          </div>
        )}

        {session?.status === "ACTIVE" && (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={pauseSession} disabled={busy} variant="outline" className="min-h-[48px]">
              <Pause className="mr-2 h-4 w-4" aria-hidden="true" />
              Pause
            </Button>
            <Button onClick={stopSession} disabled={busy} variant="destructive" className="min-h-[48px]">
              <Square className="mr-2 h-4 w-4" aria-hidden="true" />
              Arrêter
            </Button>
          </div>
        )}

        {session?.status === "PAUSED" && (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={resumeSession} disabled={busy} className="min-h-[48px]">
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />
              Reprendre
            </Button>
            <Button onClick={stopSession} disabled={busy} variant="destructive" className="min-h-[48px]">
              <Square className="mr-2 h-4 w-4" aria-hidden="true" />
              Terminer
            </Button>
          </div>
        )}
      </div>

      {/* ---- Aide ---- */}
      <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
        <BusFront className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Le suivi s’adapte à votre vitesse (envoi toutes les {8} s en mouvement, {30} s à l’arrêt) et continue de
          fonctionner sans réseau — les positions manquantes sont envoyées automatiquement à votre retour en ligne.
        </p>
      </div>
    </div>
  );
}
