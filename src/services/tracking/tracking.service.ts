// ============================================================
// NZOKO TRANSPORT — Service tracking GPS (cœur du module V2)
//
// Flux d'ingestion d'une position (brief §19) :
//   validation → auth → authorization → session/trip/bus/driver
//   → enregistrement BusLocation + MAJ TrackingSession (TRANSACTION)
//   → détections (géofence arrivée, hors itinéraire) → realtime
//
// TrackingSession = position ACTUELLE (dashboard, O(1)).
// BusLocation = HISTORIQUE (jamais scanné pour la flotte).
// ============================================================

import { db } from "@/lib/db";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { TRACKING, FLEET_BUS_STATE_LABELS } from "@/lib/constants";
import type { FleetBusDTO, FleetSnapshotDTO, TrackingSessionDTO, TrackingEventDTO, TripHistoryDTO, TrackingActionResult, BatchResultDTO } from "@/types";
import {
  requireDriverContext, requireDriverOwnsTrip, requireDriverSession, requireFleetReadScope, assertTripReadAllowed, assertBusReadAllowed,
} from "@/services/tracking/tracking.authorization";
import type { DriverContext } from "@/services/tracking/tracking.authorization";
import {
  checkTimestampWindow, isAccuracyRejection, type GpsPoint,
} from "@/services/tracking/tracking.validation";
import * as repo from "@/services/tracking/tracking.repository";
import type { FleetSession } from "@/services/tracking/tracking.repository";
import { haversineM, isWithinGeofence, distanceToRouteM, connectivityFromLastSeen, isPlausibleSpeed, type GeoPoint } from "@/lib/geo";
import { realtime } from "@/services/tracking/realtime.service";
import { sendTrackingNotification } from "@/services/tracking/notification.service";
import { logger } from "@/services/tracking/tracking-logger";
import { logAudit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth";
import type { Prisma, TrackingSession } from "@prisma/client";

const sessionInclude = {
  bus: { select: { id: true, registrationNumber: true, fleetNumber: true, agencyId: true, agency: { select: { id: true, name: true } } } },
  driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
  trip: {
    select: {
      id: true, code: true, status: true,
      departureTime: true, estimatedArrivalTime: true,
      actualDepartureAt: true, actualArrivalAt: true,
      route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true, latitude: true, longitude: true } } } },
    },
  },
} satisfies Prisma.TrackingSessionInclude;

type SessionFull = Prisma.TrackingSessionGetPayload<{ include: typeof sessionInclude }>;

// ============================================================
// DTO MAPPERS
// ============================================================

function toSessionDTO(s: SessionFull | FleetSession | null): TrackingSessionDTO | null {
  if (!s) return null;
  const trip = s.trip;
  return {
    id: s.id,
    tripId: s.tripId,
    tripCode: trip?.code ?? "",
    status: s.status as TrackingSessionDTO["status"],
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    lastLatitude: s.lastLatitude,
    lastLongitude: s.lastLongitude,
    lastSpeed: s.lastSpeed,
    lastHeading: s.lastHeading,
    lastAccuracy: s.lastAccuracy,
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    offRoute: s.offRoute,
    originCityName: trip?.route.originCity.name ?? "",
    destinationCityName: trip?.route.destinationCity.name ?? "",
    destinationLatitude: trip?.route.destinationCity.latitude ?? null,
    destinationLongitude: trip?.route.destinationCity.longitude ?? null,
    busRegistration: s.bus.registrationNumber,
    busFleetNumber: s.bus.fleetNumber,
    agencyName: s.bus.agency.name,
    scheduledDeparture: trip?.departureTime.toISOString() ?? "",
    scheduledArrival: trip?.estimatedArrivalTime.toISOString() ?? "",
    actualDepartureAt: trip?.actualDepartureAt?.toISOString() ?? null,
    actualArrivalAt: trip?.actualArrivalAt?.toISOString() ?? null,
    tripStatus: trip?.status ?? "",
  };
}

function computeBusState(s: TrackingSession, now: Date): FleetBusDTO["state"] {
  if (s.status === "ENDED") return "ARRIVED";
  const conn = connectivityFromLastSeen(s.lastSeenAt, now);
  if (conn === "OFFLINE") return "OFFLINE";
  if (s.offRoute) return "OFF_ROUTE";
  if (s.status === "PAUSED") return "PAUSED";
  if (conn === "UNSTABLE") return "GPS_UNSTABLE";
  const speed = s.lastSpeed ?? 0;
  if (speed < TRACKING.stoppedSpeedKmh) return "STOPPED";
  return "EN_ROUTE";
}

