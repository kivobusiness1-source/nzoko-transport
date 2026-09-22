"use client";

// ============================================================
// NZOKO TRANSPORT — Suivi flotte : helpers partagés (client)
// Couleurs par état, connectivité, stats dérivées, filtres.
// Les couleurs respectent la palette NZOKO (vert/orange/rouge/
// gris/teal) — jamais de bleu/indigo.
// ============================================================

import { TRACKING } from "@/lib/constants";
import { relativeTime } from "@/lib/format";
import type { FleetBusDTO, FleetSnapshotDTO, TripHistoryPointDTO } from "@/types";

// ---------- Couleurs des marqueurs (hex — Leaflet/SVG inline) ----------

/** Pastille carte par état (couleurs NZOKO : vert, ambre, rouge, gris, teal). */
export const BUS_STATE_DOT_COLOR: Record<FleetBusDTO["state"], string> = {
  EN_ROUTE: "#16a34a", // vert
  ARRIVED: "#0d9488", // teal
  STOPPED: "#d97706", // ambre
  PAUSED: "#d97706", // ambre
  OFFLINE: "#6b7280", // gris
  GPS_UNSTABLE: "#ea580c", // orange soutenu
  OFF_ROUTE: "#dc2626", // rouge
  NOT_TRACKED: "#9ca3af", // gris clair
};

/** Classes Tailwind du badge d'état dans les listes. */
export const BUS_STATE_BADGE_CLASS: Record<FleetBusDTO["state"], string> = {
  EN_ROUTE: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900",
  ARRIVED: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-900",
  STOPPED: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900",
  PAUSED: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900",
  OFFLINE: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/60 dark:text-gray-300 dark:border-gray-700",
  GPS_UNSTABLE: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-900",
  OFF_ROUTE: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-900",
  NOT_TRACKED: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/60 dark:text-gray-400 dark:border-gray-700",
};

// ---------- Connectivité & temps ----------

/** Secondes écoulées depuis un ISO (null si absent/invalide). */
export function secondsSince(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

export type Connectivity = "online" | "unstable" | "offline";

/** Fenêtres serveur (TRACKING.onlineAfterS / unstableAfterS). */
export function connectivityOf(bus: FleetBusDTO, nowMs = Date.now()): Connectivity {
  const s = secondsSince(bus.lastSeenAt, nowMs);
  if (s === null) return "offline";
  if (s <= TRACKING.onlineAfterS) return "online";
  if (s <= TRACKING.unstableAfterS) return "unstable";
  return "offline";
}

/** « il y a 12 s » sous la minute, sinon relativeTime (min/h/j). */
export function lastSeenLabel(iso: string | null | undefined, nowMs = Date.now()): string {
  const s = secondsSince(iso, nowMs);
  if (s === null) return "jamais";
  if (s < 60) return `il y a ${s} s`;
  return relativeTime(new Date(iso as string));
}

// ---------- Stats dérivées (recalculées à chaque upsert) ----------

/**
 * Recalcule les compteurs de la flotte à partir des bus (même règle que le
 * serveur) : le snapshot initial arrive avec des stats serveur, mais chaque
 * message temps réel ne met à jour qu'UN bus — les compteurs sont donc
 * re-dérivés côté client pour rester cohérents.
 */
export function deriveFleetStats(buses: FleetBusDTO[]): FleetSnapshotDTO["stats"] {
  let online = 0;
  let unstable = 0;
  let offline = 0;
  let enRoute = 0;
  let arrived = 0;
  let offRoute = 0;
  let paused = 0;
  let delayed = 0;
  const now = Date.now();
  for (const b of buses) {
    const c = connectivityOf(b, now);
    if (c === "online") online++;
    else if (c === "unstable") unstable++;
    else offline++;
    if (b.state === "EN_ROUTE") enRoute++;
    if (b.state === "ARRIVED") arrived++;
    if (b.state === "PAUSED") paused++;
    if (b.state === "OFF_ROUTE" || b.offRoute) offRoute++;
    if (b.delayed) delayed++;
  }
  return { total: buses.length, online, unstable, offline, enRoute, arrived, offRoute, paused, delayed };
}

/** Applique les stats dérivées à un snapshot (après upsert d'un bus). */
export function withDerivedStats(snap: FleetSnapshotDTO): FleetSnapshotDTO {
  return { ...snap, stats: deriveFleetStats(snap.buses) };
}

// ---------- Dédoublonnage par bus ----------

/**
 * Priorité d'affichage d'une entrée de flotte pour un même bus physique :
 * le serveur liste UNE entrée PAR SESSION (active + terminées < 2 h) — un
 * bus ayant roulé plusieurs fois apparaîtrait plusieurs fois sur la carte.
 * On garde l'entrée la plus pertinente (état live d'abord, puis signal le
 * plus récent).
 */
function busRank(bus: FleetBusDTO): number {
  switch (bus.state) {
    case "EN_ROUTE": return 8;
    case "OFF_ROUTE": return 7;
    case "GPS_UNSTABLE": return 6;
    case "STOPPED": return 5;
    case "PAUSED": return 5;
    case "ARRIVED": return 4;
    case "OFFLINE": return 3;
    case "NOT_TRACKED": return 2;
  }
}

export function dedupeBusesByBus(buses: FleetBusDTO[]): FleetBusDTO[] {
  const best = new Map<string, FleetBusDTO>();
  for (const b of buses) {
    const prev = best.get(b.busId);
    if (!prev) {
      best.set(b.busId, b);
      continue;
    }
    const rankDiff = busRank(b) - busRank(prev);
    const bSeen = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    const prevSeen = prev.lastSeenAt ? new Date(prev.lastSeenAt).getTime() : 0;
    if (rankDiff > 0 || (rankDiff === 0 && bSeen > prevSeen)) {
      best.set(b.busId, b);
    }
  }
  return [...best.values()];
}

/**
 * Normalise un snapshot reçu du serveur : 1 entrée par bus physique
 * (priorité session active) + stats re-dérivées.
 */
export function normalizeSnapshot(snap: FleetSnapshotDTO): FleetSnapshotDTO {
  const buses = dedupeBusesByBus(snap.buses);
  return { ...snap, buses, stats: deriveFleetStats(buses) };
}

// ---------- Filtres (panneau latéral) ----------

export type FleetStatusFilter =
  | "all" | "online" | "offline" | "en_route" | "arrived" | "delayed" | "off_route" | "paused";

export const FLEET_STATUS_FILTERS: { key: FleetStatusFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "online", label: "En ligne" },
  { key: "offline", label: "Hors ligne" },
  { key: "en_route", label: "En route" },
  { key: "arrived", label: "Arrivé" },
  { key: "delayed", label: "En retard" },
  { key: "off_route", label: "Hors itinéraire" },
  { key: "paused", label: "En pause" },
];

