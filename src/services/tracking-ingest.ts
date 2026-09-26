// ============================================================
// OCÉAN DU NORD — Pipeline d'ingestion GPS V5 (§7-§14, §27, §38)
//
// Point d'entrée UNIQUE du traitement des positions (isolées ou
// lot) : validation → idempotence → écriture → état courant
// conditionnel (anti-hors-ordre, y compris sous concurrence) →
// machine à états → géofences → événements → temps réel.
//
// Garanties :
//   - idempotence : un positionId déjà connu → réponse DOUBLON,
//     aucune seconde ligne, aucune erreur (§9) ;
//   - isolation multi-bus : tout est scopé par sessionId issu de
//     la session du chauffeur authentifié — JAMAIS une variable
//     globale (§13) ;
//   - une seule position invalide ne fait JAMAIS échouer un lot :
//     verdict PAR position (§38) ;
//   - l'état courant ne recule JAMAIS (updateMany conditionnel sur
//     lastPositionAt — atomique en base, §12/§27) ;
//   - le temps réel et les événements sont best-effort : jamais
//     bloquants pour l'écriture (§29).
// ============================================================

import { db } from "@/lib/db";
import { GPS_V5 } from "@/lib/gps-config";
import { logTrackingEvent } from "@/services/tracking-events";
import { applyGeofence, type GeofenceState } from "@/services/tracking-geofence";
import {
  isRecordable,
  updatesCurrentState,
  validatePosition,
  type LastKnownState,
  type PositionVerdict,
} from "@/services/tracking-validate";
import { emitRealtime, maybeMarkArrival } from "@/services/tracking";

/** Position brute reçue du téléphone (déjà désérialisée par la route). */
export interface IngestPoint {
  positionId?: string | null;
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  altitude?: number | null;
  batteryLevel?: number | null;
  recordedAt: Date;
}

/** Session minimale requise par le pipeline (chargée par la route). */
export interface IngestSession {
  id: string;
  driverId: string;
  tripId: string | null;
  busId: string | null;
  agencyId: string;
  deviceId: string | null;
  lastPositionAt: Date | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastSpeed: number | null;
  lastBatteryLevel?: number | null;
  geofenceStopId: string | null;
  geofenceEnteredAt: Date | null;
  tripPhase: string | null;
}

export interface IngestPointResult {
  positionId: string | null;
  verdict: PositionVerdict;
  reason: string | null;
}

export interface IngestOutcome {
  results: IngestPointResult[];
  /** Positions écrites en base (historique compris). */
  accepted: number;
  /** Positions refusées (invalides — jugement définitif §38). */
  rejected: number;
  /** Doublons idempotents (rien d'écrit, réponse 200). */
  duplicates: number;
  /** L'état courant de la session a-t-il été avancé ? */
  stateUpdated: boolean;
  /** Arrivée à destination détectée pendant ce lot. */
  destinationArrived: boolean;
  routeLabel: string | null;
}

function lastKnownOf(session: IngestSession): LastKnownState {
  return {
    latitude: session.lastLatitude,
    longitude: session.lastLongitude,
    speed: session.lastSpeed,
    positionAt: session.lastPositionAt,
  };
}

/** Événement temps réel « gps » (payload V5 enrichi, rétrocompatible). */
async function emitGpsRealtime(input: {
  session: IngestSession;
  point: IngestPoint;
  tripPhase: string | null;
}): Promise<void> {
  await emitRealtime({
    room: "fleet",
    event: "gps",
    payload: {
      sessionId: input.session.id,
      busId: input.session.busId,
      tripId: input.session.tripId,
      agencyId: input.session.agencyId,
      latitude: input.point.latitude,
      longitude: input.point.longitude,
      speed: input.point.speed ?? null,
      heading: input.point.heading ?? null,
      accuracy: input.point.accuracy ?? null,
      batteryLevel: input.point.batteryLevel ?? null,
      recordedAt: input.point.recordedAt.toISOString(),
      positionId: input.point.positionId ?? null,
      tripPhase: input.tripPhase,
    },
  });
}

/**
 * Ingestion d'une LISTE de positions (déjà triées par recordedAt
 * croissant — l'ordre est garanti par les routes). Le pipeline :
 *
 *  1. validation pure de chaque position contre l'état roulant ;
 *  2. idempotence : positionIds déjà en base (1 requête) + doublons
 *     internes au lot → DUPLICATE ;
 *  3. écriture groupée (createMany, repli point par point si course
 *     concurrente P2002) ;
 *  4. état courant : updateMany CONDITIONNEL (lastPositionAt plus
 *     ancien ou null) → jamais de retour en arrière, même sous
 *     concurrence (§12/§27) ;
 *  5. géofences + arrivée destination uniquement sur l'état avancé ;
 *  6. événements d'audit (rejets/anomalies) + temps réel best-effort.
 */