function toFleetBusDTO(s: FleetSession, now: Date): FleetBusDTO {
  const trip = s.trip;
  const state = computeBusState(s, now);
  const delayed = Boolean(trip && trip.status === "DEPARTED" && now > trip.estimatedArrivalTime);
  const driver = s.driver;
  return {
    sessionId: s.id,
    busId: s.busId,
    registrationNumber: s.bus.registrationNumber,
    fleetNumber: s.bus.fleetNumber,
    agencyId: s.bus.agency.id,
    agencyName: s.bus.agency.name,
    driverFirstName: driver?.firstName ?? null,
    driverLastName: driver?.lastName ?? null,
    driverPhone: driver?.phone ?? null,
    tripId: trip?.id ?? null,
    tripCode: trip?.code ?? null,
    originCityName: trip?.route.originCity.name ?? null,
    destinationCityName: trip?.route.destinationCity.name ?? null,
    latitude: s.lastLatitude,
    longitude: s.lastLongitude,
    speed: s.lastSpeed,
    heading: s.lastHeading,
    accuracy: s.lastAccuracy,
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    state,
    stateLabel: FLEET_BUS_STATE_LABELS[state],
    tripStatus: trip?.status ?? null,
    offRoute: s.offRoute,
    delayed,
  };
}

function busLabel(fleetNumber: string | null, registration: string): string {
  return fleetNumber ?? registration;
}

// ============================================================
// CYCLE DE VIE DU SUIVI (chauffeur)
// ============================================================

/** DÉMARRER LE TRAJET (brief §18) — session + DEPARTED + événements + notifications. */
export async function startTracking(auth: AuthContext, tripId: string): Promise<TrackingActionResult> {
  const ctx = await requireDriverContext(auth);
  const trip = await requireDriverOwnsTrip(ctx, tripId);

  if (["ARRIVED", "COMPLETED", "CANCELLED"].includes(trip.status)) {
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce voyage est déjà terminé ou annulé.");
  }

  const existing = await repo.findLatestSessionForTrip(tripId);
  if (existing && (existing.status === "ACTIVE" || existing.status === "PAUSED")) {
    if (existing.driverId === ctx.driver.id) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Le suivi GPS est déjà démarré pour ce voyage.");
    }
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Un autre chauffeur a déjà démarré le suivi de ce voyage.");
  }

  // Clôture d'une éventuelle session oubliée du même chauffeur (robustesse)
  const stale = await repo.findDriverActiveSession(ctx.driver.id);
  if (stale) {
    await db.trackingSession.update({ where: { id: stale.id }, data: { status: "ENDED", endedAt: new Date() } });
    await repo.logTrackingEvent({
      tripId: stale.tripId, busId: stale.busId, driverId: stale.driverId,
      eventType: "GPS_STOPPED", metadata: { reason: "AUTO_END_STALE", note: "clôturée automatiquement au démarrage d'un nouveau voyage" },
    });
    logger.info("lifecycle", "session obsolète clôturée automatiquement", { sessionId: stale.id, tripId: stale.tripId });
  }

  const now = new Date();
  const session = await db.$transaction(async (tx) => {
    const s = await tx.trackingSession.create({
      data: {
        tripId, busId: trip.busId, driverId: ctx.driver.id,
        status: "ACTIVE", startedAt: now,
      },
    });
    await tx.trip.update({
      where: { id: tripId },
      data: { status: "DEPARTED", actualDepartureAt: trip.actualDepartureAt ?? now },
    });
    await tx.driver.update({ where: { id: ctx.driver.id }, data: { status: "ON_TRIP" } });
    return s;
  });

  await repo.logTrackingEvent({ tripId, busId: trip.busId, driverId: ctx.driver.id, eventType: "TRIP_STARTED", metadata: { session: session.id } });
  await repo.logTrackingEvent({ tripId, busId: trip.busId, driverId: ctx.driver.id, eventType: "GPS_STARTED", metadata: { session: session.id } });
  await logAudit({ userId: auth.userId, action: "TRACKING_STARTED", entity: "TrackingSession", entityId: session.id, metadata: { tripId, tripCode: trip.code } });

  const routeLabel = ""; // rempli ci-dessous via relecture
  const full = await db.trackingSession.findUnique({ where: { id: session.id }, include: sessionInclude });
  const label = full ? `${full.trip?.route.originCity.name} → ${full.trip?.route.destinationCity.name}` : "";

  void routeLabel;
  await sendTrackingNotification({
    agencyId: trip.bus.agencyId,
    title: "🚌 Départ d'un bus",
    message: `Le bus ${busLabel(trip.bus.fleetNumber, trip.bus.registrationNumber)} (${label}) vient de partir avec ${ctx.driver.firstName} ${ctx.driver.lastName}.`,
    type: "INFO",
    recipientRoles: ["AGENCY_MANAGER"],
  });
  if (full?.trip) {
    await realtime.publishTripStatus({
      agencyId: full.bus.agency.id, tripId, tripCode: full.trip.code, status: "DEPARTED",
      actualDepartureAt: now.toISOString(), actualArrivalAt: null,
      busLabel: busLabel(full.bus.fleetNumber, full.bus.registrationNumber), routeLabel: label,
    });
  }

  logger.info("lifecycle", "suivi démarré", { tripId, sessionId: session.id, driverId: ctx.driver.id });
  return { sessionId: session.id, status: "ACTIVE", message: "Suivi GPS démarré. Bon voyage !" };
}

