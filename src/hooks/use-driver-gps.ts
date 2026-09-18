"use client";

// ============================================================
// NZOKO TRANSPORT — Hook de géolocalisation intelligent (chauffeur)
//
// Fréquence pilotée par TRACKING : envoi si (a) ≥ movingIntervalMs
// quand vitesse ≥ stoppedSpeedKmh, (b) ≥ stoppedIntervalMs à l'arrêt,
// (c) JAMAIS < minSendIntervalMs (plancher anti-burst). m/s → km/h (×3,6).
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
import type { GpsPointInput } from "@/types";

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
  });

  const watchIdRef = useRef<number | null>(null);
  const sessionRef = useRef<string | null>(sessionId);
  const lastSentRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);
  const conflictRef = useRef<typeof onConflict | undefined>(onConflict);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    conflictRef.current = onConflict;
  }, [onConflict]);

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
    [refreshQueued, stopWatchingInternal]
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

      const moving = (speedKmh ?? 0) >= TRACKING.stoppedSpeedKmh;
      const interval = moving ? TRACKING.movingIntervalMs : TRACKING.stoppedIntervalMs;
      // Première position : envoi immédiat (dernier « connu » pour l'admin).
      if (lastSentRef.current === 0 || sinceLast >= interval) {
        lastSentRef.current = now;
        void sendPoint(reading);
      }
    },
    [sendPoint]
  );

  const startWatching = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState((s) => ({ ...s, status: "unavailable", message: "La géolocalisation n'est pas disponible sur cet appareil." }));
      return;
    }
    if (watchIdRef.current !== null) return; // déjà actif
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
  }, [handlePosition, stopWatchingInternal]);

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

  return { ...state, startWatching, stopWatching, refreshQueued };
}