export async function ingestPositions(input: {
  session: IngestSession;
  points: IngestPoint[]; // triées croissantes
  actorUserId: string | null;
  deviceId?: string | null;
  now?: Date;
}): Promise<IngestOutcome> {
  const now = input.now ?? new Date();
  const { session, points } = input;
  const results: IngestPointResult[] = [];
  const outcome: IngestOutcome = {
    results,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    stateUpdated: false,
    destinationArrived: false,
    routeLabel: null,
  };
  if (points.length === 0) return outcome;

  // ---- 1. Validation roulante (état initial = session) ----
  let rolling: LastKnownState = lastKnownOf(session);
  const verdicts: { point: IngestPoint; verdict: PositionVerdict; reason: string | null }[] = [];
  for (const point of points) {
    const v = validatePosition({ point, last: rolling, now });
    verdicts.push({ point, verdict: v.verdict, reason: v.reason });
    if (updatesCurrentState(v.verdict)) {
      rolling = { latitude: point.latitude, longitude: point.longitude, speed: point.speed ?? null, positionAt: point.recordedAt };
    }
  }

  // ---- 2. Idempotence : positionIds connus (base + lot) ----
  const idsInBatch = new Set<string>();
  const knownIds = new Set<string>();
  for (const { point } of verdicts) {
    if (point.positionId) {
      if (idsInBatch.has(point.positionId)) knownIds.add(point.positionId);
      idsInBatch.add(point.positionId);
    }
  }
  if (idsInBatch.size > 0) {
    const existing = await db.gpsPoint.findMany({
      where: { sessionId: session.id, positionId: { in: [...idsInBatch] } },
      select: { positionId: true },
    });
    for (const row of existing) {
      if (row.positionId) knownIds.add(row.positionId);
    }
  }

  // ---- 3. Écriture des positions recordables non dupliquées ----
  const toWrite = verdicts.filter(
    (v) => isRecordable(v.verdict) && !(v.point.positionId && knownIds.has(v.point.positionId))
  );
  if (toWrite.length > 0) {
    const rows = toWrite.map((v) => ({
      sessionId: session.id,
      positionId: v.point.positionId ?? null,
      latitude: v.point.latitude,
      longitude: v.point.longitude,
      speed: v.point.speed ?? null,
      heading: v.point.heading ?? null,
      accuracy: v.point.accuracy ?? null,
      altitude: v.point.altitude ?? null,
      batteryLevel: v.point.batteryLevel ?? null,
      recordedAt: v.point.recordedAt,
    }));
    try {
      await db.gpsPoint.createMany({ data: rows });
    } catch {
      // Course concurrente sur l'unicité (P2002) : repli point à
      // point — les perdants deviennent des doublons idempotents.
      for (const v of toWrite) {
        try {
          await db.gpsPoint.create({
            data: {
              sessionId: session.id,
              positionId: v.point.positionId ?? null,
              latitude: v.point.latitude,
              longitude: v.point.longitude,
              speed: v.point.speed ?? null,
              heading: v.point.heading ?? null,
              accuracy: v.point.accuracy ?? null,
              altitude: v.point.altitude ?? null,
              batteryLevel: v.point.batteryLevel ?? null,
              recordedAt: v.point.recordedAt,
            },
          });
        } catch {
          // Doublon concurrent — idempotent, rien à faire.
        }
      }
    }
  }

  // ---- 4. Résultats par position (§38) ----
  for (const v of verdicts) {
    const duplicate = Boolean(v.point.positionId && knownIds.has(v.point.positionId));
    const verdict: PositionVerdict = duplicate ? "DUPLICATE" : v.verdict;
    results.push({ positionId: v.point.positionId ?? null, verdict, reason: duplicate ? "Position déjà enregistrée" : v.reason });
    if (duplicate) outcome.duplicates += 1;
    else if (isRecordable(v.verdict)) outcome.accepted += 1;
    else outcome.rejected += 1;

    // Audit des rejets (§28) — événement WARN, best-effort.
    if (!duplicate && !isRecordable(v.verdict)) {
      await logTrackingEvent({
        type: "GPS_POSITION_REJECTED",
        severity: "WARN",
        sessionId: session.id,
        tripId: session.tripId,
        busId: session.busId,
        driverId: session.driverId,
        agencyId: session.agencyId,
        message: v.reason ?? "Position rejetée",
        payload: { verdict: v.verdict, positionId: v.point.positionId ?? null, latitude: v.point.latitude, longitude: v.point.longitude, speed: v.point.speed ?? null },
        broadcast: false,
      });
    }
    // Anomalies signalées (§8) — position conservée mais auditée.
    if (!duplicate && v.verdict === "ACCEPT_FLAGGED") {
      await logTrackingEvent({
        type: "GPS_ANOMALY_DETECTED",
        severity: "WARN",
        sessionId: session.id,
        tripId: session.tripId,
        busId: session.busId,
        driverId: session.driverId,
        agencyId: session.agencyId,
        message: `Position suspecte : ${v.reason ?? "anomalie"}`,
        payload: { positionId: v.point.positionId ?? null, latitude: v.point.latitude, longitude: v.point.longitude, speed: v.point.speed ?? null, accuracy: v.point.accuracy ?? null },
        broadcast: false,
      });
    }
  }

  // ---- 5. État courant AVANCÉ (le plus récent des positions valides) ----
  const newest = [...verdicts].reverse().find((v) => updatesCurrentState(v.verdict) && !(v.point.positionId && knownIds.has(v.point.positionId)));
  if (newest) {
    const point = newest.point;
    // Conditionnel : ne remplace QUE si plus récent que l'état connu
    // (atomique — protège aussi des ingests concurrents §27).
    const updated = await db.trackingSession.updateMany({
      where: {
        id: session.id,
        OR: [{ lastPositionAt: { lt: point.recordedAt } }, { lastPositionAt: null }],
      },
      data: {
        lastPositionAt: point.recordedAt,
        lastLatitude: point.latitude,
        lastLongitude: point.longitude,
        lastSpeed: point.speed ?? null,
        lastHeading: point.heading ?? null,
        lastAccuracy: point.accuracy ?? null,
        lastBatteryLevel: point.batteryLevel ?? null,
        // Une position fraîche prouve aussi que le téléphone est vivant.
        lastHeartbeatAt: now,
      },
    });
    outcome.stateUpdated = updated.count > 0;

    if (outcome.stateUpdated) {
      // Transitions métier (machine à états §22) : premier point reçu
      // → le voyage est réellement PARTI (SCHEDULED/BOARDING → DEPARTED,
      // updateMany conditionnel = transition légale et unique).
      if (session.tripId) {
        await db.trip.updateMany({
          where: { id: session.tripId, status: { in: ["SCHEDULED", "BOARDING"] } },
          data: { status: "DEPARTED" },
        });
      }

      // Moteur de géofences (§20/§21) — best-effort absolu.
      const geofence = await applyGeofence({
        sessionId: session.id,
        tripId: session.tripId,
        busId: session.busId,
        driverId: session.driverId,
        agencyId: session.agencyId,
        state: {
          lastPassedStopId: session.geofenceStopId,
          candidateEnteredAt: session.geofenceEnteredAt,
          tripPhase: (session.tripPhase as GeofenceState["tripPhase"]) ?? null,
        },
        point: {
          latitude: point.latitude,
          longitude: point.longitude,
          speed: point.speed ?? null,
          accuracy: point.accuracy ?? null,
          recordedAt: point.recordedAt,
        },
        now,
      });

      // Arrivée DURABLE à destination (§21) → transition métier Trip
      // ARRIVED (updateMany conditionnel anti double-marquage V4).
      if (geofence.destinationArrived && session.tripId) {
        const arrival = await maybeMarkArrival({
          sessionId: session.id,
          tripId: session.tripId,
          lastPoint: { latitude: point.latitude, longitude: point.longitude },
          actorUserId: input.actorUserId,
        });
        outcome.destinationArrived = arrival?.arrived === true;
        outcome.routeLabel = arrival?.routeLabel ?? null;
      }

      // Temps réel : la position qui a fait avancer l'état (phase
      // éventuellement mise à jour par le moteur de géofences).
      await emitGpsRealtime({
        session,
        point,
        tripPhase: geofence.tripPhase ?? session.tripPhase,
      });
    }
  }

  // Changement de téléphone détecté (§6/§28) — accepté mais audité.
  if (input.deviceId && session.deviceId && input.deviceId !== session.deviceId) {
    await logTrackingEvent({
      type: "GPS_DEVICE_CHANGED",
      severity: "WARN",
      sessionId: session.id,
      tripId: session.tripId,
      busId: session.busId,
      driverId: session.driverId,
      agencyId: session.agencyId,
      message: "Positions reçues d'un téléphone différent de celui du démarrage",
      payload: { expected: session.deviceId, received: input.deviceId },
      broadcast: false,
    });
  }

  return outcome;
}