/** PAUSE (arrêt / repos). Les positions reçues pendant la pause → 409. */
export async function pauseTracking(auth: AuthContext): Promise<TrackingActionResult> {
  const ctx = await requireDriverContext(auth);
  const session = await requireDriverSession(ctx);
  if (session.status !== "ACTIVE") {
    throw new ApiError(409, ERROR_CODES.CONFLICT, session.status === "PAUSED" ? "Le suivi est déjà en pause." : "Ce suivi est terminé.");
  }
  await db.trackingSession.update({ where: { id: session.id }, data: { status: "PAUSED" } });
  await repo.logTrackingEvent({ tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id, eventType: "TRIP_PAUSED" });
  await publishSessionUpdate(session.id);
  logger.info("lifecycle", "suivi en pause", { sessionId: session.id });
  return { sessionId: session.id, status: "PAUSED", message: "Suivi en pause. Reprenez avant de repartir." };
}

/** REPRENDRE après pause. */
export async function resumeTracking(auth: AuthContext): Promise<TrackingActionResult> {
  const ctx = await requireDriverContext(auth);
  const session = await requireDriverSession(ctx);
  if (session.status !== "PAUSED") {
    throw new ApiError(409, ERROR_CODES.CONFLICT, session.status === "ACTIVE" ? "Le suivi est déjà actif." : "Ce suivi est terminé.");
  }
  await db.trackingSession.update({ where: { id: session.id }, data: { status: "ACTIVE" } });
  await repo.logTrackingEvent({ tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id, eventType: "TRIP_RESUMED" });
  await publishSessionUpdate(session.id);
  logger.info("lifecycle", "suivi repris", { sessionId: session.id });
  return { sessionId: session.id, status: "ACTIVE", message: "Suivi repris." };
}

/** TERMINER LE TRAJET (bouton chauffeur ou détection automatique). */
export async function stopTracking(auth: AuthContext, reason: "DRIVER_STOP" | "AUTO_ARRIVED" = "DRIVER_STOP"): Promise<TrackingActionResult> {
  const ctx = await requireDriverContext(auth);
  const session = await requireDriverSession(ctx);
  if (session.status === "ENDED") {
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce suivi est déjà terminé.");
  }
  const now = new Date();
  await endSession(session.id, reason, now);
  await logAudit({ userId: auth.userId, action: "TRACKING_STOPPED", entity: "TrackingSession", entityId: session.id, metadata: { tripId: session.tripId, reason } });
  logger.info("lifecycle", "suivi terminé", { sessionId: session.id, reason });
  return { sessionId: session.id, status: "ENDED", message: "Voyage terminé. Merci !" };
}

/** Clôture commune (transaction) : session ENDED + voyage ARRIVED + chauffeur AVAILABLE. */
async function endSession(sessionId: string, reason: string, now: Date): Promise<void> {
  const full = await db.trackingSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
  if (!full) return;
  await db.$transaction(async (tx) => {
    await tx.trackingSession.update({ where: { id: sessionId }, data: { status: "ENDED", endedAt: now } });
    if (full.trip && full.trip.status !== "ARRIVED") {
      await tx.trip.update({ where: { id: full.tripId }, data: { status: "ARRIVED", actualArrivalAt: full.trip.actualArrivalAt ?? now } });
    }
    await tx.driver.update({ where: { id: full.driverId }, data: { status: "AVAILABLE" } }).catch(() => {});
  });
  await repo.logTrackingEvent({ tripId: full.tripId, busId: full.busId, driverId: full.driverId, eventType: "GPS_STOPPED", metadata: { reason } });
  if (reason !== "AUTO_ARRIVED_STALE") {
    await repo.logTrackingEvent({ tripId: full.tripId, busId: full.busId, driverId: full.driverId, eventType: "TRIP_ARRIVED", metadata: { reason } });
  }
  const label = `${full.trip?.route.originCity.name ?? "?"} → ${full.trip?.route.destinationCity.name ?? "?"}`;
  await sendTrackingNotification({
    agencyId: full.bus.agency.id,
    title: reason === "AUTO_ARRIVED" ? "✅ Bus arrivé à destination" : "🏁 Trajet terminé",
    message: `Bus ${busLabel(full.bus.fleetNumber, full.bus.registrationNumber)} (${label}) — trajet terminé (${reason === "AUTO_ARRIVED" ? "arrivée détectée automatiquement" : "confirmé par le chauffeur"}).`,
    type: "SUCCESS",
    recipientRoles: ["AGENCY_MANAGER"],
  });
  if (full.trip) {
    await realtime.publishTripStatus({
      agencyId: full.bus.agency.id, tripId: full.tripId, tripCode: full.trip.code, status: "ARRIVED",
      actualDepartureAt: full.trip.actualDepartureAt?.toISOString() ?? null, actualArrivalAt: now.toISOString(),
      busLabel: busLabel(full.bus.fleetNumber, full.bus.registrationNumber), routeLabel: label,
    });
  }
  await publishSessionUpdate(sessionId);
}

