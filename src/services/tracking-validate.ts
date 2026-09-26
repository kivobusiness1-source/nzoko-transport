// ============================================================
// OCÉAN DU NORD — Validation des positions GPS V5 (§8, §12)
//
// Fonctions PURES (aucune E/S) : chaque position reçue (isolée ou
// en lot) reçoit un VERDICT fondé sur les seuils serveur (GPS_V5) :
//
//   ACCEPT              → position valide ET plus récente que l'état
//                         courant → met à jour l'état dénormalisé ;
//   ACCEPT_HISTORY_ONLY → position valide mais ANCIENNE (reçue en
//                         désordre / re-synchronisation) → conservée
//                         en HISTOIRE mais ne fait JAMAIS reculer
//                         l'état courant (§12) ;
//   DUPLICATE           → positionId déjà enregistré (idempotence,
//                         §9) → réponse idempotente, rien à écrire ;
//   REJECT_<RAISON>     → position incohérente → abandonnée +
//                         événement d'audit GPS_POSITION_REJECTED ;
//   ACCEPT_FLAGGED      → position suspecte mais plausible →
//                         enregistrée + événement GPS_ANOMALY_DETECTED.
//
// Le serveur ne fait JAMAIS confiance aveuglément au navigateur :
// latitude/longitude/vitesse/déplacement/horodatages sont tous
// contrôlés les uns par rapport aux autres.
// ============================================================

import { GPS_V5 } from "@/lib/gps-config";
import { TRACKING } from "@/lib/constants";
import { haversineMeters } from "@/lib/geo";

export type PositionVerdict =
  | "ACCEPT"
  | "ACCEPT_HISTORY_ONLY"
  | "ACCEPT_FLAGGED"
  | "DUPLICATE"
  | "REJECT_INVALID_COORDS"
  | "REJECT_FUTURE_TIMESTAMP"
  | "REJECT_STALE_TIMESTAMP"
  | "REJECT_IMPOSSIBLE_SPEED"
  | "REJECT_TELEPORT";

export interface PositionForValidation {
  latitude: number;
  longitude: number;
  speed?: number | null;
  accuracy?: number | null;
  recordedAt: Date;
  /** Identifiant d'idempotence client (optionnel — legacy sans). */
  positionId?: string | null;
}

/** Dernier état connu de la session (dénormalisé V5). */
export interface LastKnownState {
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  positionAt: Date | null;
}

export interface PositionValidationResult {
  verdict: PositionVerdict;
  /** Raison lisible (audit) — null quand tout est nominal. */
  reason: string | null;
  /** Vitesse implicite (km/h) entre la position et l'état précédent
   *  (téléportation) — null si non calculable. */
  impliedSpeedKmh: number | null;
  /** Drapeaux d'anomalie (position enregistrée mais signalée). */
  flags: PositionAnomaly[];
}

export type PositionAnomaly = "SUSPECT_SPEED" | "SUSPECT_ACCURACY" | "TELEPORT_BORDERLINE";

export interface ValidatePositionInput {
  point: PositionForValidation;
  last: LastKnownState | null;
  /** Instant de référence (testabilité) — défaut maintenant. */
  now?: Date;
}

/**
 * Juge UNE position par rapport à l'état courant de la session.
 * L'ordre des contrôles va du plus radical (données invalides) au
 * plus fin (drapeaux d'anomalie) — le premier verdict REJECT gagne.
 */
