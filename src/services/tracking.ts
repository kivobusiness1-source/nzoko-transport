// ============================================================
// NZOKO TRANSPORT — Service suivi GPS temps réel
// Persistance (Prisma) + émission vers le mini-service socket.io
// (best-effort : si le service temps réel est absent, les points
// sont simplement stockés — l'admin bascule en polling).
// ============================================================

import { createHmac, timingSafeEqual } from "crypto";
import type { TrackingSession, GpsPoint, Trip, Bus, Driver, Agency } from "@prisma/client";
import { TRACKING } from "@/lib/constants";
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