// ============================================================
// INGESTION D'UNE POSITION (le cœur)
// ============================================================

interface IngestResult {
  stored: boolean;
  reason?: string;
  arrived: boolean;
}

/**
 * Valide, enregistre et publie UNE position GPS.
 * `ctx` déjà résolu (chauffeur). Retourne le détail d'ingestion.
 */
async function ingestLocation(ctx: DriverContext, session: TrackingSession, point: GpsPoint): Promise<IngestResult> {
  // 1. Statut de session
  if (session.status === "ENDED") {
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce suivi est terminé — impossible d'enregistrer une position.");
  }
  if (session.status === "PAUSED") {
    throw new ApiError(409, ERROR_CODES.CONFLICT, "Le suivi est en pause. Reprenez le voyage pour envoyer des positions.");
  }

  // 2. Anti-replay / anti-timestamps absurdes (offline 6 h toléré)
  const recordedAt = new Date(point.recordedAt);
  const tsError = checkTimestampWindow(recordedAt);
  if (tsError) throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, tsError);

  // 3. Précision GPS & vitesse plausibles
  if (isAccuracyRejection(point.accuracy)) {
    throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, `Position rejetée : précision GPS insuffisante (>${Math.round(TRACKING.hardMaxAccuracyM)} m).`);
  }
  if (!isPlausibleSpeed(point.speed)) {
    throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, `Vitesse impossible (> ${TRACKING.maxSpeedKmh} km/h) — position rejetée.`);
  }

  const now = new Date();
  const position: GeoPoint = { latitude: point.latitude, longitude: point.longitude };
  const isReliable = point.accuracy === null || point.accuracy === undefined || point.accuracy <= TRACKING.maxAccuracyM;

  // 4. Charge le voyage + itinéraire pour les détections
  const tripFull = await db.trip.findUnique({
    where: { id: session.tripId },
    select: {
      id: true, code: true, status: true, estimatedArrivalTime: true,
      route: {
        select: {
          originCity: { select: { latitude: true, longitude: true } },
          destinationCity: { select: { latitude: true, longitude: true, name: true } },
          stops: { orderBy: { position: "asc" }, select: { latitude: true, longitude: true, city: { select: { name: true, latitude: true, longitude: true } } } },
        },
      },
    },
  });
  const route = tripFull?.route;

  // 5. Distance depuis la position précédente (anti-doublon)
  const prevLat = session.lastLatitude;
  const prevLng = session.lastLongitude;
  const distanceFromPrev =
    prevLat !== null && prevLng !== null
      ? haversineM({ latitude: prevLat, longitude: prevLng }, position)
      : null;

  const shouldStore =
    distanceFromPrev === null || // première position
    distanceFromPrev >= TRACKING.minDistanceM || // déplacement significatif
    point.speed !== null && point.speed !== undefined && point.speed >= TRACKING.stoppedSpeedKmh; // en mouvement

  // 6. Détections géofence (uniquement sur positions fiables — brief §34)
  const sessionUpdate: Prisma.TrackingSessionUpdateInput = {};
  let offRouteFlipped = false;

  if (isReliable && route) {
    // Itinéraire : origine + arrêts ordonnés + destination
    const routePoints: GeoPoint[] = ([
      route.originCity.latitude !== null && route.originCity.longitude !== null ? { latitude: route.originCity.latitude, longitude: route.originCity.longitude } : null,
      ...route.stops.map((s) =>
        s.latitude !== null && s.longitude !== null ? { latitude: s.latitude, longitude: s.longitude } :
        s.city.latitude !== null && s.city.longitude !== null ? { latitude: s.city.latitude, longitude: s.city.longitude } : null
      ),
      route.destinationCity.latitude !== null && route.destinationCity.longitude !== null ? { latitude: route.destinationCity.latitude, longitude: route.destinationCity.longitude } : null,
    ]).filter((p): p is GeoPoint => p !== null);

    // --- Hors itinéraire (tolérance : N positions consécutives) ---
    if (routePoints.length >= 2) {
      const distToRoute = distanceToRouteM(position, routePoints);
      const off = distToRoute !== null && distToRoute > TRACKING.offRouteRadiusM;
      const consecutiveOffRoute = off ? session.consecutiveOffRoute + 1 : 0;
      sessionUpdate.consecutiveOffRoute = consecutiveOffRoute;
      if (off && consecutiveOffRoute >= TRACKING.offRouteConsecutive && !session.offRoute) {
        const offDistanceM = Math.round(distToRoute ?? 0);
        sessionUpdate.offRoute = true;
        offRouteFlipped = true;
        await repo.logTrackingEvent({
          tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id,
          eventType: "OFF_ROUTE", latitude: point.latitude, longitude: point.longitude,
          metadata: { distanceM: offDistanceM, thresholdM: TRACKING.offRouteRadiusM },
        });
        await sendTrackingNotification({
          agencyId: ctx.agencyId,
          title: "⚠️ Bus hors itinéraire",
          message: `Le bus s'est éloigné de ${Math.round(offDistanceM / 100) / 10} km de son itinéraire (${tripFull?.code ?? session.tripId}).`,
          type: "WARNING",
          recipientRoles: ["AGENCY_MANAGER"],
        });
        logger.warn("geofence", "hors itinéraire détecté", { tripId: session.tripId, distanceM: offDistanceM });
      } else if (!off && session.offRoute) {
        sessionUpdate.offRoute = false;
        offRouteFlipped = true;
        await repo.logTrackingEvent({
          tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id,
          eventType: "OFF_ROUTE", latitude: point.latitude, longitude: point.longitude,
          metadata: { recovered: true, note: "retour sur l'itinéraire" },
        });
        logger.info("geofence", "retour sur itinéraire", { tripId: session.tripId });
      }
    }

    // --- Géofence destination (arrivée) ---
    const dest = route.destinationCity.latitude !== null && route.destinationCity.longitude !== null
      ? { latitude: route.destinationCity.latitude, longitude: route.destinationCity.longitude }
      : null;
    if (dest && tripFull && tripFull.status === "DEPARTED") {
      const nearDest = isWithinGeofence(position, dest);
      const consecutiveNearDest = nearDest ? session.consecutiveNearDest + 1 : 0;
      sessionUpdate.consecutiveNearDest = consecutiveNearDest;
      if (nearDest && !session.destinationNotified) {
        sessionUpdate.destinationNotified = true;
        await repo.logTrackingEvent({
          tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id,
          eventType: "DESTINATION_NEAR", latitude: point.latitude, longitude: point.longitude,
          metadata: { radiusM: TRACKING.destinationRadiusM, destination: route.destinationCity.name },
        });
        await sendTrackingNotification({
          agencyId: ctx.agencyId,
          title: "📍 Arrivée imminente",
          message: `Le bus approche de ${route.destinationCity.name} (géofence ${TRACKING.destinationRadiusM} m).`,
          type: "INFO",
          recipientRoles: ["AGENCY_MANAGER"],
        });
        logger.info("geofence", "destination proche", { tripId: session.tripId });
      }
      const speedOk = point.speed === null || point.speed === undefined || point.speed <= 50;
      if (nearDest && consecutiveNearDest >= 2 && speedOk) {
        // Arrivée automatique : session ENDED + voyage ARRIVED + événements
        await db.$transaction(async (tx) => {
          await tx.trackingSession.update({
            where: { id: session.id },
            data: { ...sessionUpdate, lastLatitude: point.latitude, lastLongitude: point.longitude, lastSpeed: point.speed ?? null, lastHeading: point.heading ?? null, lastAccuracy: point.accuracy ?? null, lastAltitude: point.altitude ?? null, lastSeenAt: now },
          });
          if (shouldStore) {
            await tx.busLocation.create({
              data: {
                trackingSessionId: session.id, tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id,
                latitude: point.latitude, longitude: point.longitude, speed: point.speed ?? null, heading: point.heading ?? null,
                accuracy: point.accuracy ?? null, altitude: point.altitude ?? null,
                distanceFromPrev: distanceFromPrev !== null ? Math.round(distanceFromPrev) : null,
                isReliable, recordedAt, receivedAt: now,
              },
            });
          }
        });
        await endSession(session.id, "AUTO_ARRIVED", now);
        await logAudit({ userId: ctx.driver.id, action: "TRACKING_AUTO_ARRIVED", entity: "Trip", entityId: session.tripId, metadata: { sessionId: session.id, geofence: TRACKING.destinationRadiusM } });
        return { stored: shouldStore, arrived: true };
      }
    } else {
      sessionUpdate.consecutiveNearDest = 0;
    }
  }

  // 7. GPS_ONLINE : signal retrouvé après une coupure (gap > seuil instable)
  if (session.lastSeenAt) {
    const gapS = (now.getTime() - session.lastSeenAt.getTime()) / 1000;
    if (gapS > TRACKING.unstableAfterS) {
      await repo.logTrackingEvent({
        tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id,
        eventType: "GPS_ONLINE", latitude: point.latitude, longitude: point.longitude,
        metadata: { gapSeconds: Math.round(gapS), note: "signal GPS retrouvé après coupure" },
      });
      logger.info("connectivity", "signal retrouvé après coupure", { sessionId: session.id, gapS: Math.round(gapS) });
    }
  }

  // 8. Écriture transactionnelle : BusLocation + TrackingSession (cohérence)
  if (shouldStore) {
    await repo.saveLocationWithSession(
      {
        sessionId: session.id, tripId: session.tripId, busId: session.busId, driverId: ctx.driver.id,
        latitude: point.latitude, longitude: point.longitude,
        speed: point.speed ?? null, heading: point.heading ?? null,
        accuracy: point.accuracy ?? null, altitude: point.altitude ?? null,
        distanceFromPrev: distanceFromPrev !== null ? Math.round(distanceFromPrev) : null,
        isReliable, recordedAt,
      },
      sessionUpdate
    );
  } else {
    // Position identique : pas de BusLocation (optimisation), MAJ session
    await repo.touchSession(session.id, sessionUpdate);
  }

  // 9. Publication realtime du bus concerné (mise à jour du SEUL marqueur)
  await publishSessionUpdate(session.id);

  if (offRouteFlipped) {
    const full = await db.trackingSession.findUnique({ where: { id: session.id }, include: sessionInclude });
    if (full) {
      await realtime.publishBusLocation(toFleetBusDTO(full, new Date()));
    }
  }

  return { stored: shouldStore, arrived: false };
}

