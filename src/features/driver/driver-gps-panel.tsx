"use client";

// ============================================================
// NZOKO TRANSPORT — Panneau GPS du chauffeur (mobile-first 320px)
// Démarrage/arrêt du suivi, état du signal, file offline, voyage
// rattaché. Réconciliation : rechargement en plein trajet → la
// session est relue et le watch repart automatiquement.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Battery, BatteryLow, BatteryWarning, BusFront, CheckCircle2, ExternalLink, Gauge, Info, Loader2, MapPin, Navigation, Pause, Play, Satellite, ShieldAlert, Signal, SignalHigh, SignalZero, Square, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { getDeviceId } from "@/lib/device-id";
import { cn } from "@/lib/utils";
import { useDriverGps } from "@/hooks/use-driver-gps";
import {
  diagnoseGeoBlock,
  queryGeoPermission,
  requestGeolocation,
  type GeoBlockDiagnosis,
  type GeoPermissionState,
} from "@/lib/geo-permissions";
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

/** Rendu batterie (V4) : niveau + icône + ton selon le pourcentage —
 *  ≥ 50 % normal, 20–49 % vigilance (ambre), < 20 % critique (rouge,
 *  doublé du bandeau d'alerte dédié plus bas). */
function batteryVisual(level: number): { level: number; icon: typeof Battery; tone: string } {
  if (level < 20) return { level, icon: BatteryLow, tone: "text-red-600 dark:text-red-400" };
  if (level < 50) return { level, icon: BatteryWarning, tone: "text-amber-600 dark:text-amber-400" };
  return { level, icon: Battery, tone: "" };
}

/** Diagnostic de repli quand le navigateur n'expose même pas l'API
 *  geolocation (certains navigateurs intégrés / webviews anciens). */
const GEO_UNAVAILABLE_BLOCK: GeoBlockDiagnosis = {
  reason: "unsupported",
  title: "Géolocalisation indisponible",
  steps: [
    "Ce navigateur n’expose pas l’API de géolocalisation — aucun site ne peut y obtenir votre position.",
    "Ouvrez NZOKO depuis un Chrome ou Safari récent, puis redémarrez le suivi.",
  ],
  canOpenNewTab: false,
};

