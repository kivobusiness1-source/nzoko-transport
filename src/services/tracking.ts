// ============================================================
// OCÉAN DU NORD — Service suivi GPS temps réel
// Persistance (Prisma) + émission vers le mini-service socket.io
// (best-effort : si le service temps réel est absent, les points
// sont simplement stockés — l'admin bascule en polling).
// ============================================================

import { createHmac, timingSafeEqual } from "crypto";
import type { TrackingSession, GpsPoint, Trip, Bus, Driver, Agency } from "@prisma/client";
import { TRACKING } from "@/lib/constants";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { arrivalDistance, deriveBusStatus, haversineMeters } from "@/lib/geo";
import { arrivalRadiusM, offlineThresholdMs, stoppedSpeedKmh } from "@/lib/gps-config";
import { logTrackingEvent } from "@/services/tracking-events";
import type { TrackingSessionDTO, TrackingSessionActionDTO } from "@/types";

/** Secret partagé Next ↔ mini-service socket.io (défaut dev, override prod). */
export const TRACKING_SECRET = process.env.TRACKING_SECRET ?? "nzoko-tracking-dev-secret-change-me";
/** URL interne du mini-service temps réel. */
export const TRACKING_REALTIME_URL = process.env.TRACKING_REALTIME_URL ?? "http://127.0.0.1:3004";
/** URL FRONTALE du service temps réel, consommée par le navigateur admin.
 *  - Sandbox (défaut) : passerelle Caddy → /?XTransformPort=3003.
 *  - Production : soit l'URL publique du mini-service déployé
 *    (ex. https://tracking.nzoko.cg), soit une CHAÎNE VIDE pour désactiver
 *    le temps réel (l'admin bascule alors sur le polling 10 s, sans
 *    tentatives socket ni erreurs console). */
export const TRACKING_SOCKET_URL = process.env.TRACKING_PUBLIC_SOCKET_URL ?? "/?XTransformPort=3003";

type SessionCityRef = { name: string; latitude?: number | null; longitude?: number | null };

type SessionWithRelations = TrackingSession & {
  driver: Driver;
  agency: Agency;
  trip: (Trip & { route?: { originCity?: SessionCityRef | null; destinationCity?: SessionCityRef | null } }) | null;
  bus: Bus | null;
};

/** Libellé lisible d'une ligne : « Pointe-Noire → Brazzaville »
 *  (réutilisé par la carte publique — aucun identifiant interne). */
export function routeLabelOf(route: { originCity?: SessionCityRef | null; destinationCity?: SessionCityRef | null } | undefined, fallback: string): string {
  const origin = route?.originCity?.name;
  const destination = route?.destinationCity?.name;
  if (!origin || !destination) return fallback;
  return `${origin} → ${destination}`;
}

/** Dernier point « léger » — soit un GpsPoint réel (requête), soit
 *  l'état courant dénormalisé de la session V5 (vue flotte sans N+1). */
export type SessionLastPoint = Pick<GpsPoint, "latitude" | "longitude" | "speed" | "heading" | "accuracy" | "batteryLevel" | "recordedAt"> | null;

/** Sérialise une ligne Prisma vers le DTO public (jamais d'ids internes inutiles au-delà du nécessaire). */
export function toTrackingSessionDTO(
  session: SessionWithRelations,
  lastPoint: SessionLastPoint,
  pointsCount: number
): TrackingSessionDTO {
  const trip = session.trip;
  const route = trip?.route;
  // Distance Haversine (m) jusqu'à la destination officielle — null si indisponible.
  const distanceToDestination = arrivalDistance({
    trip: trip ? { status: trip.status, route: { destinationCity: route?.destinationCity ?? null } } : null,
    lastPoint: lastPoint ? { latitude: lastPoint.latitude, longitude: lastPoint.longitude } : null,
  });
  return {
    id: session.id,
    status: session.status as TrackingSessionDTO["status"],
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    driver: {
      id: session.driver.id,
      firstName: session.driver.firstName,
      lastName: session.driver.lastName,
      phone: session.driver.phone,
    },
    agency: { id: session.agency.id, name: session.agency.name },
    trip: trip
      ? {
          id: trip.id,
          code: trip.code,
          originCityName: route?.originCity?.name ?? route?.destinationCity?.name ?? trip.code,
          destinationCityName: route?.destinationCity?.name ?? route?.originCity?.name ?? trip.code,
          departureTime: trip.departureTime.toISOString(),
        }
      : null,
    bus: session.bus ? { id: session.bus.id, registrationNumber: session.bus.registrationNumber, model: session.bus.model } : null,
    lastPoint: lastPoint
      ? {
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude,
          speed: lastPoint.speed,
          heading: lastPoint.heading,
          accuracy: lastPoint.accuracy,
          batteryLevel: lastPoint.batteryLevel ?? null,
          recordedAt: lastPoint.recordedAt.toISOString(),
        }
      : null,
    pointsCount,
    // V4 GPS — état dérivé + distance restante jusqu'à la destination officielle.
    busStatus: deriveBusStatus({
      speedKmh: lastPoint?.speed ?? null,
      lastPointAt: lastPoint?.recordedAt ?? null,
      offlineThresholdMs: offlineThresholdMs(),
      stoppedSpeedKmh: stoppedSpeedKmh(),
      tripArrived: trip?.status === "ARRIVED",
    }),
    distanceToDestinationM: distanceToDestination === null ? null : Math.round(distanceToDestination),
  };
}

