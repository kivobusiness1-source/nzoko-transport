// ============================================================
// NZOKO TRANSPORT — Moteur de géofences V5 (§15, §20, §21, §23)
//
// Décisions PURES (aucune E/S, testables) + orchestrateur DB avec
// cache mémoire des arrêts (§25 : pas de requête par position).
//
// MODÈLE D'ÉTAT (les 3 colonnes dénormalisées de TrackingSession) :
//   geofenceStopId    = DERNIER arrêt atteint (persiste après le
//                       départ — sert d'index de progression) ;
//   geofenceEnteredAt = entrée dans la zone du CANDIDAT courant
//                       (dwell en cours, pas encore confirmé) ;
//   tripPhase         = AT_STOP quand le car est DANS la zone de
//                       l'arrêt confirmé, sinon IN_TRANSIT/ARRIVING.
//
// Le CANDIDAT est TOUJOURS l'arrêt suivant le dernier atteint
// (ordre des arrêts §20) — jamais un arrêt arbitraire : un point
// proche d'un arrêt déjà passé ou très éloigné dans l'ordre ne
// déclenche RIEN. La destination (dernier « arrêt » virtuel)
// suit la MÊME mécanique (dwell + hystérésis) → arrivée DURABLE
// §21, puis le trip passe ARRIVED (updateMany conditionnel V4).
//
// ANTI-Faux-positifs GPS (§20) :
//   - entrée : distance ≤ rayon (le rayon couvre la précision) ;
//   - confirmation : séjour ≥ stopMinDwellMs ET vitesse ≤ seuil
//     (ou séjour ≥ 2× dwell même en mouvement lent) ;
//   - sortie : distance > rayon × stopExitFactor (hystérésis) ;
//   - arrêts « sautés » : horaire prévu dépassé de > skipGraceMs
//     et car loin → candidat suivant (progression sans événement).
// ============================================================

import { db } from "@/lib/db";
import { GPS_SERVER, GPS_V5 } from "@/lib/gps-config";
import { haversineMeters } from "@/lib/geo";
import { deriveDelayStatus, type DelayStatus, type SessionTripPhase } from "@/lib/trip-state-machine";
import { logTrackingEvent } from "@/services/tracking-events";
import { emitRealtime, routeLabelOf } from "@/services/tracking";

// ------------------------------------------------------------
// Types partagés
// ------------------------------------------------------------

/** Arrêt complet du voyage (intermédiaires + destination virtuelle). */
export interface TripStopInfo {
  /** RouteStop.id, ou `dest:<tripId>` pour la destination virtuelle. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Rayon EFFECTIF (override RouteStop.radiusM sinon défaut config). */
  radiusM: number;
  /** Minutes prévues depuis le départ (horaires §23). */
  minutesFromStart: number;
  isDestination: boolean;
}

/** État géofence d'une session (colonnes dénormalisées). */
export interface GeofenceState {
  lastPassedStopId: string | null;
  candidateEnteredAt: Date | null;
  tripPhase: SessionTripPhase | null;
}

export interface GeofencePoint {
  latitude: number;
  longitude: number;
  /** km/h (null = inconnue). */
  speed: number | null;
  /** mètres */
  accuracy: number | null;
  recordedAt: Date;
}

export type GeofenceDecision =
  | { action: "NONE" }
  | { action: "ENTER_CANDIDATE" }
  | { action: "EXIT_CANDIDATE" }
  | { action: "ARRIVAL_CONFIRMED"; stop: TripStopInfo; dwellMs: number }
  | { action: "DEPARTURE_CONFIRMED"; stop: TripStopInfo };

/** Résultat complet de la décision (orchestrateur + tests). */
export interface GeofenceEvaluation {
  decision: GeofenceDecision;
  /** Nouvel état géofence à persister (null = inchangé). */
  nextState: GeofenceState | null;
  /** Phase technique courante après décision. */
  phase: SessionTripPhase | null;
  /** Distance (m) au candidat/arrêt courant — null si plus d'arrêt. */
  candidateDistanceM: number | null;
  /** Prochain arrêt pour l'affichage (§15) — null si arrivé/indéterminé. */
  nextStop: TripStopInfo | null;
}