/** Point d'entrée authentifié : POST /api/tracking/location. */
export async function receiveLocation(auth: AuthContext, input: GpsPoint & { sessionId?: string | null }): Promise<TrackingActionResult> {
  const ctx = await requireDriverContext(auth);
  const session = await requireDriverSession(ctx, input.sessionId ?? null, null);
  const result = await ingestLocation(ctx, session, input);
  return {
    sessionId: session.id,
    status: result.arrived ? "ENDED" : "ACTIVE",
    message: result.arrived
      ? "Arrivée détectée automatiquement — suivi terminé."
      : result.stored
        ? "Position enregistrée."
        : "Position reçue (déplacement insignifiant — non stockée).",
  };
}

/** POST /api/tracking/batch — synchronisation offline (IndexedDB). */
export async function receiveBatch(auth: AuthContext, points: GpsPoint[]): Promise<BatchResultDTO> {
  const ctx = await requireDriverContext(auth);
  const session = await requireDriverSession(ctx, null, null);
  const reasons: string[] = [];
  let accepted = 0;
  let rejected = 0;

  // Les positions offline sont reçues dans l'ordre chronologique
  const sorted = [...points].sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  let current: TrackingSession | null = session;

  for (const point of sorted) {
    try {
      if (!current || current.status === "ENDED") break; // le reste sera rejeté
      const res = await ingestLocation(ctx, current, point);
      accepted++;
      if (res.arrived) {
        current = null; // la session s'est terminée (arrivée auto pendant le batch)
        break;
      }
      // recharger la session (touch/save ont mis à jour les compteurs)
      current = await repo.findSessionById(session.id);
    } catch (err) {
      rejected++;
      if (reasons.length < 5) {
        reasons.push(err instanceof ApiError ? err.message : "Position invalide");
      }
    }
  }
  logger.info("ingestion", `batch synchronisé (${accepted} acceptées, ${rejected} rejetées)`, { sessionId: session.id });
  return { accepted, rejected, reasons };
}