export function driverNameOf(bus: FleetBusDTO): string {
  const name = `${bus.driverFirstName ?? ""} ${bus.driverLastName ?? ""}`.trim();
  return name || "Chauffeur non affecté";
}

/** Recherche texte : bus (flotte/immat), chauffeur, code voyage. */
function matchesQuery(bus: FleetBusDTO, q: string): boolean {
  if (!q) return true;
  const haystack = [
    bus.fleetNumber, bus.registrationNumber, driverNameOf(bus), bus.tripCode ?? "",
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

function matchesStatus(bus: FleetBusDTO, filter: FleetStatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "online": return connectivityOf(bus) !== "offline";
    case "offline": return bus.state === "OFFLINE" || bus.state === "NOT_TRACKED" || connectivityOf(bus) === "offline";
    case "en_route": return bus.state === "EN_ROUTE" || bus.state === "STOPPED";
    case "arrived": return bus.state === "ARRIVED";
    case "delayed": return bus.delayed;
    case "off_route": return bus.state === "OFF_ROUTE" || bus.offRoute;
    case "paused": return bus.state === "PAUSED";
  }
}

export function filterBuses(
  buses: FleetBusDTO[],
  opts: { q?: string; status?: FleetStatusFilter; driver?: string | null },
): FleetBusDTO[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  return buses.filter(
    (b) => matchesQuery(b, q) && matchesStatus(b, opts.status ?? "all") && (!opts.driver || driverNameOf(b) === opts.driver),
  );
}

// ---------- Historique : stats cumulées côté client ----------

/**
 * Même approximation que le serveur (haversine, seuil TRACKING.stoppedSpeedKmh)
 * mais sur l'ENSEMBLE des points fusionnés — les stats serveur ne couvrent
 * qu'une page de pagination. duration/offRoute restent celles du DTO
 * (stables, calculées au niveau du voyage).
 */
export function computePointStats(points: TripHistoryPointDTO[]): {
  distanceKm: number;
  movingMinutes: number;
  stoppedMinutes: number;
  averageSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  pointCount: number;
} {
  let distanceM = 0;
  let maxSpeed = 0;
  let movingMs = 0;
  let stoppedMs = 0;
  let hasSpeed = false;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed !== null && p.speed !== undefined) {
      maxSpeed = Math.max(maxSpeed, p.speed);
      hasSpeed = true;
    }
    if (i > 0) {
      const prev = points[i - 1];
      const d = haversineKm(prev, p) * 1000;
      const dt = new Date(p.recordedAt).getTime() - new Date(prev.recordedAt).getTime();
      if (dt <= 0) continue;
      distanceM += d;
      const speedLike = (d / 1000) / (dt / 3_600_000);
      if (speedLike >= TRACKING.stoppedSpeedKmh) movingMs += dt;
      else stoppedMs += dt;
    }
  }
  const totalMs = movingMs + stoppedMs;
  return {
    distanceKm: Math.round((distanceM / 1000) * 10) / 10,
    movingMinutes: Math.round(movingMs / 60000),
    stoppedMinutes: Math.round(stoppedMs / 60000),
    averageSpeedKmh: totalMs > 0 ? Math.round(((distanceM / 1000) / (totalMs / 3_600_000)) * 10) / 10 : null,
    maxSpeedKmh: hasSpeed ? Math.round(maxSpeed * 10) / 10 : null,
    pointCount: points.length,
  };
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const la1 = a.latitude * toRad;
  const la2 = b.latitude * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
