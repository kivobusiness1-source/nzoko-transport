"use client";

// ============================================================
// NZOKO TRANSPORT — Hook de géolocalisation intelligent (chauffeur)
//
// Fréquence pilotée par la CONFIG SERVEUR (GET /api/tracking/config,
// chargée au démarrage du watch — une seule fois, best-effort ; repli
// sur les constantes TRACKING de src/lib/constants.ts) :
//   (a) ≥ activeIntervalMs  si vitesse ≥ stoppedSpeedKmh (en mouvement),
//   (b) ≥ idleIntervalMs    si vitesse > 0 sous le seuil (ralenti),
//   (c) ≥ stoppedIntervalMs si vitesse 0 ou inconnue (arrêté),
//   (d) JAMAIS < minSendIntervalMs (plancher anti-burst client).
// m/s → km/h (×3,6).
//
// Batterie (V4) : Battery Status API — best-effort, absente d'iOS
// Safari → null silencieux. Niveau exposé dans l'état (listener
// « levelchange ») et joint à CHAQUE point envoyé (location et
// batch : la file offline conserve le champ tel quel).
//
// Offline (navigator.onLine / fetch échoué / 5xx) → file IndexedDB.
// 409/404 → stopWatching + onConflict (session terminée/pause serveur).
// Réseau : listeners online/offline + flush auto au retour + retry 30 s
// si file non vide alors qu'on est en ligne.
// Réconciliation : rechargement de page en plein trajet → le watch
// repart dès que la session est relue par l'appelant.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { enqueue, flushQueue, pendingCount } from "@/lib/gps-queue";
import { TRACKING } from "@/lib/constants";
import { queryGeoPermission } from "@/lib/geo-permissions";
import type { GpsPointInput, TrackingConfigDTO } from "@/types";

export type GpsStatus = "idle" | "requesting" | "active" | "denied" | "unavailable" | "stopped";

export interface GpsReading {
  latitude: number;
  longitude: number;
  speed: number | null; // km/h
  heading: number | null;
  accuracy: number | null;
  altitude: number | null;
  recordedAt: string; // ISO original
}

export interface DriverGpsState {
  status: GpsStatus;
  message: string | null;
  reading: GpsReading | null;
  queued: number;
  lastSentAt: string | null;
  /** V4 — batterie du téléphone (0–100), null si inconnue
   *  (Battery Status API absente, ex. iOS Safari). */
  batteryLevel: number | null;
}

/** Intervalles d'envoi adaptatif résolus (config serveur, sinon TRACKING). */
export interface DriverGpsIntervals {
  /** En mouvement : vitesse ≥ stoppedSpeedKmh. */
  activeIntervalMs: number;
  /** Au ralenti : vitesse > 0 mais sous le seuil d'arrêt. */
  idleIntervalMs: number;
  /** À l'arrêt : vitesse 0 ou inconnue. */
  stoppedIntervalMs: number;
  /** Seuil km/h au-dessus duquel le car est considéré en mouvement. */
  stoppedSpeedKmh: number;
}

/** Défauts = constantes TRACKING. TRACKING ne définit pas de palier
 *  intermédiaire : sans config serveur, le ralenti hérite de la moyenne
 *  des paliers mouvement/arrêt (valeur intermédiaire qui reste conforme
 *  au garde-fou serveur sur la fréquence d'envoi). */
const DEFAULT_INTERVALS: DriverGpsIntervals = {
  activeIntervalMs: TRACKING.movingIntervalMs,
  idleIntervalMs: Math.round((TRACKING.movingIntervalMs + TRACKING.stoppedIntervalMs) / 2),
  stoppedIntervalMs: TRACKING.stoppedIntervalMs,
  stoppedSpeedKmh: TRACKING.stoppedSpeedKmh,
};

/** Extrait les intervalles de la config serveur — garde-fous best-effort
 *  champ par champ (valeur manquante/invalide → défaut TRACKING). */
