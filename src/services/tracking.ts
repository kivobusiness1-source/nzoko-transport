// ============================================================
// NZOKO TRANSPORT — Service suivi GPS temps réel
// Persistance (Prisma) + émission vers le mini-service socket.io
// (best-effort : si le service temps réel est absent, les points
// sont simplement stockés — l'admin bascule en polling).
// ============================================================

import { createHmac, timingSafeEqual } from "crypto";
import type { TrackingSession, GpsPoint, Trip, Bus, Driver, Agency } from "@prisma/client";
import { TRACKING } from "@/lib/constants";
import { db } from "@/lib/db";
import type { TrackingSessionDTO, TrackingSessionActionDTO } from "@/types";

/** Secret partagé Next ↔ mini-service socket.io (défaut dev, override prod). */
export const TRACKING_SECRET = process.env.TRACKING_SECRET ?? "nzoko-tracking-dev-secret-change-me";
/** URL interne du mini-service temps réel. */
export const TRACKING_REALTIME_URL = process.env.TRACKING_REALTIME_URL ?? "http://127.0.0.1:3004";
/** URL FRONTALE du service temps réel (passerelle Caddy → XTransformPort). */
export const TRACKING_SOCKET_URL = "/?XTransformPort=3003";

type SessionWithRelations = TrackingSession & {
  driver: Driver;
  agency: Agency;
  trip: (Trip & { route?: { originCity?: { name: string }; destinationCity?: { name: string } } }) | null;
  bus: Bus | null;
};

/** Sérialise une ligne Prisma vers le DTO public (jamais d'ids internes inutiles au-delà du nécessaire). */
export function toTrackingSessionDTO(
  session: SessionWithRelations,
  lastPoint: GpsPoint | null,
  pointsCount: number
): TrackingSessionDTO {
  const trip = session.trip;
  const route = trip?.route;
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
          recordedAt: lastPoint.recordedAt.toISOString(),
        }
      : null,
    pointsCount,
  };
}

export function toTrackingSessionActionDTO(session: SessionWithRelations, lastPoint: GpsPoint | null, pointsCount: number): TrackingSessionActionDTO {
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
 *
 *  Stade 2 : une session vivante plus vieille que watchdogHardMs (24 h) est
 *  close d'office (COMPLETED, endedAt) et le chauffeur est libéré — un car
 *  interurbain Congo ne roule pas 24 h d'affilée sur une même session.
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
    select: { id: true },
  });
  const pausedCount = stale.length;
  if (pausedCount > 0) {
    await db.trackingSession.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: "ACTIVE" },
      data: { status: "PAUSED" },
    });
  }

  // Stade 2 — sessions vivantes trop anciennes → COMPLETED + chauffeur libéré.
  const hardCutoff = new Date(now.getTime() - TRACKING.watchdogHardMs);
  const ancient = await db.trackingSession.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, startedAt: { lt: hardCutoff } },
    select: { id: true, driverId: true },
  });
  const completedCount = ancient.length;
  if (completedCount > 0) {
    await db.trackingSession.updateMany({
      where: { id: { in: ancient.map((s) => s.id) } },
      data: { status: "COMPLETED", endedAt: now },
    });
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

  return { purgedPoints, purgedSessions };
}