// ============================================================
// HEARTBEAT (§11) — battement de cœur SÉPARÉ des positions.
// ============================================================

export interface HeartbeatResult {
  /** true si le heartbeat a été enregistré (session ACTIVE). */
  ok: boolean;
  /** Position encore fraîche côté serveur ? (info au chauffeur) */
  positionFresh: boolean;
  sessionStatus: string;
}

/** Enregistre un heartbeat : prouve que le téléphone est en ligne
 *  SANS forcément avoir de position GPS (tunnel, GPS perdu…). */
export async function recordHeartbeat(input: {
  session: { id: string; status: string; lastPositionAt: Date | null; lastHeartbeatAt: Date | null };
  batteryLevel?: number | null;
  now?: Date;
}): Promise<HeartbeatResult> {
  const now = input.now ?? new Date();
  if (input.session.status !== "ACTIVE") {
    return { ok: false, positionFresh: false, sessionStatus: input.session.status };
  }
  await db.trackingSession.update({
    where: { id: input.session.id },
    data: { lastHeartbeatAt: now },
  });
  const positionFresh =
    input.session.lastPositionAt !== null && now.getTime() - input.session.lastPositionAt.getTime() <= GPS_V5.heartbeatOfflineMs;
  return { ok: true, positionFresh, sessionStatus: input.session.status };
}