function intervalsFromConfig(config: TrackingConfigDTO): DriverGpsIntervals {
  const positive = (value: number, fallback: number) => (Number.isFinite(value) && value > 0 ? value : fallback);
  const nonNegative = (value: number, fallback: number) => (Number.isFinite(value) && value >= 0 ? value : fallback);
  return {
    activeIntervalMs: positive(config.activeIntervalMs, DEFAULT_INTERVALS.activeIntervalMs),
    idleIntervalMs: positive(config.idleIntervalMs, DEFAULT_INTERVALS.idleIntervalMs),
    stoppedIntervalMs: positive(config.stoppedIntervalMs, DEFAULT_INTERVALS.stoppedIntervalMs),
    stoppedSpeedKmh: nonNegative(config.stoppedSpeedKmh, DEFAULT_INTERVALS.stoppedSpeedKmh),
  };
}

/** Palier d'envoi selon la vitesse (km/h) et les intervalles résolus :
 *  en mouvement (≥ seuil) / ralenti (> 0) / arrêté (0 — une vitesse
 *  inconnue est présumée nulle, comportement historique conservé). */
function sendIntervalMs(speedKmh: number, intervals: DriverGpsIntervals): number {
  if (speedKmh >= intervals.stoppedSpeedKmh) return intervals.activeIntervalMs;
  if (speedKmh > 0) return intervals.idleIntervalMs;
  return intervals.stoppedIntervalMs;
}

// ---------- Battery Status API (types locaux — API non standard) ----------
// Absente de lib.dom.d.ts et d'iOS Safari : indisponible → null
// silencieux, le suivi GPS fonctionne sans niveau de batterie connu.
interface BatteryManagerLike extends EventTarget {
  /** Niveau de charge 0–1 (pourcentage = ×100). */
  level: number;
  charging: boolean;
}
interface NavigatorWithBattery {
  getBattery?: () => Promise<BatteryManagerLike>;
}

/** Pourcentage 0–100 borné (null si manager indisponible). */
function batteryPercent(manager: BatteryManagerLike | null): number | null {
  if (!manager) return null;
  return Math.min(100, Math.max(0, Math.round(manager.level * 100)));
}

export interface UseDriverGpsOptions {
  sessionId: string | null;
  /** Conflit serveur (409/404) : l'appelant arrête sa session côté UI. */
  onConflict?: (message: string) => void;
}

/** Demande la permission via getCurrentPosition — false SEULEMENT sur refus
 *  explicite (bloque le démarrage) ; indisponible/timeout → départ autorisé
 *  (le GPS peut revenir en route). Réessai automatique sur timeout (premier
 *  fix GPS, surtout en intérieur), état de permission connu à l'avance. */
export async function requestGpsPermission(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return false;
  // Permission déjà refusée : le navigateur n'affichera plus de popup —
  // inutile de tenter un fix qui échouera instantanément.
  const permission = await queryGeoPermission();
  if (permission === "denied") return false;
  return new Promise((resolve) => {
    let retried = false;
    const attempt = (timeout: number) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        (err) => {
          if (err.code === err.TIMEOUT && !retried) {
            retried = true;
            attempt(30_000);
            return;
          }
          resolve(err.code !== err.PERMISSION_DENIED);
        },
        { enableHighAccuracy: true, timeout, maximumAge: 30_000 }
      );
    };
    attempt(15_000);
  });
}

