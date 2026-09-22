// ============================================================
// NZOKO TRANSPORT — Repository du module tracking GPS
// Toute requête SQL passe par ici (séparation des responsabilités :
// Controller → Validation → Authorization → Service → Repository → Prisma).
// ============================================================

import { db } from "@/lib/db";
import { TRACKING } from "@/lib/constants";
import type { Prisma, TrackingSession, BusLocation } from "@prisma/client";

// ---------- Types de lecture enrichis ----------

export type FleetSession = TrackingSession & {
  bus: { id: string; registrationNumber: string; fleetNumber: string | null; agencyId: string; agency: { id: string; name: string } };
  driver: { id: string; firstName: string; lastName: string; phone: string | null };
  trip: {
    id: string;
    code: string;
    status: string;
    departureTime: Date;
    estimatedArrivalTime: Date;
    actualDepartureAt: Date | null;
    actualArrivalAt: Date | null;
    route: { originCity: { name: string }; destinationCity: { name: string; latitude: number | null; longitude: number | null } };
  } | null;
};

export interface DepartedTripRow {
  id: string;
  code: string;
  status: string;
  departureTime: Date;
  estimatedArrivalTime: Date;
  route: { originCity: { name: string }; destinationCity: { name: string } };
  bus: { id: string; registrationNumber: string; fleetNumber: string | null; agencyId: string; agency: { id: string; name: string } };
  driver: { id: string; firstName: string; lastName: string; phone: string | null } | null;
}

// ---------- Sessions ----------

export async function findDriverActiveSession(driverId: string): Promise<TrackingSession | null> {
  return db.trackingSession.findFirst({
    where: { driverId, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { startedAt: "desc" },
  });
}

export async function findSessionById(id: string): Promise<TrackingSession | null> {
  return db.trackingSession.findUnique({ where: { id } });
}

export async function findLatestSessionForTrip(tripId: string): Promise<TrackingSession | null> {
  return db.trackingSession.findFirst({ where: { tripId }, orderBy: { startedAt: "desc" } });
}

const fleetInclude = {
  bus: { select: { id: true, registrationNumber: true, fleetNumber: true, agencyId: true, agency: { select: { id: true, name: true } } } },
  driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
  trip: {
    select: {
      id: true,
      code: true,
      status: true,
      departureTime: true,
      estimatedArrivalTime: true,
      actualDepartureAt: true,
      actualArrivalAt: true,
      route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true, latitude: true, longitude: true } } } },
    },
  },
} satisfies Prisma.TrackingSessionInclude;

// Réutilise le même include que le service (types alignés)
export type FleetSessionFull = Prisma.TrackingSessionGetPayload<{ include: typeof fleetInclude }>;

/**
 * Sessions visibles sur le dashboard : actives/en pause + sessions
 * terminées récemment (bus « arrivés ») —jamais un scan de BusLocation.
 */
export async function findFleetSessions(agencyId: string | null): Promise<FleetSession[]> {
  const sinceEnded = new Date(Date.now() - 2 * 60 * 60 * 1000);
  return db.trackingSession.findMany({
    where: {
      status: { in: ["ACTIVE", "PAUSED"] },
      ...(agencyId ? { bus: { agencyId } } : {}),
    },
    include: fleetInclude,
      orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
  }).then(async (active) => {
    const ended = await db.trackingSession.findMany({
      where: {
        status: "ENDED",
        endedAt: { gte: sinceEnded },
        ...(agencyId ? { bus: { agencyId } } : {}),
      },
      include: fleetInclude,
      orderBy: { endedAt: "desc" },
    });
    return [...active, ...ended];
  });
}

/** Voyages DEPARTED sans session (bus jamais partis en suivi ou GPS perdu). */
export async function findDepartedTripsWithoutSession(agencyId: string | null): Promise<DepartedTripRow[]> {
  return db.trip.findMany({
    where: {
      status: "DEPARTED",
      ...(agencyId ? { agencyId } : {}),
      trackingSessions: { none: { status: { in: ["ACTIVE", "PAUSED", "ENDED"] }, endedAt: { gte: new Date(Date.now() - 2 * 3600_000) } } },
    },
    select: {
      id: true,
      code: true,
      status: true,
      departureTime: true,
      estimatedArrivalTime: true,
      route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
      bus: { select: { id: true, registrationNumber: true, fleetNumber: true, agencyId: true, agency: { select: { id: true, name: true } } } },
      driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
    },
    orderBy: { departureTime: "desc" },
    take: 50,
  });
}

// ---------- Écritures (transaction) ----------

export interface SaveLocationInput {
  sessionId: string;
  tripId: string;
  busId: string;
  driverId: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  altitude: number | null;
  distanceFromPrev: number | null;
  isReliable: boolean;
  recordedAt: Date;
}

/**
 * Écriture transactionnelle : BusLocation + mise à jour de la position
 * courante de la session DOIVENT rester cohérentes (brief §55).
 * Les mises à jour de détection (géofences) sont fusionnées ici.
 */
