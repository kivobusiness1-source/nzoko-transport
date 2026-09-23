"use client";

// ============================================================
// NZOKO TRANSPORT — Suivi GPS V4 : éléments partagés entre les
// composants de l'onglet admin (KPI, liste, carte, filtres).
// Couleurs PAR ÉTAT GPS du bus (contrat V4 — @/lib/geo).
// ============================================================

import { Badge } from "@/components/ui/badge";
import { BUS_STATUS_LABELS, type BusStatus } from "@/lib/geo";
import type { FleetKpi, TrackingSessionDTO } from "@/types";

/** Couleur de fond du marqueur bus par état GPS (identiques à la carte). */
export const BUS_STATUS_COLORS: Record<BusStatus, string> = {
  MOVING: "#059669", // vert émeraude
  STOPPED: "#d97706", // ambre
  OFFLINE: "#6b7280", // gris
  ARRIVED: "#0d9488", // sarcelle
  GPS_ERROR: "#dc2626", // rouge
};

/** Classes Tailwind du badge texte par état GPS (mêmes teintes que la carte). */
export const BUS_STATUS_BADGE_CLASSES: Record<BusStatus, string> = {
  MOVING: "border-emerald-300 bg-emerald-100 text-emerald-800",
  STOPPED: "border-amber-300 bg-amber-100 text-amber-800",
  OFFLINE: "border-slate-300 bg-slate-100 text-slate-700",
  ARRIVED: "border-teal-300 bg-teal-100 text-teal-800",
  GPS_ERROR: "border-red-300 bg-red-100 text-red-700",
};

/**
 * État GPS affichable d'une session. Le serveur fournit toujours
 * `busStatus` sur la vue flotte ; par prudence (payload plus ancien ou
 * événement socket sans dérivation), on retombe sur une approximation
 * documentée : sans dernier point → GPS_ERROR, sinon STOPPED
 * (l'état réel est ré-affirmé au prochain poll).
 */
export function busStatusOf(session: TrackingSessionDTO): BusStatus {
  if (session.busStatus) return session.busStatus;
  return session.lastPoint ? "STOPPED" : "GPS_ERROR";
}