export function useDriverGps({ sessionId, onConflict }: UseDriverGpsOptions) {
  const [state, setState] = useState<DriverGpsState>({
    status: "idle",
    message: null,
    reading: null,
    queued: 0,
    lastSentAt: null,
    batteryLevel: null,
  });
  /** Intervalles d'envoi résolus (TRACKING par défaut, config serveur dès
   *  qu'elle est chargée) — exposés au panneau pour le texte d'aide. */
  const [intervals, setIntervals] = useState<DriverGpsIntervals>(DEFAULT_INTERVALS);

  const watchIdRef = useRef<number | null>(null);
  const sessionRef = useRef<string | null>(sessionId);
  const lastSentRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);
  const conflictRef = useRef<typeof onConflict | undefined>(onConflict);
  /** Miroir ref des intervalles : lecture à chaud dans handlePosition
   *  sans recréer les callbacks quand la config serveur arrive. */
  const intervalsRef = useRef<DriverGpsIntervals>(DEFAULT_INTERVALS);
  /** La config serveur n'est tentée qu'UNE fois par vie du hook. */
  const configFetchedRef = useRef(false);
  /** Manager batterie résolu au montage (null = API absente ou échec). */
  const batteryRef = useRef<BatteryManagerLike | null>(null);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    conflictRef.current = onConflict;
  }, [onConflict]);

  // Batterie : résolution UNE fois au montage + listener « levelchange »
  // pour exposer un niveau toujours à jour (best-effort — silencieux si
  // l'API est absente, ex. iOS Safari, ou si la promesse échoue).
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== "function") return; // API absente → inconnue
    let cancelled = false;
    const syncLevel = () => {
      const level = batteryPercent(batteryRef.current);
      setState((s) => (s.batteryLevel === level ? s : { ...s, batteryLevel: level }));
    };
    const onLevelChange = () => syncLevel();
    nav
      .getBattery()
      .then((manager) => {
        if (cancelled) return;
        batteryRef.current = manager;
        syncLevel();
        manager.addEventListener("levelchange", onLevelChange);
      })
      .catch(() => undefined); // silencieux — batterie inconnue, suivi OK
    return () => {
      cancelled = true;
      batteryRef.current?.removeEventListener("levelchange", onLevelChange);
    };
  }, []);

  const refreshQueued = useCallback(async () => {
    const count = await pendingCount();
    setState((s) => (s.queued === count ? s : { ...s, queued: count }));
  }, []);

  const stopWatchingInternal = useCallback((status: GpsStatus, message: string | null) => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState((s) => (s.status === status && s.message === message ? s : { ...s, status, message }));
  }, []);

  /** Niveau de batterie à joindre à un point : lecture directe du manager
   *  (propriété maintenue à jour par le navigateur — plus frais qu'un cache
   *  de 30 s), resynchronisée dans l'état exposé. null si inconnue. */
  const readBatteryForSend = useCallback((): number | null => {
    const level = batteryPercent(batteryRef.current);
    if (level === null) return null;
    setState((s) => (s.batteryLevel === level ? s : { ...s, batteryLevel: level }));
    return level;
  }, []);

  const sendPoint = useCallback(
    async (reading: GpsReading) => {
      const sid = sessionRef.current;
      if (!sid) return;
      const point: GpsPointInput = {
        latitude: reading.latitude,
        longitude: reading.longitude,
        speed: reading.speed,
        heading: reading.heading,
        accuracy: reading.accuracy,
        altitude: reading.altitude,
        // V4 — batterie du téléphone au moment de l'envoi (null = inconnue,
        // ex. iOS Safari). Conservée telle quelle par la file offline/batch.
        batteryLevel: readBatteryForSend(),
        recordedAt: reading.recordedAt,
      };
      try {
        await api.tracking.location(sid, point);
        lastSentRef.current = Date.now();
        setState((s) => ({ ...s, lastSentAt: new Date().toISOString() }));
      } catch (error) {
        const err = error as { status?: number; message?: string };
        const status = err.status ?? 0;
        if (status === 409 || status === 404) {
          // Session terminée/pause côté serveur → conflit : on STOPPE tout.
          stopWatchingInternal("stopped", err.message ?? "La session de suivi a été arrêtée côté serveur.");
          conflictRef.current?.(err.message ?? "La session de suivi a été arrêtée.");
          await flushQueue(sid).catch(() => undefined);
          return;
        }
        if (status === 422) {
          // Point invalide (trop ancien) — abandonné, jugement définitif.
          return;
        }
        // Hors ligne / réseau / 429 / 5xx → file offline.
        await enqueue({ sessionId: sid, ...point });
        await refreshQueued();
      }
    },
    [readBatteryForSend, refreshQueued, stopWatchingInternal]
  );

  const handlePosition = useCallback(
    (position: GeolocationPosition) => {
      const coords = position.coords;
      const speedKmh = coords.speed !== null && coords.speed !== undefined ? Math.max(0, coords.speed * 3.6) : null;
      const reading: GpsReading = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: speedKmh,
        heading: coords.heading ?? null,
        accuracy: coords.accuracy ?? null,
        altitude: coords.altitude ?? null,
        recordedAt: new Date(position.timestamp).toISOString(),
      };
      setState((s) => (s.reading === reading ? s : { ...s, reading }));

      const now = Date.now();
      const sinceLast = now - lastSentRef.current;
      if (sinceLast < TRACKING.minSendIntervalMs) return; // plancher anti-burst

      // Palier d'envoi selon la vitesse : intervalles de la config serveur
      // (repli TRACKING tant qu'elle n'est pas chargée).
      const interval = sendIntervalMs(speedKmh ?? 0, intervalsRef.current);
      // Première position : envoi immédiat (dernier « connu » pour l'admin).
      if (lastSentRef.current === 0 || sinceLast >= interval) {
        lastSentRef.current = now;
        void sendPoint(reading);
      }
    },
    [sendPoint]
  );

  /** Charge la config serveur des intervalles (UNE tentative par vie du
   *  hook, best-effort) : les 3 paliers effectifs remplacent les valeurs
   *  codées en dur ; échec réseau → on reste sur TRACKING (défauts). */
  const fetchConfigOnce = useCallback(() => {
    if (configFetchedRef.current) return;
    configFetchedRef.current = true;
    api.tracking
      .config()
      .then((config) => {
        const next = intervalsFromConfig(config);
        intervalsRef.current = next;
        setIntervals(next);
      })
      .catch(() => undefined); // best-effort — TRACKING reste en vigueur
  }, []);

  const startWatching = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState((s) => ({ ...s, status: "unavailable", message: "La géolocalisation n'est pas disponible sur cet appareil." }));
      return;
    }
    if (watchIdRef.current !== null) return; // déjà actif
    fetchConfigOnce(); // paliers d'envoi effectifs côté serveur
    lastSentRef.current = 0;
    setState((s) => ({ ...s, status: "active", message: null }));
    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatchingInternal("denied", "Permission de localisation refusée. Autorisez-la dans les réglages du navigateur.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setState((s) => ({ ...s, message: "Position momentanément indisponible (recherche du signal GPS…)." }));
        }
        // TIMEOUT : on garde le watch — le signal peut revenir en route.
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );
  }, [fetchConfigOnce, handlePosition, stopWatchingInternal]);

  const stopWatching = useCallback(() => {
    stopWatchingInternal("stopped", "Suivi arrêté.");
  }, [stopWatchingInternal]);

  // Flush au retour du réseau + retry périodique si file non vide en ligne.
  useEffect(() => {
    const attemptFlush = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const sid = sessionRef.current;
      const result = await flushQueue(sid ?? undefined).catch(() => 0);
      if (result === -1) {
        conflictRef.current?.("La session de suivi a été arrêtée côté serveur.");
      }
      await refreshQueued();
    };
    const onOnline = () => void attemptFlush();
    window.addEventListener("online", onOnline);
    retryTimerRef.current = window.setInterval(() => void attemptFlush(), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      if (retryTimerRef.current !== null) window.clearInterval(retryTimerRef.current);
    };
  }, [refreshQueued]);

  // Nettoyage final du watch.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return { ...state, intervals, startWatching, stopWatching, refreshQueued };
}
