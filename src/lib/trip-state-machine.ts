// ============================================================
// OCÉAN DU NORD — Machine à états du voyage (V5 GPS, §22)
//
// Le statut MÉTIER du Trip (SCHEDULED | BOARDING | DEPARTED |
// ARRIVED | COMPLETED | CANCELLED) ne doit JAMAIS être modifié par
// une chaîne de caractères dispersée : toute transition passe par
// ce module, qui refuse les retours en arrière et les sauts
// illégaux. La phase TECHNIQUE GPS (IN_TRANSIT | AT_STOP |
// ARRIVING, TrackingSession.tripPhase) est un état DÉRIVÉ distinct
// — jamais mélangé avec le statut métier.
//
// Fonctions PURES (aucune E/S) → testables, réutilisables serveur.
// ============================================================

export type TripStatus =
  | "SCHEDULED"
  | "BOARDING"
  | "DEPARTED"
  | "ARRIVED"
  | "COMPLETED"
  | "CANCELLED";

export type SessionTripPhase = "IN_TRANSIT" | "AT_STOP" | "ARRIVING";

/** Terminaux : aucun retour possible (sauf réouverture métier
 *  explicite, qui n'existe pas dans le flux GPS). */
const TERMINAL: ReadonlySet<TripStatus> = new Set(["COMPLETED", "CANCELLED"]);

/** Transitions AUTORISÉES du statut métier (graphe orienté).
 *  SCHEDULED→ARRIVED : légal dans le flux GPS (bus arrivé sans que
 *  l'application ait jamais marqué le départ — comportement V4
 *  conservé, cf. maybeMarkArrival). */
const TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> = {
  SCHEDULED: ["BOARDING", "DEPARTED", "ARRIVED", "CANCELLED"],
  BOARDING: ["DEPARTED", "ARRIVED", "CANCELLED"],
  DEPARTED: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function isTripStatus(value: string): value is TripStatus {
  return value in TRANSITIONS;
}

/** La transition from → to est-elle légale ? */
export function canTransition(from: string, to: string): boolean {
  if (!isTripStatus(from) || !isTripStatus(to)) return false;
  if (from === to) return false; // pas de "transition" vers soi-même
  return TRANSITIONS[from].includes(to);
}

/** Le statut est-il terminal (plus aucune transition) ? */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL.has(status as TripStatus);
}

/** Statuts à partir desquels un voyage est jugé (plus de GPS utile). */
export function isJudgedStatus(status: string): boolean {
  return status === "ARRIVED" || status === "COMPLETED" || status === "CANCELLED";
}

/** Libellés français des phases techniques GPS (§22). */
export const TRIP_PHASE_LABELS: Record<SessionTripPhase, string> = {
  IN_TRANSIT: "En route",
  AT_STOP: "À l'arrêt",
  ARRIVING: "En approche",
};

/** Libellés français des statuts métier. */
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  SCHEDULED: "Programmé",
  BOARDING: "Embarquement",
  DEPARTED: "Parti",
  ARRIVED: "Arrivé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
};

// ============================================================
// État GPS technique dérivé (§11) — distingué du mouvement :
//   GPS_ACTIVE  🟢 positions fraîches
//   GPS_STALE   🟡 heartbeat frais (téléphone en ligne) MAIS
//               positions anciennes (GPS perdu)
//   GPS_OFFLINE 🔴 plus de heartbeat ni de position (téléphone
//               hors ligne / navigateur fermé)
//   TERMINATED  ⚫ session terminée
// ============================================================
export type SessionGpsStatus = "GPS_ACTIVE" | "GPS_STALE" | "GPS_OFFLINE" | "TERMINATED";

export const SESSION_GPS_STATUS_LABELS: Record<SessionGpsStatus, string> = {
  GPS_ACTIVE: "GPS actif",
  GPS_STALE: "GPS silencieux",
  GPS_OFFLINE: "Téléphone hors ligne",
  TERMINATED: "Session terminée",
};

export interface DeriveSessionGpsInput {
  /** Statut de la session (ACTIVE/PAUSED/COMPLETED). */
  sessionStatus: string;
  /** Dernière position reçue (horodatage GPS) — null si aucune. */
  lastPositionAt: Date | null;
  /** Dernier heartbeat reçu — null si aucun. */
  lastHeartbeatAt: Date | null;
  /** Instant de référence (testabilité) — défaut maintenant. */
  now?: Date;
  /** Seuil de péremption des positions (ms). */
  positionStaleMs: number;
  /** Seuil de péremption du heartbeat (ms). */
  heartbeatOfflineMs: number;
}

/**
 * État GPS technique de la session (§11) — SÉPARÉ du mouvement
 * (deriveBusStatus) et du statut métier (Trip.status) :
 *   1. TERMINATED  — session COMPLETED ;
 *   2. GPS_OFFLINE — heartbeat périmé (ou absent > seuil) ;
 *   3. GPS_STALE   — téléphone en ligne mais positions périmées ;
 *   4. GPS_ACTIVE  — positions fraîches.
 * Une session PAUSED avec heartbeat frais reste GPS_ACTIVE côté
 * technique (le téléphone est là) — l'UI croise avec le statut.
 */
export function deriveSessionGpsStatus(input: DeriveSessionGpsInput): SessionGpsStatus {
  if (input.sessionStatus === "COMPLETED") return "TERMINATED";
  const now = input.now ?? new Date();
  const heartbeatAlive =
    input.lastHeartbeatAt !== null && now.getTime() - input.lastHeartbeatAt.getTime() <= input.heartbeatOfflineMs;
  const positionFresh =
    input.lastPositionAt !== null && now.getTime() - input.lastPositionAt.getTime() <= input.positionStaleMs;

  // Compat V4 : sans heartbeat connu, on se fie aux positions.
  if (input.lastHeartbeatAt === null) {
    if (input.lastPositionAt === null) return "GPS_OFFLINE";
    return positionFresh ? "GPS_ACTIVE" : "GPS_OFFLINE";
  }
  if (!heartbeatAlive) return "GPS_OFFLINE";
  if (!positionFresh) return "GPS_STALE";
  return "GPS_ACTIVE";
}

// ============================================================
// RETARDS (§23) — calcul déterministe et configurable.
// ============================================================
export type DelayStatus = "ON_TIME" | "SLIGHT_DELAY" | "HEAVY_DELAY";

export const DELAY_STATUS_LABELS: Record<DelayStatus, string> = {
  ON_TIME: "À l'heure",
  SLIGHT_DELAY: "Retard léger",
  HEAVY_DELAY: "Retard important",
};

export interface DelayInput {
  /** Retard en minutes (peut être négatif = en avance) — null si inconnu. */
  delayMin: number | null;
  /** Seuil « retard léger » (min, autorité GPS_V5.delaySlightMin). */
  slightMin: number;
  /** Seuil « retard important » (min, autorité GPS_V5.delayHeavyMin). */
  heavyMin: number;
}

export function deriveDelayStatus(input: DelayInput): DelayStatus | null {
  if (input.delayMin === null || !Number.isFinite(input.delayMin)) return null;
  if (input.delayMin >= input.heavyMin) return "HEAVY_DELAY";
  if (input.delayMin >= input.slightMin) return "SLIGHT_DELAY";
  return "ON_TIME";
}