// ------------------------------------------------------------
// Décision PURE — le cœur testable du moteur
// ------------------------------------------------------------

/** Durée de grâce avant de considérer un arrêt comme « sauté ». */
const SKIP_GRACE_MS = 45 * 60 * 1000;

export interface DecideGeofenceInput {
  point: GeofencePoint;
  stops: TripStopInfo[]; // ordonnés, dernier = destination
  state: GeofenceState;
  departureTime: Date;
  now?: Date;
  config?: {
    stopExitFactor: number;
    stopMinDwellMs: number;
    stoppedSpeedKmh: number;
  };
}

/** Index du dernier arrêt atteint (-1 si aucun). */
function passedIndex(stops: TripStopInfo[], lastPassedStopId: string | null): number {
  if (!lastPassedStopId) return -1;
  const idx = stops.findIndex((s) => s.id === lastPassedStopId);
  return idx; // -1 si inconnu (arrêt supprimé) → repart du début
}

/**
 * Évalue la position par rapport aux arrêts du voyage et produit la
 * décision + le prochain état. FONCTION PURE (aucune E/S).
 */
export function decideGeofence(input: DecideGeofenceInput): GeofenceEvaluation {
  const now = input.now ?? new Date();
  const cfg = input.config ?? {
    stopExitFactor: GPS_V5.stopExitFactor,
    stopMinDwellMs: GPS_V5.stopMinDwellMs,
    stoppedSpeedKmh: GPS_SERVER.stoppedSpeedKmh,
  };
  const { stops, state, point } = input;
  if (stops.length === 0) {
    return { decision: { action: "NONE" }, nextState: null, phase: state.tripPhase, candidateDistanceM: null, nextStop: null };
  }

  const lastIdx = passedIndex(stops, state.lastPassedStopId);
  // Arrêt confirmé = le car est DANS la zone de l'arrêt lastIdx.
  const insideConfirmed = state.tripPhase === "AT_STOP" && lastIdx >= 0;
  const currentStop = insideConfirmed ? stops[lastIdx] : null;

  if (insideConfirmed && currentStop) {
    const distanceM = haversineMeters(point, { latitude: currentStop.latitude, longitude: currentStop.longitude });
    const exitM = currentStop.radiusM * cfg.stopExitFactor;
    if (distanceM > exitM) {
      // Départ confirmé (hystérésis dépassé) — lastPassedStopId PERSISTE
      // (progression), la phase redevient IN_TRANSIT (ou ARRIVING si le
      // dernier arrêt atteint était la destination — cas anormal géré
      // par l'orchestrateur, ici on reste IN_TRANSIT).
      return {
        decision: { action: "DEPARTURE_CONFIRMED", stop: currentStop },
        nextState: { lastPassedStopId: currentStop.id, candidateEnteredAt: null, tripPhase: "IN_TRANSIT" },
        phase: "IN_TRANSIT",
        candidateDistanceM: distanceM,
        nextStop: stops[lastIdx + 1] ?? null,
      };
    }
    // Toujours dans la zone : rien à faire (l'arrêt est déjà confirmé).
    return {
      decision: { action: "NONE" },
      nextState: null,
      phase: "AT_STOP",
      candidateDistanceM: distanceM,
      nextStop: stops[lastIdx + 1] ?? null,
    };
  }

  // ---- Le car n'est pas à un arrêt confirmé : évaluer le candidat ----
  // Candidat = premier arrêt après le dernier atteint dont l'horaire
  // n'est pas dépassé de plus de SKIP_GRACE_MS (les arrêts sautés sont
  // franchis SANS événement), sinon le dernier arrêt restant.
  let candidateIdx = lastIdx + 1;
  while (candidateIdx < stops.length - 1) {
    const scheduledAt = new Date(input.departureTime.getTime() + stops[candidateIdx].minutesFromStart * 60_000);
    const farGone = scheduledAt.getTime() + SKIP_GRACE_MS < now.getTime();
    if (!farGone) break;
    candidateIdx += 1; // arrêt sauté (horaire très dépassé)
  }
  if (candidateIdx >= stops.length) candidateIdx = stops.length - 1;
  const candidate = stops[candidateIdx];
  const distanceM = haversineMeters(point, { latitude: candidate.latitude, longitude: candidate.longitude });

  // Le candidat est-il la destination déjà atteinte ? (trip ARRIVED
  // géré par ailleurs — ici le moteur ne re-détecte rien.)
  if (state.candidateEnteredAt !== null) {
    const dwellMs = now.getTime() - state.candidateEnteredAt.getTime();
    const stillInside = distanceM <= candidate.radiusM;
    if (!stillInside) {
      // Sorti avant le dwell minimal → faux positif GPS filtré (§20) :
      // on nettoie la candidature SANS événement.
      return {
        decision: { action: "EXIT_CANDIDATE" },
        nextState: { lastPassedStopId: state.lastPassedStopId, candidateEnteredAt: null, tripPhase: state.tripPhase ?? "IN_TRANSIT" },
        phase: state.tripPhase ?? "IN_TRANSIT",
        candidateDistanceM: distanceM,
        nextStop: candidate,
      };
    }
    const speedOk = point.speed === null || point.speed <= cfg.stoppedSpeedKmh;
    const dwellOk = dwellMs >= cfg.stopMinDwellMs && (speedOk || dwellMs >= 2 * cfg.stopMinDwellMs);
    if (dwellOk) {
      // Arrivée CONFIRMÉE (durable) — destination incluse (§21).
      const phase: SessionTripPhase = candidate.isDestination ? "ARRIVING" : "AT_STOP";
      return {
        decision: { action: "ARRIVAL_CONFIRMED", stop: candidate, dwellMs },
        nextState: { lastPassedStopId: candidate.id, candidateEnteredAt: null, tripPhase: phase },
        phase,
        candidateDistanceM: distanceM,
        nextStop: stops[candidateIdx + 1] ?? null,
      };
    }
    // Toujours candidat (dwell en cours) — pas de changement d'état.
    return { decision: { action: "NONE" }, nextState: null, phase: state.tripPhase ?? "IN_TRANSIT", candidateDistanceM: distanceM, nextStop: candidate };
  }

  // Pas de candidat en cours : entrée dans la zone du candidat ?
  if (distanceM <= candidate.radiusM) {
    return {
      decision: { action: "ENTER_CANDIDATE" },
      nextState: { lastPassedStopId: state.lastPassedStopId, candidateEnteredAt: now, tripPhase: state.tripPhase ?? "IN_TRANSIT" },
      phase: state.tripPhase ?? "IN_TRANSIT",
      candidateDistanceM: distanceM,
      nextStop: candidate,
    };
  }

  // Hors de toute zone : phase IN_TRANSIT, sauf approche destination.
  const destination = stops[stops.length - 1];
  const distanceToDestinationM = haversineMeters(point, { latitude: destination.latitude, longitude: destination.longitude });
  const phase: SessionTripPhase = distanceToDestinationM <= GPS_V5.approachingRadiusM ? "ARRIVING" : "IN_TRANSIT";
  const phaseChanged = phase !== state.tripPhase;
  return {
    decision: phaseChanged && phase === "ARRIVING" ? { action: "NONE" } : { action: "NONE" },
    nextState: phase !== state.tripPhase ? { lastPassedStopId: state.lastPassedStopId, candidateEnteredAt: null, tripPhase: phase } : null,
    phase,
    candidateDistanceM: distanceM,
    nextStop: candidate,
  };
}

