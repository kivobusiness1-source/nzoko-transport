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
 * `fallback` = KPI serveur, utilisé tant qu'aucun état n'est connu.
 */
export function deriveFleetKpi(sessions: TrackingSessionDTO[], fallback?: FleetKpi): FleetKpi {
  if (sessions.length === 0 && fallback) return fallback;
  const kpi: FleetKpi = { total: sessions.length, moving: 0, stopped: 0, offline: 0, arrived: 0, paused: 0 };
  for (const session of sessions) {
    const status = busStatusOf(session);
    if (status === "MOVING") kpi.moving += 1;
    else if (status === "STOPPED") kpi.stopped += 1;
    else if (status === "OFFLINE") kpi.offline += 1;
    else if (status === "ARRIVED") kpi.arrived += 1;
    if (session.status === "PAUSED") kpi.paused += 1;
  }
  return kpi;
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