/** Badge coloré de l'état GPS d'un bus (liste, panneau détail). */
export function BusStatusBadge({ status, className }: { status: BusStatus; className?: string }) {
  return (
    <Badge variant="outline" className={`font-medium ${BUS_STATUS_BADGE_CLASSES[status]} ${className ?? ""}`}>
      {BUS_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * KPI de flotte re-déduits localement des sessions fusionnées
 * (polling + correctifs temps réel). Sémantique calquée sur le
 * serveur : total = toutes les sessions vivantes ; les états se
 * recoupent par busStatus (GPS_ERROR n'entre dans aucun compteur
 * d'état, comme côté serveur) ; paused compte les sessions PAUSED.
 * V5 : delayed (retard au prochain arrêt) et stale (GPS silencieux
 * mais téléphone en ligne) re-déduits des champs V5.
 * `fallback` = KPI serveur, utilisé tant qu'aucun état n'est connu.
 */
export function deriveFleetKpi(sessions: TrackingSessionDTO[], fallback?: FleetKpi): FleetKpi {
  if (sessions.length === 0 && fallback) return fallback;
  const kpi: FleetKpi = { total: sessions.length, moving: 0, stopped: 0, offline: 0, arrived: 0, paused: 0, delayed: 0, stale: 0 };
  for (const session of sessions) {
    const status = busStatusOf(session);
    if (status === "MOVING") kpi.moving += 1;
    else if (status === "STOPPED") kpi.stopped += 1;
    else if (status === "OFFLINE") kpi.offline += 1;
    else if (status === "ARRIVED") kpi.arrived += 1;
    if (session.status === "PAUSED") kpi.paused += 1;
    if (session.nextStop?.delayStatus === "SLIGHT_DELAY" || session.nextStop?.delayStatus === "HEAVY_DELAY") kpi.delayed = (kpi.delayed ?? 0) + 1;
    if (session.gpsStatus === "GPS_STALE") kpi.stale = (kpi.stale ?? 0) + 1;
  }
  return kpi;
}

// ============================================================
// V5 — État GPS TECHNIQUE de la session (heartbeat vs positions, §11)
// ============================================================

/** Classes Tailwind du badge gpsStatus (🟢 actif / 🟡 silencieux / 🔴 hors ligne / ⚫ terminée). */
export const GPS_STATUS_BADGE_CLASSES: Record<string, string> = {
  GPS_ACTIVE: "border-emerald-300 bg-emerald-100 text-emerald-800",
  GPS_STALE: "border-amber-300 bg-amber-100 text-amber-800",
  GPS_OFFLINE: "border-red-300 bg-red-100 text-red-700",
  TERMINATED: "border-slate-300 bg-slate-100 text-slate-600",
};

/** Libellés FR des états GPS techniques. */
export const GPS_STATUS_LABELS: Record<string, string> = {
  GPS_ACTIVE: "GPS actif",
  GPS_STALE: "GPS silencieux",
  GPS_OFFLINE: "Téléphone hors ligne",
  TERMINATED: "Session terminée",
};

/** Pastule + badge de l'état GPS technique (§11). */
export function GpsStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  const dot = status === "GPS_ACTIVE" ? "bg-emerald-500" : status === "GPS_STALE" ? "bg-amber-500" : status === "GPS_OFFLINE" ? "bg-red-500" : "bg-slate-400";
  return (
    <Badge variant="outline" className={`gap-1.5 font-medium ${GPS_STATUS_BADGE_CLASSES[status] ?? ""} ${className ?? ""}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {GPS_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** Badge de phase technique du trajet (§22 — En route / À l'arrêt / En approche). */
export function TripPhaseBadge({ phase, className }: { phase: string | null | undefined; className?: string }) {
  if (!phase) return null;
  const label = phase === "IN_TRANSIT" ? "En route" : phase === "AT_STOP" ? "À l'arrêt" : phase === "ARRIVING" ? "En approche" : phase;
  const cls =
    phase === "AT_STOP"
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : phase === "ARRIVING"
        ? "border-teal-300 bg-teal-50 text-teal-800"
        : "border-emerald-300 bg-emerald-50 text-emerald-800";
  return (
    <Badge variant="outline" className={`font-medium ${cls} ${className ?? ""}`}>
      {label}
    </Badge>
  );
}

/** Badge de retard au prochain arrêt (§23 — À l'heure / Retard léger / Retard important). */
export function DelayBadge({ delay }: { delay: { delayMin: number | null; delayStatus: string | null } | null | undefined }) {
  if (!delay?.delayStatus) return null;
  const isHeavy = delay.delayStatus === "HEAVY_DELAY";
  const isSlight = delay.delayStatus === "SLIGHT_DELAY";
  const label = isHeavy ? "Retard important" : isSlight ? "Retard léger" : "À l'heure";
  const min = delay.delayMin !== null && delay.delayMin > 0 ? ` +${Math.round(delay.delayMin)} min` : "";
  const cls = isHeavy ? "border-red-300 bg-red-100 text-red-700" : isSlight ? "border-amber-300 bg-amber-100 text-amber-800" : "border-emerald-300 bg-emerald-100 text-emerald-800";
  return (
    <Badge variant="outline" className={`font-medium ${cls}`}>
      {label}
      {min}
    </Badge>
  );
}

// ============================================================
// V5 — Journal d'événements GPS (§34/§35) : libellés CLIENT purs.
// (Le module @/services/tracking-events importe Prisma — interdit
// côté navigateur : les libellés sont dupliqués ici, sciemment.)
// ============================================================

/** Libellés FR des types d'événements GPS (panneau d'alertes §35). */
export const TRACKING_EVENT_LABELS: Record<string, string> = {
  GPS_SESSION_STARTED: "Suivi démarré",
  GPS_SESSION_STOPPED: "Suivi arrêté",
  GPS_DEVICE_CHANGED: "Téléphone changé",
  SESSION_CONFLICT: "Conflit de session",
  GPS_POSITION_REJECTED: "Position rejetée",
  GPS_ANOMALY_DETECTED: "Anomalie GPS",
  GPS_STALE: "GPS silencieux",
  GPS_OFFLINE: "Téléphone hors ligne",
  STOP_ARRIVAL_DETECTED: "Arrivée à un arrêt",
  STOP_DEPARTURE_DETECTED: "Départ d'un arrêt",
  DESTINATION_APPROACHING: "Approche de la destination",
  DESTINATION_ARRIVED: "Arrivée à destination",
  TRIP_COMPLETED: "Voyage terminé",
};

/** Icône-emoji par famille d'événement (rendu liste). */
export function trackingEventEmoji(type: string): string {
  if (type.startsWith("SESSION_CONFLICT")) return "⚠️";
  if (type.startsWith("GPS_POSITION_REJECTED") || type.startsWith("GPS_ANOMALY")) return "🛰️";
  if (type.startsWith("GPS_OFFLINE") || type.startsWith("GPS_STALE")) return "📵";
  if (type.startsWith("STOP_ARRIVAL") || type.startsWith("DESTINATION_ARRIVED")) return "📍";
  if (type.startsWith("STOP_DEPARTURE")) return "🚌";
  if (type.startsWith("TRIP_COMPLETED")) return "✅";
  return "ℹ️";
}

/** Point cardinal FR approximatif d'un cap en degrés (0° = nord). */
export function headingLabel(heading: number | null): string {
  if (heading === null || !Number.isFinite(heading)) return "—";
  const cardinals = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
  const index = Math.round((((heading % 360) + 360) % 360) / 45) % 8;
  return cardinals[index];
}

/** Clé de rapprochement session ↔ ligne de la carte publique. */
export function routeKeyOf(originCityName: string, destinationCityName: string): string {
  return `${originCityName}→${destinationCityName}`;
}