// ------------------------------------------------------------
// Progression & ETA & retard (§15, §23) — purs
// ------------------------------------------------------------

export interface StopProgress {
  nextStop: TripStopInfo | null;
  /** Distance au prochain arrêt (m) — null si indéterminable. */
  distanceM: number | null;
  /** ETA estimé (ISO) basé sur la vitesse effective. */
  etaIso: string | null;
  /** Horaire prévu de passage au prochain arrêt (ISO). */
  scheduledIso: string | null;
  /** Retard au prochain arrêt (minutes ; négatif = en avance). */
  delayMin: number | null;
  delayStatus: DelayStatus | null;
  /** Distance à la destination finale (m). */
  distanceToDestinationM: number | null;
}

export interface StopProgressInput {
  stops: TripStopInfo[];
  state: GeofenceState;
  lastPoint: { latitude: number; longitude: number; speed: number | null } | null;
  departureTime: Date;
  now?: Date;
}

/** Calcule la progression vers le prochain arrêt + ETA + retard. */
export function computeStopProgress(input: StopProgressInput): StopProgress {
  const now = input.now ?? new Date();
  const { stops, state, lastPoint } = input;
  if (stops.length === 0 || !lastPoint) {
    return { nextStop: null, distanceM: null, etaIso: null, scheduledIso: null, delayMin: null, delayStatus: null, distanceToDestinationM: null };
  }

  const lastIdx = passedIndex(stops, state.lastPassedStopId);
  const atDestination = lastIdx === stops.length - 1;
  const destination = stops[stops.length - 1];
  const distanceToDestinationM = haversineMeters(lastPoint, { latitude: destination.latitude, longitude: destination.longitude });

  if (atDestination) {
    // Arrivé à destination : plus de prochain arrêt.
    return { nextStop: null, distanceM: null, etaIso: null, scheduledIso: null, delayMin: null, delayStatus: null, distanceToDestinationM };
  }

  // Prochain arrêt : candidat courant (même logique de saut que le moteur).
  let nextIdx = lastIdx + 1;
  while (nextIdx < stops.length - 1) {
    const scheduledAt = new Date(input.departureTime.getTime() + stops[nextIdx].minutesFromStart * 60_000);
    if (scheduledAt.getTime() + SKIP_GRACE_MS >= now.getTime()) break;
    nextIdx += 1;
  }
  if (nextIdx >= stops.length) nextIdx = stops.length - 1;
  const nextStop = stops[nextIdx];

  const distanceM = haversineMeters(lastPoint, { latitude: nextStop.latitude, longitude: nextStop.longitude });
  const scheduledAt = new Date(input.departureTime.getTime() + nextStop.minutesFromStart * 60_000);

  // Vitesse effective : instantanée si exploitable, sinon croisière.
  const speedKmh = lastPoint.speed !== null && lastPoint.speed > 10 ? lastPoint.speed : GPS_V5.cruiseSpeedKmh;
  const etaMs = now.getTime() + (distanceM / 1000 / speedKmh) * 3_600_000;
  const delayMin = Math.round((etaMs - scheduledAt.getTime()) / 60_000);

  return {
    nextStop,
    distanceM: Math.round(distanceM),
    etaIso: new Date(etaMs).toISOString(),
    scheduledIso: scheduledAt.toISOString(),
    delayMin,
    delayStatus: deriveDelayStatus({ delayMin, slightMin: GPS_V5.delaySlightMin, heavyMin: GPS_V5.delayHeavyMin }),
    distanceToDestinationM: Math.round(distanceToDestinationM),
  };
}

