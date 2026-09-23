// ============================================================
// NZOKO TRANSPORT — File offline des points GPS (IndexedDB)
//
// Objectif : le chauffeur ne perd JAMAIS un point de position,
// même sans réseau (zones blanches RN1/RN2…). Les points sont
// stockés localement avec leur horodatage ORIGINAL (jamais
// réécrit) puis re-flushés par lots signés au retour du réseau.
//
// DB « nzoko-gps » v1 — objectStore « pending-locations ».
// API : enqueue / pendingCount / purgeStalePoints / flushQueue /
// clearAll. Repli mémoire si IndexedDB indisponible (navigation
// privée iOS). Filet SSR : typeof window.
// ============================================================

import { api } from "@/lib/api-client";
import { getDeviceId } from "@/lib/device-id";
import { TRACKING } from "@/lib/constants";
import type { GpsPointInput } from "@/types";

export interface QueuedGpsPoint extends GpsPointInput {
  /** Identifiant autoIncrement IndexedDB (tri stable). */
  id?: number;
  /** Session émettrice — flush filtré par session. */
  sessionId: string;
  /** Date d'entrée en file (diagnostic, ≠ recordedAt). */
  queuedAt: string;
}

const DB_NAME = "nzoko-gps";
const DB_VERSION = 1;
const STORE = "pending-locations";

/** Verrou anti-concurrence module-level (double flush simultané interdit). */
let flushing = false;

// ---------- Repli mémoire (IndexedDB indisponible) ----------
let memoryFallback: QueuedGpsPoint[] = [];

function hasIndexedDB(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB indisponible"));
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Erreur IndexedDB"));
  });
}

/** Purge des enregistrements trop anciens (fenêtre TRACKING.pastToleranceMs).
 *  Toujours appelée AVANT tout envoi — le serveur les rejetterait de toute façon. */
export async function purgeStalePoints(): Promise<number> {
  const cutoff = Date.now() - TRACKING.pastToleranceMs;
  if (!hasIndexedDB()) {
    const before = memoryFallback.length;
    memoryFallback = memoryFallback.filter((p) => new Date(p.recordedAt).getTime() >= cutoff);
    return before - memoryFallback.length;
  }
  try {
    const all = await withStore<QueuedGpsPoint[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedGpsPoint[]>);
    const staleIds = all.filter((p) => new Date(p.recordedAt).getTime() < cutoff).map((p) => p.id).filter((id): id is number => typeof id === "number");
    if (staleIds.length === 0) return 0;
    await withStore<undefined>("readwrite", (s) => s.delete(staleIds) as unknown as IDBRequest<undefined>);
    return staleIds.length;
  } catch {
    return 0; // meilleure effort — la purge suivante retentera
  }
}

/** Ajoute un point à la file (appelé à chaque échec réseau). */
export async function enqueue(point: GpsPointInput & { sessionId: string }): Promise<void> {
  const record: QueuedGpsPoint = { ...point, queuedAt: new Date().toISOString() };
  if (!hasIndexedDB()) {
    memoryFallback.push(record);
    return;
  }
  try {
    await withStore<IDBValidKey>("readwrite", (s) => s.add(record));
  } catch {
    memoryFallback.push(record); // repli silencieux
  }
}

/** Nombre de points en attente (toutes sessions ou filtré). */
export async function pendingCount(sessionId?: string): Promise<number> {
  if (!hasIndexedDB()) {
    return sessionId ? memoryFallback.filter((p) => p.sessionId === sessionId).length : memoryFallback.length;
  }
  try {
    const all = await withStore<QueuedGpsPoint[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedGpsPoint[]>);
    return sessionId ? all.filter((p) => p.sessionId === sessionId).length : all.length;
  } catch {
    return memoryFallback.length;
  }
}