export function DriverGpsPanel({ trips }: { trips: DriverTripDTO[] }) {
  const [session, setSession] = useState<TrackingSessionDTO | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [tripId, setTripId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  /** V5 (§41) — le bouton TERMINER demande CONFIRMATION. */
  const [confirmStop, setConfirmStop] = useState(false);
  /** Refus persistant de la permission : on mémorise le DIAGNOSTIC
   *  (cause exacte du blocage + étapes adaptées à la plateforme) — le
   *  bandeau guide l'utilisateur jusqu'à ce qu'il agisse. */
  const [deniedBlock, setDeniedBlock] = useState<GeoBlockDiagnosis | null>(null);
  /** État de la permission AU REPOS (Permissions API, sans popup) :
   *  dit à l'utilisateur à quoi s'attendre AVANT de cliquer — notamment
   *  qu'une popup d'autorisation va apparaître au premier démarrage. */
  const [permissionHint, setPermissionHint] = useState<GeoPermissionState | null>(null);
  const sessionRef = useRef<TrackingSessionDTO | null>(null);
  sessionRef.current = session;

  const onConflict = useCallback((message: string) => {
    toast.warning(message);
    setSession(null);
  }, []);

  const gps = useDriverGps({ sessionId: session?.id ?? null, onConflict });

  // V4 — batterie du téléphone exposée par le hook (null = inconnue,
  // ex. iOS Safari → ligne et alerte cachées).
  const battery = gps.batteryLevel === null ? null : batteryVisual(gps.batteryLevel);

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

  // État de la permission AU REPOS (lecture pure, JAMAIS de popup) :
  //  - « déjà accordée » → le chauffeur est rassuré, zéro friction ;
  //  - « à demander »   → on PRÉVIENT qu'une popup navigateur va
  //    apparaître au démarrage (l'utilisateur comprend qu'il faut
  //    choisir « Autoriser » et ne rate pas la demande) ;
  //  - « refusée »       → le bandeau de guidance s'affiche d'office.
  // Requête à chaque retour à l'écran de démarrage (après un arrêt de
  // session, l'état peut avoir changé côté navigateur).
  useEffect(() => {
    if (loadingSession || session) return;
    let cancelled = false;
    queryGeoPermission()
      .then((state) => {
        if (!cancelled) setPermissionHint(state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loadingSession, session]);

  // §44 — le compteur « Points enregistrés » vient de l'état serveur
  // (pointsCount) : il est figé à sa valeur de démarrage tant qu'on ne
  // le rafraîchit pas. Après CHAQUE envoi réussi (lastSentAt change),
  // on relit la session (GET léger) et on remet à jour le compteur —
  // et par la même occasion le statut (pause/reprise/fin côté serveur).
  const lastSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!gps.lastSentAt || gps.lastSentAt === lastSentRef.current) return;
    lastSentRef.current = gps.lastSentAt;
    const current = sessionRef.current;
    if (!current || current.status !== "ACTIVE") return;
    let cancelled = false;
    (async () => {
      try {
        const fresh = await api.tracking.session();
        // La session serveur peut avoir changé (fin watchdog) : on ne
        // remplace QUE la même session — le conflit éventuel est déjà
        // géré par la voie normale (409/404 à l'envoi suivant).
        if (!cancelled && fresh && fresh.id === current.id) setSession(fresh);
      } catch {
        // Best-effort : le compteur se rafraîchira au prochain envoi.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gps.lastSentAt]);

  // Diagnostic ACTIF du blocage localisation : celui mémorisé après un
  // clic refusé, sinon recalculé si le watch GPS a reçu un refus, ou si
  // la permission est connue comme refusée AU REPOS (guidance immédiate
  // sans attendre le clic) — UNIQUEMENT hors session démarrée : une
  // session active (permission accordée depuis) ne doit plus l'afficher.
  const activeBlock = useMemo<GeoBlockDiagnosis | null>(() => {
    if (deniedBlock) return deniedBlock;
    // Refus reçu par le watch GPS (réconciliation auto au rechargement
    // d'une session en cours, révocation en plein trajet…).
    if (gps.status === "denied") return diagnoseGeoBlock();
    if (!session && permissionHint === "denied") return diagnoseGeoBlock();
    return null;
  }, [deniedBlock, gps.status, session, permissionHint]);

  // Voyages du jour (rattachement du suivi).
  const todayTrips = useMemo(() => {
    const today = todayCongoISO();
    return trips.filter((t) => t.departureTime.slice(0, 10) === today);
  }, [trips]);

  /** Création de la session + démarrage du watch (après autorisation). */
  const beginSession = useCallback(async () => {
    const created = await api.tracking.start({
      tripId: tripId === "none" ? null : tripId,
      // V5 (§6) — le téléphone est identifié par un UUID stable
      // (localStorage), indépendant du compte chauffeur.
      deviceId: getDeviceId(),
    });
    setSession(created);
    gps.startWatching();
    toast.success("Suivi GPS démarré. Bonne route !");
  }, [tripId, gps]);

  const startSession = useCallback(async () => {
    setBusy(true);
    try {
      // V6 — requestGeolocation appelle getCurrentPosition AVANT tout
      // await : le geste du clic reste actif (exigence Safari iOS pour
      // afficher la popup d'autorisation).
      const outcome = await requestGeolocation();
      if (!outcome.granted) {
        const block = outcome.block ?? GEO_UNAVAILABLE_BLOCK;
        setDeniedBlock(block);
        // Guidance précise et adaptée à la CAUSE (page http, aperçu,
        // navigateur d'appli, refus mémorisé) au lieu d'un échec muet.
        toast.error(block.title, {
          description: block.steps.slice(0, 2).join(" "),
          duration: 12000,
        });
        return;
      }
      // Autorisation obtenue → tout diagnostic obsolète disparaît
      // (l'ancien bandeau de refus ne doit pas survivre au démarrage).
      setDeniedBlock(null);
      await beginSession();
    } catch (error) {
      toast.error((error as Error).message ?? "Impossible de démarrer le suivi.");
    } finally {
      setBusy(false);
    }
  }, [beginSession]);

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
      setConfirmStop(false);
    }
  }, [gps]);

  // Réessai après refus/indisponibilité : l'utilisateur vient d'autoriser
  // la localisation dans le navigateur → on repart sans créer de doublon
  // (session existante = simple reprise du watch, sinon démarrage complet).
  const retryPermission = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await requestGeolocation();
      if (!outcome.granted) {
        const block = outcome.block ?? GEO_UNAVAILABLE_BLOCK;
        setDeniedBlock(block);
        toast.error(block.title, {
          description: block.steps.slice(0, 2).join(" "),
          duration: 12000,
        });
        return;
      }
      setDeniedBlock(null);
      if (sessionRef.current?.status === "ACTIVE") {
        gps.startWatching();
        toast.success("Suivi GPS rétabli.");
      } else {
        await beginSession();
      }
    } catch (error) {
      toast.error((error as Error).message ?? "Action impossible.");
    } finally {
      setBusy(false);
    }
  }, [beginSession, gps]);

  /** Ouvre la page HORS du cadre intégré (aperçu/iframe) : la popup
   *  d'autorisation du navigateur ne s'affiche que dans une page
   *  autonome de premier niveau. */
  const openStandalone = useCallback(() => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  }, []);

  const activeTrip = todayTrips.find((t) => t.id === tripId);

  // V5 (§41) — voyants d'état : GPS / Internet / Synchronisation.
  const gpsActive = gps.status === "active";
  const gpsStale = gpsActive && gps.positionFresh === false; // téléphone OK, GPS silencieux
  const internetOk = gps.online;
  const syncOk = gpsActive && internetOk && gps.queued === 0 && gps.lastSentAt !== null;

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
          <div className="mt-3 space-y-2">
            {/* V5 (§41) — voyants GPS / Internet / Synchronisation */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className={cn("rounded-lg border px-2 py-2", gpsActive ? (gpsStale ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40" : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40") : "border-border bg-muted/60")}>
                {gpsActive ? gpsStale ? <Signal className="mx-auto h-4 w-4 text-amber-600" aria-hidden /> : <SignalHigh className="mx-auto h-4 w-4 text-emerald-600" aria-hidden /> : <SignalZero className="mx-auto h-4 w-4 text-muted-foreground" aria-hidden />}
                <p className="mt-1 text-[11px] font-semibold">GPS</p>
                <p className="text-[10px] text-muted-foreground">{gpsActive ? (gpsStale ? "Silencieux" : "Actif") : "Inactif"}</p>
              </div>
              <div className={cn("rounded-lg border px-2 py-2", internetOk ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40")}>
                {internetOk ? <Wifi className="mx-auto h-4 w-4 text-emerald-600" aria-hidden /> : <WifiOff className="mx-auto h-4 w-4 text-red-600" aria-hidden />}
                <p className="mt-1 text-[11px] font-semibold">Internet</p>
                <p className="text-[10px] text-muted-foreground">{internetOk ? "Connecté" : "Hors ligne"}</p>
              </div>
              <div className={cn("rounded-lg border px-2 py-2", syncOk ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40" : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40")}>
                <Satellite className={cn("mx-auto h-4 w-4", syncOk ? "text-emerald-600" : "text-amber-600")} aria-hidden />
                <p className="mt-1 text-[11px] font-semibold">Position</p>
                <p className="text-[10px] text-muted-foreground">{gps.queued > 0 ? `${gps.queued} en file` : gps.lastSentAt ? "Synchronisée" : "En attente"}</p>
              </div>
            </div>
            {gps.lastSentAt && (
              <p className="text-center text-[11px] text-muted-foreground">
                Dernière synchronisation : {formatTime(gps.lastSentAt)}
                {gps.lastHeartbeatAt ? ` · lien serveur : ${formatTime(gps.lastHeartbeatAt)}` : ""}
              </p>
            )}
            <div className="grid gap-2 text-sm">
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
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Démarrez le suivi avant de prendre la route — la position du car est transmise aux équipes NZOKO.
          </p>
        )}

        {/* V4 — batterie du téléphone : visible uniquement pendant le suivi
            actif, cachée si le niveau est inconnu (ex. iOS Safari). */}
        {gps.status === "active" && battery && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <battery.icon className="h-4 w-4" aria-hidden="true" />
              Batterie du téléphone
            </span>
            <span className={cn("font-semibold", battery.tone)}>{battery.level} %</span>
          </div>
        )}

        {/* V4 — batterie faible (< 20 %) : bandeau discret, AUCUN toast
            répété — uniquement tant que le suivi est actif. */}
        {gps.status === "active" && battery && battery.level < 20 && (
          <div
            className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            role="alert"
          >
            <BatteryLow className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Batterie faible ({battery.level} %) — branchez votre téléphone, le suivi s&apos;arrête si la batterie
              tombe à zéro.
            </p>
          </div>
        )}

        {gps.message && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
            {gps.message}
          </p>
        )}

        {/* Localisation bloquée → DIAGNOSTIC de la CAUSE (page http://
            non sécurisée, aperçu intégré, navigateur d'appli, refus
            mémorisé) + étapes numérotées ADAPTÉES à la plateforme
            (desktop / Android / iOS) + actions concrètes. Le navigateur
            ne ré-affiche JAMAIS la popup après un refus mémorisé ni dans
            un cadre intégré — sans ce diagnostic, l'utilisateur est
            bloqué sans comprendre pourquoi. */}
        {(gps.status === "unavailable" || activeBlock) && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 dark:border-red-900 dark:bg-red-950/40" role="alert">
            <p className="flex items-start gap-1.5 text-xs font-semibold text-red-800 dark:text-red-300">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {activeBlock ? activeBlock.title : "GPS indisponible"}
            </p>
            {activeBlock ? (
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-red-700 dark:text-red-300">
                {activeBlock.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                Vérifiez que le GPS de votre appareil est activé, puis réessayez.
              </p>
            )}
            <div className={cn("mt-3 grid gap-2", activeBlock?.canOpenNewTab ? "sm:grid-cols-2" : "")}>
              {activeBlock?.canOpenNewTab && (
                <Button
                  onClick={openStandalone}
                  variant="outline"
                  className="min-h-[40px] h-9 w-full text-xs"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Ouvrir dans un nouvel onglet
                </Button>
              )}
              <Button
                onClick={() => void retryPermission()}
                disabled={busy}
                variant="outline"
                className="min-h-[40px] h-9 w-full text-xs"
              >
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Satellite className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                Réessayer la localisation
              </Button>
            </div>
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
              Voyage rattaché (aujourd&apos;hui)
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
            {/* Attente AVANT le clic : l'utilisateur sait ce qui va se
                passer (popup navigateur à autoriser / déjà autorisé /
                refus mémorisé à réactiver) — il ne rate plus la demande. */}
            {permissionHint === "granted" && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400" role="status">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Localisation déjà autorisée sur ce navigateur — le suivi démarrera directement.
              </p>
            )}
            {permissionHint === "prompt" && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Au premier démarrage, votre navigateur demandera l&apos;autorisation de localisation : gardez cette page
                ouverte et choisissez « Autoriser ».
              </p>
            )}
            {permissionHint === "denied" && (
              <p className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400" role="status">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Localisation actuellement refusée — suivez les étapes de l&apos;encadré ci-dessus pour la réactiver, puis
                « Réessayer la localisation ».
              </p>
            )}
          </div>
        )}

        {session?.status === "ACTIVE" && (
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={pauseSession} disabled={busy} variant="outline" className="min-h-[48px]">
              <Pause className="mr-2 h-4 w-4" aria-hidden="true" />
              Pause
            </Button>
            <Button onClick={() => setConfirmStop(true)} disabled={busy} variant="destructive" className="min-h-[48px]">
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
            <Button onClick={() => setConfirmStop(true)} disabled={busy} variant="destructive" className="min-h-[48px]">
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
          Le suivi s&apos;adapte à votre vitesse (envoi toutes les {Math.round(gps.intervals.activeIntervalMs / 1000)} s en
          mouvement, {Math.round(gps.intervals.idleIntervalMs / 1000)} s au ralenti et{" "}
          {Math.round(gps.intervals.stoppedIntervalMs / 1000)} s à l&apos;arrêt) et continue de fonctionner sans réseau —
          les positions manquantes sont envoyées automatiquement à votre retour en ligne.
        </p>
      </div>

      {/* V5 (§41) — confirmation obligatoire avant d'arrêter le suivi. */}
      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminer le suivi GPS ?</AlertDialogTitle>
            <AlertDialogDescription>
              La position du car ne sera plus transmise au centre de contrôle. Cette action met fin à la session de
              suivi du voyage en cours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer le suivi</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void stopSession();
              }}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? "Arrêt…" : "Oui, terminer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