// ------------------------------------------------------------
// Orchestrateur DB — cache des arrêts + application des décisions
// ------------------------------------------------------------

/** Cache mémoire des arrêts par voyage (TTL 5 min, §25 : zéro
 *  requête répétée pendant un trajet actif). */
const STOPS_CACHE_TTL_MS = 5 * 60 * 1000;
const stopsCache = new Map<string, { stops: TripStopInfo[]; departureTime: Date; expiresAt: number }>();

function pruneStopsCache(now: number): void {
  if (stopsCache.size < 200) return;
  for (const [key, entry] of stopsCache) {
    if (entry.expiresAt < now) stopsCache.delete(key);
  }
}

/** Charge les arrêts d'un voyage (intermédiaires + destination
 *  virtuelle) — cache mémoire 5 min. null si voyage introuvable. */
export async function getTripStops(tripId: string): Promise<{ stops: TripStopInfo[]; departureTime: Date } | null> {
  const now = Date.now();
  const cached = stopsCache.get(tripId);
  if (cached && cached.expiresAt > now) return { stops: cached.stops, departureTime: cached.departureTime };
  pruneStopsCache(now);

  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      departureTime: true,
      route: {
        select: {
          estimatedDurationMinutes: true,
          destinationCity: { select: { id: true, name: true, latitude: true, longitude: true } },
          stops: {
            where: { city: { latitude: { not: null }, longitude: { not: null } } },
            orderBy: { position: "asc" },
            select: { id: true, radiusM: true, minutesFromStart: true, city: { select: { name: true, latitude: true, longitude: true } } },
          },
        },
      },
    },
  });
  if (!trip || !trip.route) return null;

  const stops: TripStopInfo[] = trip.route.stops.map((s) => ({
    id: s.id,
    name: s.city.name,
    latitude: s.city.latitude as number,
    longitude: s.city.longitude as number,
    radiusM: s.radiusM ?? GPS_V5.stopRadiusM,
    minutesFromStart: s.minutesFromStart,
    isDestination: false,
  }));
  const dest = trip.route.destinationCity;
  if (dest && dest.latitude !== null && dest.longitude !== null) {
    stops.push({
      id: `dest:${tripId}`,
      name: dest.name,
      latitude: dest.latitude,
      longitude: dest.longitude,
      // Destination : rayon d'arrivée dédié (autorité GPS_SERVER).
      radiusM: GPS_SERVER.arrivalRadiusM,
      minutesFromStart: trip.route.estimatedDurationMinutes,
      isDestination: true,
    });
  }

  const entry = { stops, departureTime: trip.departureTime, expiresAt: now + STOPS_CACHE_TTL_MS };
  stopsCache.set(tripId, entry);
  return { stops, departureTime: trip.departureTime };
}