export async function saveLocationWithSession(
  input: SaveLocationInput,
  sessionUpdate: Prisma.TrackingSessionUpdateInput
): Promise<{ location: BusLocation; session: TrackingSession }> {
  return db.$transaction(async (tx) => {
    const location = await tx.busLocation.create({
      data: {
        trackingSessionId: input.sessionId,
        tripId: input.tripId,
        busId: input.busId,
        driverId: input.driverId,
        latitude: input.latitude,
        longitude: input.longitude,
        speed: input.speed,
        heading: input.heading,
        accuracy: input.accuracy,
        altitude: input.altitude,
        distanceFromPrev: input.distanceFromPrev,
        isReliable: input.isReliable,
        recordedAt: input.recordedAt,
        receivedAt: new Date(),
      },
    });
    const session = await tx.trackingSession.update({
      where: { id: input.sessionId },
      data: {
        lastLatitude: input.latitude,
        lastLongitude: input.longitude,
        lastSpeed: input.speed,
        lastHeading: input.heading,
        lastAccuracy: input.accuracy,
        lastAltitude: input.altitude,
        lastSeenAt: new Date(),
        ...sessionUpdate,
      },
    });
    return { location, session };
  });
}

/** Mise à jour de la session sans nouveau point (position identique). */
export async function touchSession(sessionId: string, update: Prisma.TrackingSessionUpdateInput): Promise<TrackingSession> {
  return db.trackingSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date(), ...update } });
}

// ---------- Événements ----------

export async function logTrackingEvent(input: {
  tripId: string;
  busId: string;
  driverId: string | null;
  eventType: string;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.trackingEvent.create({
    data: {
      tripId: input.tripId,
      busId: input.busId,
      driverId: input.driverId,
      eventType: input.eventType,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function findRecentEvents(agencyId: string | null, limit: number) {
  const events = await db.trackingEvent.findMany({
    where: agencyId ? { bus: { agencyId } } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, tripId: true, busId: true, driverId: true, eventType: true,
      latitude: true, longitude: true, metadata: true, createdAt: true,
      trip: { select: { code: true } },
      bus: { select: { registrationNumber: true, fleetNumber: true } },
      driver: { select: { firstName: true, lastName: true } },
    },
  });
  return events;
}

// ---------- Historique ----------

export async function findTripLocationPage(tripId: string, cursor?: string, limit: number = TRACKING.historyPageSize) {
  return db.busLocation.findMany({
    where: { tripId, ...(cursor ? { recordedAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { recordedAt: "desc" },
    take: limit + 1,
  });
}

export async function findTripForHistory(tripId: string) {
  return db.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true, code: true, status: true,
      departureTime: true, estimatedArrivalTime: true,
      actualDepartureAt: true, actualArrivalAt: true,
      agency: { select: { name: true } },
      bus: { select: { registrationNumber: true, fleetNumber: true } },
      driver: { select: { firstName: true, lastName: true } },
      route: {
        select: {
          originCity: { select: { name: true, latitude: true, longitude: true } },
          destinationCity: { select: { name: true, latitude: true, longitude: true } },
          stops: {
            orderBy: { position: "asc" },
            select: { position: true, minutesFromStart: true, latitude: true, longitude: true, city: { select: { name: true } } },
          },
        },
      },
    },
  });
}

/** Points d'un bus sur une période (historique multi-voyages). */
export async function findBusLocationWindow(busId: string, from: Date, to: Date, limit: number) {
  return db.busLocation.findMany({
    where: { busId, recordedAt: { gte: from, lte: to } },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
}

export async function findBusHistoryTrips(busId: string, from: Date, to: Date, limit: number) {
  return db.trip.findMany({
    where: {
      busId,
      departureTime: { gte: from, lte: to },
      trackingSessions: { some: {} },
    },
    orderBy: { departureTime: "desc" },
    take: limit,
    select: {
      id: true, code: true, status: true,
      departureTime: true, estimatedArrivalTime: true,
      actualDepartureAt: true, actualArrivalAt: true,
      agency: { select: { name: true } },
      bus: { select: { registrationNumber: true, fleetNumber: true } },
      driver: { select: { firstName: true, lastName: true } },
      route: {
        select: {
          originCity: { select: { name: true } },
          destinationCity: { select: { name: true } },
          stops: { orderBy: { position: "asc" }, select: { position: true, minutesFromStart: true, latitude: true, longitude: true, city: { select: { name: true } } } },
        },
      },
    },
  });
}

// ---------- Nettoyage (stratégie de conservation — DÉSACTIVÉE par défaut) ----------

/**
 * Purge des BusLocation plus anciennes que TRACKING.retentionDays.
 * N'est JAMAIS appelée automatiquement en V1 (brief §56 : ne pas
 * supprimer sans configuration explicite). Point d'entrée d'un cron
 * futur (Vercel Cron / tâche planifiée).
 */
export async function purgeOldLocationsDryRun(): Promise<{ count: number; olderThan: Date }> {
  const olderThan = new Date(Date.now() - TRACKING.retentionDays * 24 * 3600 * 1000);
  const count = await db.busLocation.count({ where: { recordedAt: { lt: olderThan } } });
  return { count, olderThan };
}