// ============================================================
// LECTURES
// ============================================================

/** GET /api/tracking/session — la session active du chauffeur connecté. */
export async function getDriverSession(auth: AuthContext): Promise<TrackingSessionDTO | null> {
  const ctx = await requireDriverContext(auth);
  const session = await db.trackingSession.findFirst({
    where: { driverId: ctx.driver.id, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { startedAt: "desc" },
    include: sessionInclude,
  });
  if (session) return toSessionDTO(session);
  // Session récemment terminée (affichage de clôture)
  const lastEnded = await db.trackingSession.findFirst({
    where: { driverId: ctx.driver.id, status: "ENDED", endedAt: { gte: new Date(Date.now() - 3600_000) } },
    orderBy: { endedAt: "desc" },
    include: sessionInclude,
  });
  return toSessionDTO(lastEnded);
}

/**
 * GET /api/tracking/current — snapshot flotte OPTIMISÉ :
 * TrackingSession seulement (jamais BusLocation), scope serveur.
 */
export async function getFleetSnapshot(auth: AuthContext, requestedAgencyId?: string | null): Promise<FleetSnapshotDTO> {
  const scope = requireFleetReadScope(auth, requestedAgencyId);
  const now = new Date();

  const sessions = await repo.findFleetSessions(scope);
  const departedNoSession = await repo.findDepartedTripsWithoutSession(scope);

  const buses: FleetBusDTO[] = sessions.map((s) => toFleetBusDTO(s, now));

  // Bus dont le voyage est DEPARTED mais SANS session récente → HORS LIGNE
  for (const d of departedNoSession) {
    if (buses.some((b) => b.tripId === d.id)) continue;
    buses.push({
      sessionId: null,
      busId: d.bus.id,
      registrationNumber: d.bus.registrationNumber,
      fleetNumber: d.bus.fleetNumber,
      agencyId: d.bus.agency.id,
      agencyName: d.bus.agency.name,
      driverFirstName: d.driver?.firstName ?? null,
      driverLastName: d.driver?.lastName ?? null,
      driverPhone: d.driver?.phone ?? null,
      tripId: d.id,
      tripCode: d.code,
      originCityName: d.route.originCity.name,
      destinationCityName: d.route.destinationCity.name,
      latitude: null,
      longitude: null,
      speed: null,
      heading: null,
      accuracy: null,
      lastSeenAt: null,
      state: "OFFLINE",
      stateLabel: FLEET_BUS_STATE_LABELS.OFFLINE,
      tripStatus: d.status,
      offRoute: false,
      delayed: now > d.estimatedArrivalTime,
    });
  }

  const stats = {
    total: buses.length,
    online: buses.filter((b) => {
      if (!b.lastSeenAt) return false;
      return (now.getTime() - Date.parse(b.lastSeenAt)) / 1000 <= TRACKING.onlineAfterS;
    }).length,
    unstable: buses.filter((b) => {
      if (!b.lastSeenAt) return false;
      const age = (now.getTime() - Date.parse(b.lastSeenAt)) / 1000;
      return age > TRACKING.onlineAfterS && age <= TRACKING.unstableAfterS;
    }).length,
    offline: buses.filter((b) => b.state === "OFFLINE").length,
    enRoute: buses.filter((b) => b.state === "EN_ROUTE").length,
    arrived: buses.filter((b) => b.state === "ARRIVED").length,
    offRoute: buses.filter((b) => b.state === "OFF_ROUTE").length,
    paused: buses.filter((b) => b.state === "PAUSED").length,
    delayed: buses.filter((b) => b.delayed).length,
  };

  return { buses, stats, serverTime: now.toISOString() };
}

/** GET /api/tracking/events — journal des événements GPS (scope serveur). */
export async function getTrackingEvents(auth: AuthContext, requestedAgencyId?: string | null, limit = 50): Promise<TrackingEventDTO[]> {
  const scope = requireFleetReadScope(auth, requestedAgencyId);
  const events = await repo.findRecentEvents(scope, limit);
  return events.map((e) => ({
    id: e.id,
    tripId: e.tripId,
    tripCode: e.trip?.code ?? null,
    busId: e.busId,
    busLabel: busLabel(e.bus.fleetNumber, e.bus.registrationNumber),
    driverName: e.driver ? `${e.driver.firstName} ${e.driver.lastName}` : null,
    eventType: e.eventType,
    eventTypeLabel: e.eventType,
    latitude: e.latitude,
    longitude: e.longitude,
    metadata: e.metadata ? (safeParse(e.metadata) as Record<string, unknown>) : null,
    createdAt: e.createdAt.toISOString(),
  }));
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** GET /api/tracking/history/[tripId] — polyligne + stats (pagination). */
export async function getTripHistory(auth: AuthContext, tripId: string, cursor?: string, limit?: number): Promise<TripHistoryDTO> {
  await assertTripReadAllowed(auth, tripId);
  const trip = await repo.findTripForHistory(tripId);
  if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");

  const pageSize = Math.min(limit ?? TRACKING.historyPageSize, TRACKING.historyPageSize);
  const rows = await repo.findTripLocationPage(tripId, cursor, pageSize);
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize).reverse(); // ordre chronologique asc

  // Stats (calcul approximatif applicatif — brief §57)
  let distanceM = 0;
  let maxSpeed = 0;
  let movingMs = 0;
  let stoppedMs = 0;
  for (let i = 0; i < pageRows.length; i++) {
    const r = pageRows[i];
    if (r.speed !== null && r.speed !== undefined) maxSpeed = Math.max(maxSpeed, r.speed);
    if (i > 0) {
      const prev = pageRows[i - 1];
      const d = haversineM({ latitude: prev.latitude, longitude: prev.longitude }, { latitude: r.latitude, longitude: r.longitude });
      const dt = r.recordedAt.getTime() - prev.recordedAt.getTime();
      distanceM += d;
      const speedLike = dt > 0 ? (d / 1000) / (dt / 3_600_000) : 0; // km/h implicite
      if (speedLike >= TRACKING.stoppedSpeedKmh) movingMs += dt;
      else stoppedMs += dt;
    }
  }
  const first = pageRows[0];
  const last = pageRows[pageRows.length - 1];
  const startAt = trip.actualDepartureAt ?? first?.recordedAt ?? null;
  const endAt = trip.actualArrivalAt ?? last?.recordedAt ?? null;
  const durationMs = startAt && endAt ? endAt.getTime() - startAt.getTime() : null;
  const offRouteEvents = await db.trackingEvent.count({ where: { tripId, eventType: "OFF_ROUTE", NOT: { metadata: { contains: "recovered" } } } });

  return {
    tripId: trip.id,
    tripCode: trip.code,
    agencyName: trip.agency.name,
    originCityName: trip.route.originCity.name,
    destinationCityName: trip.route.destinationCity.name,
    busRegistration: trip.bus.registrationNumber,
    busFleetNumber: trip.bus.fleetNumber,
    driverName: trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : "—",
    tripStatus: trip.status,
    scheduledDeparture: trip.departureTime.toISOString(),
    scheduledArrival: trip.estimatedArrivalTime.toISOString(),
    actualDepartureAt: trip.actualDepartureAt?.toISOString() ?? null,
    actualArrivalAt: trip.actualArrivalAt?.toISOString() ?? null,
    points: pageRows.map((r) => ({
      latitude: r.latitude, longitude: r.longitude,
      speed: r.speed, heading: r.heading, accuracy: r.accuracy,
      isReliable: r.isReliable,
      recordedAt: r.recordedAt.toISOString(), receivedAt: r.receivedAt.toISOString(),
    })),
    hasMore,
    nextCursor: hasMore ? pageRows[0]?.recordedAt.toISOString() ?? null : null,
    stats: {
      distanceKm: Math.round((distanceM / 1000) * 10) / 10,
      durationMinutes: durationMs !== null ? Math.round(durationMs / 60000) : null,
      movingMinutes: Math.round(movingMs / 60000),
      stoppedMinutes: Math.round(stoppedMs / 60000),
      averageSpeedKmh: durationMs && durationMs > 0 ? Math.round(((distanceM / 1000) / (durationMs / 3_600_000)) * 10) / 10 : null,
      maxSpeedKmh: Math.round(maxSpeed * 10) / 10,
      pointCount: pageRows.length,
      offRouteEvents,
    },
    stops: trip.route.stops.map((s) => ({
      name: s.city.name,
      latitude: s.latitude,
      longitude: s.longitude,
      position: s.position,
      minutesFromStart: s.minutesFromStart,
    })),
  };
}

/** GET /api/tracking/bus/[busId] — voyages suivis d'un bus sur une période. */
export async function getBusHistory(auth: AuthContext, busId: string, from?: string, to?: string, limit = 20): Promise<TripHistoryDTO[]> {
  await assertBusReadAllowed(auth, busId);
  const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 3600_000);
  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, "Dates invalides.");
  }
  const trips = await repo.findBusHistoryTrips(busId, fromDate, toDate, Math.min(limit, 50));
  // Réutilise la lecture par voyage (points complets) — bornée par la limite
  const results: TripHistoryDTO[] = [];
  for (const t of trips.slice(0, 5)) {
    results.push(await getTripHistory(auth, t.id));
  }
  return results;
}