/** Invalide le cache d'un voyage (utile après édition des arrêts). */
export function invalidateTripStops(tripId: string): void {
  stopsCache.delete(tripId);
}

/** Contexte d'application d'une décision géofence. */
export interface ApplyGeofenceInput {
  sessionId: string;
  tripId: string | null;
  busId: string | null;
  driverId: string;
  agencyId: string;
  state: GeofenceState;
  point: GeofencePoint;
  now?: Date;
}

export interface ApplyGeofenceResult {
  decisionAction: GeofenceDecision["action"];
  /** La destination vient-elle d'être atteinte durablement ? */
  destinationArrived: boolean;
  stopName: string | null;
  nextStopName: string | null;
  /** Phase technique APRÈS application (pour le temps réel). */
  tripPhase: SessionTripPhase | null;
}

/**
 * Évalue + APPLIQUE la géofence pour une position fraîche (appelé
 * par l'ingestion après écriture du point). BEST-EFFORT : aucune
 * erreur ici ne fait échouer l'enregistrement de la position.
 */
export async function applyGeofence(input: ApplyGeofenceInput): Promise<ApplyGeofenceResult> {
  const empty: ApplyGeofenceResult = { decisionAction: "NONE", destinationArrived: false, stopName: null, nextStopName: null, tripPhase: input.state.tripPhase };
  try {
    if (!input.tripId) return empty;
    const tripStops = await getTripStops(input.tripId);
    if (!tripStops || tripStops.stops.length === 0) return empty;

    const evaluation = decideGeofence({
      point: input.point,
      stops: tripStops.stops,
      state: input.state,
      departureTime: tripStops.departureTime,
      now: input.now,
    });

    const decision = evaluation.decision;
    if (decision.action !== "NONE" && evaluation.nextState) {
      // Persistance de l'état géofence (seule la session change ici).
      await db.trackingSession.update({
        where: { id: input.sessionId },
        data: {
          geofenceStopId: evaluation.nextState.lastPassedStopId,
          geofenceEnteredAt: evaluation.nextState.candidateEnteredAt,
          tripPhase: evaluation.nextState.tripPhase,
        },
      });
    }

    switch (decision.action) {
      case "ARRIVAL_CONFIRMED": {
        const stop = decision.stop;
        if (stop.isDestination) {
          // §21 — arrivée DURABLE à destination : événement dédié +
          // transition métier Trip → ARRIVED (gérée par le flux appelant
          // via maybeMarkArrival, appelé juste après ; on émet ici
          // l'événement observabilité).
          await logTrackingEvent({
            type: "DESTINATION_ARRIVED",
            severity: "INFO",
            sessionId: input.sessionId,
            tripId: input.tripId,
            busId: input.busId,
            driverId: input.driverId,
            agencyId: input.agencyId,
            message: `Arrivée détectée à ${stop.name}`,
            payload: { stopId: stop.id, dwellMs: decision.dwellMs, distanceM: Math.round(evaluation.candidateDistanceM ?? 0) },
          });
          return { decisionAction: decision.action, destinationArrived: true, stopName: stop.name, nextStopName: null, tripPhase: "ARRIVING" };
        }
        await logTrackingEvent({
          type: "STOP_ARRIVAL_DETECTED",
          severity: "INFO",
          sessionId: input.sessionId,
          tripId: input.tripId,
          busId: input.busId,
          driverId: input.driverId,
          agencyId: input.agencyId,
          message: `Arrêt atteint : ${stop.name}`,
          payload: { stopId: stop.id, dwellMs: decision.dwellMs, position: stop.minutesFromStart },
        });
        return { decisionAction: decision.action, destinationArrived: false, stopName: stop.name, nextStopName: evaluation.nextStop?.name ?? null, tripPhase: "AT_STOP" };
      }
      case "DEPARTURE_CONFIRMED": {
        await logTrackingEvent({
          type: "STOP_DEPARTURE_DETECTED",
          severity: "INFO",
          sessionId: input.sessionId,
          tripId: input.tripId,
          busId: input.busId,
          driverId: input.driverId,
          agencyId: input.agencyId,
          message: `Départ de l'arrêt : ${decision.stop.name}`,
          payload: { stopId: decision.stop.id },
        });
        return { decisionAction: decision.action, destinationArrived: false, stopName: decision.stop.name, nextStopName: evaluation.nextStop?.name ?? null, tripPhase: "IN_TRANSIT" };
      }
      default:
        return { decisionAction: decision.action, destinationArrived: false, stopName: null, nextStopName: evaluation.nextStop?.name ?? null, tripPhase: evaluation.phase };
    }
  } catch (err) {
    // Best-effort absolu : la position reste enregistrée.
    console.warn("[geofence] application impossible (best-effort) :", err instanceof Error ? err.message : err);
    return empty;
  }
}