export function toTrackingSessionActionDTO(session: SessionWithRelations, lastPoint: SessionLastPoint, pointsCount: number): TrackingSessionActionDTO {
  return { ...toTrackingSessionDTO(session, lastPoint, pointsCount), socketUrl: TRACKING_SOCKET_URL };
}

/** Jeton d'abonnement admin au salon temps réel : HMAC(secret, topic:userId:exp). */
export function issueSocketToken(userId: string, ttlMs = 30 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const payload = `fleet:${userId}:${exp}`;
  return `${payload}:${createHmac("sha256", TRACKING_SECRET).update(payload).digest("hex")}`;
}

/** Vérification du jeton (miroir côté mini-service). */
export function verifySocketToken(token: string): { ok: boolean; userId?: string } {
  const parts = token.split(":");
  if (parts.length !== 4) return { ok: false };
  const [topic, userId, expRaw, signature] = parts;
  if (topic !== "fleet") return { ok: false };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return { ok: false };
  const expected = createHmac("sha256", TRACKING_SECRET).update(`${topic}:${userId}:${expRaw}`).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
  return { ok: true, userId };
}

interface RealtimeEvent {
  room: string; // "fleet" | `agency:${agencyId}`
  event: string; // "gps" | "session-started" | "session-stopped" | "session-updated"
  payload: unknown;
}