/** GET /api/tracking/trip/[tripId] — détail session d'un voyage (lecture). */
export async function getTripSession(auth: AuthContext, tripId: string): Promise<TrackingSessionDTO | null> {
  await assertTripReadAllowed(auth, tripId);
  const session = await repo.findLatestSessionForTrip(tripId);
  if (!session) return null;
  const full = await db.trackingSession.findUnique({ where: { id: session.id }, include: sessionInclude });
  return toSessionDTO(full);
}

// ============================================================
// PUBLICATION REALTIME (mise à jour du marqueur concerné uniquement)
// ============================================================

async function publishSessionUpdate(sessionId: string): Promise<void> {
  try {
    const full = await db.trackingSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
    if (!full) return;
    await realtime.publishBusLocation(toFleetBusDTO(full, new Date()));
  } catch (err) {
    logger.warn("realtime", "échec publication session", { sessionId, error: err instanceof Error ? err.message : "erreur" });
  }
}

// ============================================================
// SIMULATION (DÉVELOPPEMENT UNIQUEMENT — brief §50)
// ============================================================

/**
 * Injecte une position SIMULÉE dans une session. Appelé UNIQUEMENT par
 * /api/tracking/simulate (NODE_ENV !== production + auth + rate limit).
 * Toutes les validations de géofence/restent actives (test de bout en bout).
 */
