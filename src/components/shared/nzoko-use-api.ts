"use client";

// ============================================================
// OCÉAN DU NORD — Hook de chargement API + erreurs FR
// Chargement initial visible (skeleton), rechargements
// silencieux (auto-refresh, post-mutation), filtres visibles.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api-client";

export interface ApiErrorInfo {
  message: string;
  status: number | null;
}

/** Traduit une erreur API en message FR adapté au contexte (backend en parallèle). */
export function friendlyApiError(err: unknown): ApiErrorInfo {
  if (err instanceof ApiClientError) {
    if (err.status === 403) {
      return { message: "Accès refusé : votre rôle ne permet pas de consulter ce module.", status: 403 };
    }
    if (err.status === 404) {
      return { message: "Ce module n'est pas encore disponible côté serveur. Réessayez plus tard.", status: 404 };
    }
    return { message: err.message, status: err.status };
  }
  return { message: "Une erreur est survenue. Vérifiez votre connexion.", status: null };
}

/** Message court pour les toasts d'erreur de mutation. */
export function apiErrorMessage(err: unknown): string {
  return friendlyApiError(err).message;
}

export interface NzokoApiResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiErrorInfo | null;
  reload: () => void;
}

/**
 * Charge une ressource API.
 * - montage / filtres (`refetchKey`) / refresh global (`refreshKey`) → skeleton visible
 * - `reload()` (après mutation) et auto-refresh → silencieux (données conservées)
 */
export function useApiData<T>(
  fetcher: () => Promise<T>,
  opts: { autoRefreshMs?: number; refreshKey?: number; refetchKey?: unknown[] } = {},
): NzokoApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const { autoRefreshMs = 0, refreshKey = 0, refetchKey = [] } = opts;

  const seq = useRef(0);

  const run = useCallback(async (visible: boolean) => {
    const id = ++seq.current;
    if (visible) setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (id === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === seq.current) setError(friendlyApiError(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    void run(true);
    // Requêtes pilotées par des clés dynamiques (filtres, rafraîchissement global).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clés dynamiques étalées par le consommateur (hook générique), vérification statique impossible par design
  }, [run, refreshKey, ...refetchKey]);

  const silentFirst = useRef(true);
  useEffect(() => {
    if (silentFirst.current) {
      silentFirst.current = false;
      return;
    }
    void run(false);
  }, [tick, run]);

  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const t = setInterval(() => setTick((x) => x + 1), autoRefreshMs);
    return () => clearInterval(t);
  }, [autoRefreshMs]);

  return { data, loading, error, reload };
}

/** Valeur retardée (recherche debounce). */
export function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