let emitInFlight = false;
/** Émission best-effort vers le mini-service (jamais bloquante, jamais levée d'erreur). */
export async function emitRealtime(event: RealtimeEvent): Promise<void> {
  if (emitInFlight) return; // anti-empilement — le polling admin rattrape
  emitInFlight = true;
  try {
    const body = JSON.stringify(event);
    const signature = createHmac("sha256", TRACKING_SECRET).update(body).digest("hex");
    await fetch(`${TRACKING_REALTIME_URL}/internal/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": signature },
      body,
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // Service temps réel absent ou lent — silencieux par conception.
  } finally {
    emitInFlight = false;
  }
}

/** Point hors fenêtre de tolérance passé (mspéc TRACKING.pastToleranceMs) ? */
export function isStalePoint(recordedAt: Date, now = new Date()): boolean {
  return now.getTime() - recordedAt.getTime() > TRACKING.pastToleranceMs;
}

// ============================================================
// V4 — Détection d'arrivée automatique (destination officielle)
// ============================================================

export interface ArrivalMarkResult {
  arrived: true;
  tripId: string;
  routeLabel: string;
  /** Distance au moment de la détection (m, arrondie). */
  distanceM: number;
  /** Horodatage ISO de la détection serveur. */
  at: string;
}

/**
 * Après écriture d'un point GPS : si le bus est entré dans le rayon
 * d'arrivée (GPS_ARRIVAL_RADIUS, autorité serveur) de la destination
 * officielle du voyage, le trip passe ARRIVED — une seule fois
 * (update CONDITIONNEL anti-concurrence) — et l'événement temps réel
 * « bus-arrived » { sessionId, tripId, routeLabel, at } est émis vers
 * le salon flotte (même mécanisme HMAC que les événements « gps »),
 * avec journal d'audit TRIP_ARRIVED.
 *
 * BEST-EFFORT ABSOLU : une erreur ici ne doit JAMAIS faire échouer
 * l'enregistrement du point GPS (silencieux + log serveur).
 */
export async function maybeMarkArrival(input: {
  sessionId: string;
  tripId: string | null;
  lastPoint: { latitude: number; longitude: number };
  /** Compte chauffeur à l'origine du point (journal d'audit), si connu. */
  actorUserId?: string | null;
}): Promise<ArrivalMarkResult | null> {
  try {
    if (!input.tripId) return null;
    const trip = await db.trip.findUnique({
      where: { id: input.tripId },
      include: { route: { include: { originCity: true, destinationCity: true } } },
    });
    if (!trip) return null;
    // Voyages déjà jugés (admin ou détection précédente) : on n'y touche plus.
    if (trip.status === "ARRIVED" || trip.status === "COMPLETED" || trip.status === "CANCELLED") return null;
    const destination = trip.route?.destinationCity;
    if (!destination || destination.latitude === null || destination.longitude === null) return null;

    const distanceM = haversineMeters(
      { latitude: input.lastPoint.latitude, longitude: input.lastPoint.longitude },
      { latitude: destination.latitude, longitude: destination.longitude }
    );
    if (distanceM > arrivalRadiusM()) return null;

    const routeLabel = routeLabelOf(trip.route, trip.code);
    // Update conditionnel : si le statut a changé entre-temps, count = 0
    // → personne ne double-marque l'arrivée.
    const updated = await db.trip.updateMany({
      where: { id: trip.id, status: { notIn: ["ARRIVED", "COMPLETED", "CANCELLED"] } },
      data: { status: "ARRIVED" },
    });
    if (updated.count === 0) return null;

    const at = new Date().toISOString();
    await emitRealtime({
      room: "fleet",
      event: "bus-arrived",
      payload: { sessionId: input.sessionId, tripId: trip.id, routeLabel, at },
    });
    await logAudit({
      userId: input.actorUserId ?? null,
      action: "TRIP_ARRIVED",
      entity: "Trip",
      entityId: trip.id,
      metadata: {
        sessionId: input.sessionId,
        routeLabel,
        distanceM: Math.round(distanceM),
        detectedFrom: "gps",
      },
    });
    return { arrived: true, tripId: trip.id, routeLabel, distanceM: Math.round(distanceM), at };
  } catch (err) {
    // Best-effort : le point GPS reste enregistré quoi qu'il arrive.
    console.error("[tracking] détection d'arrivée échouée (best-effort)", err);
    return null;
  }
}

// ============================================================
// Durabilité — watchdog des sessions orphelines
// ============================================================

export interface WatchdogResult {
  /** Sessions ACTIVE sans point récent passées en PAUSED (stade 1). */
  pausedCount: number;
  /** Sessions vivantes trop anciennes passées en COMPLETED (stade 2). */
  completedCount: number;
  /** Chauffeurs ON_TRIP libérés en AVAILABLE. */
  driversReleased: number;
}

/** Watchdog — exécuté périodiquement par le scheduler du mini-service.
 *
 *  Stade 1 : une session ACTIVE sans AUCUN point depuis watchdogStaleMs
 *  (45 min) est quasi certainement orpheline (navigateur fermé sans STOP,
 *  crash, batterie). On la passe en PAUSED — le chauffeur de retour peut la
 *  reprendre (RESUME) ou l'arrêter proprement ; l'admin voit l'état réel.
 *  Un événement GPS_OFFLINE (WARN) est journalisé pour l'alerte.
 *
 *  Stade 2 : une session vivante plus vieille que watchdogHardMs (24 h) est
 *  close d'office (COMPLETED, endReason WATCHDOG, endedAt) et le chauffeur
 *  est libéré — un car interurbain Congo ne roule pas 24 h d'affilée sur
 *  une même session. Événement GPS_SESSION_STOPPED (payload watchdog).
 */
export async function runTrackingWatchdog(now = new Date()): Promise<WatchdogResult> {
  // Stade 1 — sessions orphelines (aucun point récent, démarrées avant le cutoff).
  const staleCutoff = new Date(now.getTime() - TRACKING.watchdogStaleMs);
  const stale = await db.trackingSession.findMany({
    where: {
      status: "ACTIVE",
      startedAt: { lt: staleCutoff },
      points: { none: { recordedAt: { gt: staleCutoff } } },
    },
    select: { id: true, tripId: true, busId: true, driverId: true, agencyId: true },
  });
  const pausedCount = stale.length;
  if (pausedCount > 0) {
    await db.trackingSession.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: "ACTIVE" },
      data: { status: "PAUSED" },
    });
    for (const s of stale) {
      await logTrackingEvent({
        type: "GPS_OFFLINE",
        severity: "WARN",
        sessionId: s.id,
        tripId: s.tripId,
        busId: s.busId,
        driverId: s.driverId,
        agencyId: s.agencyId,
        message: "Session orpheline mise en pause par le watchdog (aucun signal récent)",
        payload: { by: "watchdog", stage: 1 },
      });
    }
  }

  // Stade 2 — sessions vivantes trop anciennes → COMPLETED + chauffeur libéré.
  const hardCutoff = new Date(now.getTime() - TRACKING.watchdogHardMs);
  const ancient = await db.trackingSession.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, startedAt: { lt: hardCutoff } },
    select: { id: true, driverId: true, tripId: true, busId: true, agencyId: true },
  });
  const completedCount = ancient.length;
  if (completedCount > 0) {
    await db.trackingSession.updateMany({
      where: { id: { in: ancient.map((s) => s.id) } },
      data: { status: "COMPLETED", endedAt: now, endReason: "WATCHDOG" },
    });
    for (const s of ancient) {
      await logTrackingEvent({
        type: "GPS_SESSION_STOPPED",
        severity: "INFO",
        sessionId: s.id,
        tripId: s.tripId,
        busId: s.busId,
        driverId: s.driverId,
        agencyId: s.agencyId,
        message: "Session close automatiquement (durée maximale atteinte)",
        payload: { by: "watchdog", stage: 2, endReason: "WATCHDOG" },
      });
    }
  }

  // Libération des chauffeurs ON_TRIP n'ayant plus aucune session vivante.
  let driversReleased = 0;
  for (const driverId of new Set(ancient.map((s) => s.driverId))) {
    const alive = await db.trackingSession.count({
      where: { driverId, status: { in: ["ACTIVE", "PAUSED"] } },
    });
    if (alive === 0) {
      const res = await db.driver.updateMany({
        where: { id: driverId, status: "ON_TRIP" },
        data: { status: "AVAILABLE" },
      });
      driversReleased += res.count;
    }
  }

  return { pausedCount, completedCount, driversReleased };
}

// ============================================================
// Durabilité — rétention des données GPS
// ============================================================

export interface RetentionResult {
  /** Points GPS supprimés (sessions terminées > retentionPointDays). */
  purgedPoints: number;
  /** Sessions COMPLETED supprimées (> retentionSessionDays). */
  purgedSessions: number;
  /** V5 — événements GPS purgés (> retentionSessionDays). */
  purgedEvents: number;
}

/** Purge de rétention — la base Neon ne croît pas indéfiniment :
 *  à ~450 points/heure/car en mouvement, une flotte de 30 cars produit
 *  ~250 000 points/mois. Les sessions VIVANTES ne sont jamais touchées.
 *  Ordre : points d'abord (FK Restrict), puis sessions. */
export async function runRetentionCleanup(now = new Date()): Promise<RetentionResult> {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const pointsCutoff = new Date(now.getTime() - TRACKING.retentionPointDays * DAY_MS);
  const sessionsCutoff = new Date(now.getTime() - TRACKING.retentionSessionDays * DAY_MS);

  // 1. Points des sessions COMPLETED terminées depuis plus de 30 jours.
  const oldSessions = await db.trackingSession.findMany({
    where: { status: "COMPLETED", endedAt: { lt: pointsCutoff } },
    select: { id: true },
  });
  let purgedPoints = 0;
  if (oldSessions.length > 0) {
    const res = await db.gpsPoint.deleteMany({
      where: { sessionId: { in: oldSessions.map((s) => s.id) } },
    });
    purgedPoints = res.count;
  }

  // 2. Sessions COMPLETED de plus de 90 jours (avec leurs points restants).
  const ancientIds = (
    await db.trackingSession.findMany({
      where: { status: "COMPLETED", endedAt: { lt: sessionsCutoff } },
      select: { id: true },
    })
  ).map((s) => s.id);
  let purgedSessions = 0;
  if (ancientIds.length > 0) {
    await db.gpsPoint.deleteMany({ where: { sessionId: { in: ancientIds } } });
    const res = await db.trackingSession.deleteMany({ where: { id: { in: ancientIds } } });
    purgedSessions = res.count;
  }

  // 3. V5 — événements GPS (audit/alertes) purgés après le même délai
  //    que les sessions : le journal reste consultable 90 jours.
  const eventsRes = await db.trackingEvent.deleteMany({
    where: { createdAt: { lt: sessionsCutoff } },
  });

  return { purgedPoints, purgedSessions, purgedEvents: eventsRes.count };
}