/**
 * Vide la file vers le serveur (lots ≤ TRACKING.batchMaxPoints, ordre
 * chronologique). Seuls les lots TRANSMIS (HTTP 2xx) sont supprimés —
 * l'appel réussi = jugement définitif du serveur.
 *
 * V5 (§38) : quand la réponse contient `results` (verdict PAR
 * position), seules les positions JUGÉES sont supprimées — les
 * éventuelles absentes (échec interne ponctuel) restent en file et
 * seront retentées SANS être renvoyées en double (idempotence §9 :
 * leur positionId est déjà connu du serveur, réponse DOUBLON).
 * Sans `results` (serveur V4) : tout le lot transmis est supprimé.
 *
 * Retourne le nombre de points transmis, ou -1 si un conflit de session
 * a été détecté (409/404 : la file de cette session est purgée —
 * le serveur a jugé la session terminée).
 */
export async function flushQueue(sessionId?: string): Promise<number> {
  if (flushing) return 0; // verrou module-level
  flushing = true;
  try {
    await purgeStalePoints();

    let queue: QueuedGpsPoint[];
    if (!hasIndexedDB()) {
      queue = sessionId ? memoryFallback.filter((p) => p.sessionId === sessionId) : [...memoryFallback];
    } else {
      const all = await withStore<QueuedGpsPoint[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedGpsPoint[]>);
      queue = sessionId ? all.filter((p) => p.sessionId === sessionId) : all;
    }
    if (queue.length === 0) return 0;

    // Ordre chronologique strict (recordedAt, id en tie-break).
    queue.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || (a.id ?? 0) - (b.id ?? 0));

    let sent = 0;
    for (let offset = 0; offset < queue.length; offset += TRACKING.batchMaxPoints) {
      const chunk = queue.slice(offset, offset + TRACKING.batchMaxPoints);
      const first = chunk[0];
      try {
        const result = await api.tracking.batch(
          first.sessionId,
          chunk.map(({ sessionId: _s, queuedAt: _q, id: _i, ...point }) => point),
          getDeviceId()
        );
        // Lot accepté (2xx) → suppression AU FUR ET À MESURE.
        if (Array.isArray(result.results) && result.results.length > 0) {
          // V5 : verdict PAR position — on ne supprime que les jugées.
          const judged = new Set(result.results.map((r) => r.positionId));
          const judgedRecords = chunk.filter((p) => !p.positionId || judged.has(p.positionId));
          await removeBatch(judgedRecords);
          sent += judgedRecords.length;
        } else {
          // V4 (pas de results) : le serveur a jugé TOUT le lot.
          await removeBatch(chunk);
          sent += result.accepted;
        }
      } catch (error) {
        const status = (error as { status?: number }).status ?? 0;
        if (status === 409 || status === 404) {
          // Session terminée côté serveur : les points n'ont plus de
          // destination → purge de la file de CETTE session.
          await removeBatch(queue.filter((p) => p.sessionId === first.sessionId));
          return -1;
        }
        // Réseau / 429 / 5xx : le lot est conservé — prochain flush.
        return sent;
      }
    }
    return sent;
  } finally {
    flushing = false;
  }
}

/** Supprime des enregistrements précis de la file (IndexedDB ou mémoire). */
async function removeBatch(records: QueuedGpsPoint[]): Promise<void> {
  const ids = records.map((r) => r.id).filter((id): id is number => typeof id === "number");
  if (!hasIndexedDB() || ids.length !== records.length) {
    // Repli mémoire (ou enregistrements mémoire mélangés) — filtrage par valeur.
    const key = new Set(records);
    memoryFallback = memoryFallback.filter((p) => !key.has(p));
    if (ids.length > 0 && hasIndexedDB()) {
      try {
        await withStore<undefined>("readwrite", (s) => s.delete(ids) as unknown as IDBRequest<undefined>);
      } catch {
        // meilleure effort
      }
    }
    return;
  }
  try {
    await withStore<undefined>("readwrite", (s) => s.delete(ids) as unknown as IDBRequest<undefined>);
  } catch {
    // meilleure effort — le prochain flush retentera
  }
}

/** Purge totale (déconnexion / test). */
export async function clearAll(): Promise<void> {
  memoryFallback = [];
  if (!hasIndexedDB()) return;
  try {
    await withStore<undefined>("readwrite", (s) => s.clear() as unknown as IDBRequest<undefined>);
  } catch {
    // meilleure effort
  }
}