export function validatePosition(input: ValidatePositionInput): PositionValidationResult {
  const { point, last } = input;
  const now = input.now ?? new Date();
  const flags: PositionAnomaly[] = [];
  const t = point.recordedAt.getTime();

  // 1. Coordonnées invalides (0,0 = défaut GPS classique des mobiles).
  const finiteLat = Number.isFinite(point.latitude);
  const finiteLng = Number.isFinite(point.longitude);
  const inRange = Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
  const nullIsland = point.latitude === 0 && point.longitude === 0;
  if (!finiteLat || !finiteLng || !inRange || nullIsland) {
    return { verdict: "REJECT_INVALID_COORDS", reason: "Coordonnées invalides", impliedSpeedKmh: null, flags };
  }

  // 2. Horodatage dans le futur (au-delà de la tolérance) → rejet.
  if (t - now.getTime() > GPS_V5.futureToleranceMs) {
    return { verdict: "REJECT_FUTURE_TIMESTAMP", reason: "Horodatage dans le futur", impliedSpeedKmh: null, flags };
  }

  // 3. Horodatage trop ancien (fenêtre de tolérance serveur, 6 h).
  if (now.getTime() - t > TRACKING.pastToleranceMs) {
    return { verdict: "REJECT_STALE_TIMESTAMP", reason: "Point GPS trop ancien", impliedSpeedKmh: null, flags };
  }

  // 4. Vitesse déclarée physiquement impossible.
  const speed = point.speed ?? null;
  if (speed !== null && speed > GPS_V5.maxSpeedKmh) {
    return { verdict: "REJECT_IMPOSSIBLE_SPEED", reason: `Vitesse déclarée impossible (${Math.round(speed)} km/h)`, impliedSpeedKmh: null, flags };
  }

  // 5. Déplacement impossible par rapport à la dernière position
  //    (vitesse implicite = distance / temps écoulé).
  let impliedSpeedKmh: number | null = null;
  if (last && last.latitude !== null && last.longitude !== null && last.positionAt !== null) {
    const dtMs = t - last.positionAt.getTime();
    if (dtMs > 1_000) {
      const distanceM = haversineMeters(
        { latitude: last.latitude, longitude: last.longitude },
        { latitude: point.latitude, longitude: point.longitude }
      );
      impliedSpeedKmh = (distanceM / 1000) / (dtMs / 3_600_000);
      if (impliedSpeedKmh > GPS_V5.teleportSpeedKmh) {
        return {
          verdict: "REJECT_TELEPORT",
          reason: `Déplacement impossible (${Math.round(impliedSpeedKmh)} km/h implicites)`,
          impliedSpeedKmh,
          flags,
        };
      }
      // Zone grise : au-dessus de la vitesse max plausible mais sous
      // le seuil de téléportation → enregistré MAIS signalé.
      if (impliedSpeedKmh > GPS_V5.suspectSpeedKmh) flags.push("TELEPORT_BORDERLINE");
    }
  }

  // 6. Drapeaux d'anomalie (position conservée mais signalée §8).
  if (speed !== null && speed > GPS_V5.suspectSpeedKmh) flags.push("SUSPECT_SPEED");
  if (point.accuracy != null && point.accuracy > GPS_V5.suspectAccuracyM) flags.push("SUSPECT_ACCURACY");

  // 7. Ordre logique (§12) : plus ancienne que l'état courant →
  //    HISTOIRE seulement, l'état courant ne recule JAMAIS.
  if (last && last.positionAt !== null && t < last.positionAt.getTime()) {
    return { verdict: "ACCEPT_HISTORY_ONLY", reason: "Position reçue hors ordre (archivée)", impliedSpeedKmh, flags };
  }

  // 8. Idempotence : identique (même horodatage ET même coordonnées
  //    que l'état courant) → doublon réseau probable.
  if (
    last &&
    last.positionAt !== null &&
    t === last.positionAt.getTime() &&
    last.latitude === point.latitude &&
    last.longitude === point.longitude
  ) {
    return { verdict: "DUPLICATE", reason: "Position déjà enregistrée", impliedSpeedKmh, flags };
  }

  if (flags.length > 0) {
    return { verdict: "ACCEPT_FLAGGED", reason: flags.join(","), impliedSpeedKmh, flags };
  }
  return { verdict: "ACCEPT", reason: null, impliedSpeedKmh, flags };
}

/** Un verdict mène-t-il à une ÉCRITURE en base (historique) ? */
export function isRecordable(verdict: PositionVerdict): boolean {
  return verdict === "ACCEPT" || verdict === "ACCEPT_HISTORY_ONLY" || verdict === "ACCEPT_FLAGGED";
}

/** Un verdict mène-t-il à une MISE À JOUR de l'état courant ? */
export function updatesCurrentState(verdict: PositionVerdict): boolean {
  return verdict === "ACCEPT" || verdict === "ACCEPT_FLAGGED";
}

/** Libellés français des verdicts (réponses API + tests). */
export const VERDICT_LABELS: Record<PositionVerdict, string> = {
  ACCEPT: "Acceptée",
  ACCEPT_HISTORY_ONLY: "Archivée (hors ordre)",
  ACCEPT_FLAGGED: "Acceptée avec signalement",
  DUPLICATE: "Doublon (idempotent)",
  REJECT_INVALID_COORDS: "Rejetée — coordonnées invalides",
  REJECT_FUTURE_TIMESTAMP: "Rejetée — horodatage futur",
  REJECT_STALE_TIMESTAMP: "Rejetée — horodatage trop ancien",
  REJECT_IMPOSSIBLE_SPEED: "Rejetée — vitesse impossible",
  REJECT_TELEPORT: "Rejetée — déplacement impossible",
};