/** Progression formatée pour le DTO flotte (utilise l'état session). */
export async function stopProgressOfSession(session: {
  id: string;
  tripId: string | null;
  geofenceStopId: string | null;
  tripPhase: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastSpeed: number | null;
}): Promise<StopProgress> {
  if (!session.tripId) {
    return { nextStop: null, distanceM: null, etaIso: null, scheduledIso: null, delayMin: null, delayStatus: null, distanceToDestinationM: null };
  }
  const tripStops = await getTripStops(session.tripId);
  if (!tripStops) {
    return { nextStop: null, distanceM: null, etaIso: null, scheduledIso: null, delayMin: null, delayStatus: null, distanceToDestinationM: null };
  }
  const hasPosition = session.lastLatitude !== null && session.lastLongitude !== null;
  return computeStopProgress({
    stops: tripStops.stops,
    state: {
      lastPassedStopId: session.geofenceStopId,
      candidateEnteredAt: null,
      tripPhase: (session.tripPhase as SessionTripPhase | null) ?? null,
    },
    lastPoint: hasPosition ? { latitude: session.lastLatitude as number, longitude: session.lastLongitude as number, speed: session.lastSpeed } : null,
    departureTime: tripStops.departureTime,
  });
}

/** Annonce temps réel de l'arrivée à destination (utilisé par le flux
 *  d'ingestion APRÈS maybeMarkArrival — payload enrichi V5). */
export async function announceDestinationArrival(input: {
  sessionId: string;
  tripId: string;
  routeLabel: string;
  at: string;
  busId: string | null;
}): Promise<void> {
  await emitRealtime({
    room: "fleet",
    event: "bus-arrived",
    payload: { sessionId: input.sessionId, tripId: input.tripId, routeLabel: input.routeLabel, busId: input.busId, at: input.at },
  });
}

/** Libellé de ligne réutilisé (miroir léger de tracking.ts). */
export { routeLabelOf };