export async function simulateLocation(auth: AuthContext, input: { sessionId: string; latitude: number; longitude: number; speed?: number; heading?: number; accuracy?: number }): Promise<TrackingActionResult> {
  const session = await repo.findSessionById(input.sessionId);
  if (!session) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session introuvable.");
  if (session.status === "ENDED") throw new ApiError(409, ERROR_CODES.CONFLICT, "Session terminée.");

  // Fabrique un DriverContext synthétique à partir du chauffeur de la session
  const driver = await db.driver.findUnique({ where: { id: session.driverId } });
  if (!driver) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Chauffeur introuvable.");
  const ctx: DriverContext = { driver, agencyId: driver.agencyId };

  const point: GpsPoint = {
    latitude: input.latitude,
    longitude: input.longitude,
    speed: input.speed ?? 60,
    heading: input.heading ?? 90,
    accuracy: input.accuracy ?? 15,
    recordedAt: new Date().toISOString(),
  };
  const result = await ingestLocation(ctx, session, point);
  logger.info("simulate", "position simulée", { sessionId: session.id, stored: result.stored, arrived: result.arrived });
  return {
    sessionId: session.id,
    status: result.arrived ? "ENDED" : "ACTIVE",
    message: result.arrived ? "Arrivée détectée (simulation)." : "Position simulée enregistrée.",
  };
}
