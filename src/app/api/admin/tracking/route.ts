// GET /api/admin/tracking — Centre de contrôle flotte GPS (ADMIN /
// SUPER_ADMIN / permission stats:global).
//
// V5 multi-bus (§25/§33 — PERFORMANCE) :
//   - SANS paramètre : vue FLOTTE en 2 requêtes (findMany sessions
//     vivantes avec état dénormalisé + 1 groupBy des compteurs de
//     points) — PLUS AUCUN N+1 (l'ancienne version faisait 2
//     requêtes PAR session : 100 bus = 200 requêtes) ;
//   - chaque session est enrichie : gpsStatus (🟢 actif / 🟡 GPS
//     silencieux mais téléphone en ligne / 🔴 hors ligne / ⚫
//     terminée — §11), tripPhase (§22), prochain arrêt + ETA +
//     retard (§15/§23), batterie, dernier signal ;
//   - KPI élargis : en retard, GPS silencieux (§43) ;
//   - événements récents WARN/CRITICAL (panneau d'alertes §35) ;
//   - ?sessionId= : détail + trail (≤ TRACKING.trailMaxPoints) +
//     événements de la session (§44).

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, TRACKING } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { GPS_V5 } from "@/lib/gps-config";
import { deriveSessionGpsStatus } from "@/lib/trip-state-machine";
import { toTrackingSessionDTO, issueSocketToken, TRACKING_SOCKET_URL, type SessionLastPoint } from "@/services/tracking";
import { recentTrackingEvents, type TrackingEventDTO } from "@/services/tracking-events";
import { stopProgressOfSession } from "@/services/tracking-geofence";
import type { FleetKpi, TrackingSessionDTO } from "@/types";

const sessionInclude = {
  driver: true,
  agency: true,
  trip: { include: { route: { include: { originCity: true, destinationCity: true } } } },
  bus: true,
} as const satisfies Prisma.TrackingSessionInclude;

type FleetSessionRow = Prisma.TrackingSessionGetPayload<{ include: typeof sessionInclude }>;

/** Dernier point reconstruit depuis l'état dénormalisé V5. */
function denormalizedLastPoint(s: FleetSessionRow): SessionLastPoint {
  if (s.lastLatitude === null || s.lastLongitude === null || s.lastPositionAt === null) return null;
  return {
    latitude: s.lastLatitude,
    longitude: s.lastLongitude,
    speed: s.lastSpeed,
    heading: s.lastHeading,
    accuracy: s.lastAccuracy,
    batteryLevel: s.lastBatteryLevel,
    recordedAt: s.lastPositionAt,
  };
}

/** Enrichit le DTO de base avec les champs V5 (gpsStatus, phase,
 *  prochain arrêt, retard, dernier signal). */
async function enrichDto(dto: TrackingSessionDTO, s: FleetSessionRow, now: Date): Promise<TrackingSessionDTO> {
  const gpsStatus = deriveSessionGpsStatus({
    sessionStatus: s.status,
    lastPositionAt: s.lastPositionAt,
    lastHeartbeatAt: s.lastHeartbeatAt,
    now,
    positionStaleMs: GPS_V5.heartbeatOfflineMs,
    heartbeatOfflineMs: GPS_V5.heartbeatOfflineMs,
  });
  const lastSignalAt = [s.lastHeartbeatAt, s.lastPositionAt].reduce<Date | null>(
    (latest, at) => (at && (!latest || at > latest) ? at : latest),
    null
  );

  const progress = await stopProgressOfSession({
    id: s.id,
    tripId: s.tripId,
    geofenceStopId: s.geofenceStopId,
    tripPhase: s.tripPhase,
    lastLatitude: s.lastLatitude,
    lastLongitude: s.lastLongitude,
    lastSpeed: s.lastSpeed,
  });

  return {
    ...dto,
    tripPhase: (s.tripPhase as TrackingSessionDTO["tripPhase"]) ?? null,
    gpsStatus,
    lastSignalAt: lastSignalAt?.toISOString() ?? null,
    batteryLevel: s.lastBatteryLevel,
    geofenceStopName: s.tripPhase === "AT_STOP" ? progress.nextStop?.name ?? null : null,
    nextStop: progress.nextStop
      ? {
          name: progress.nextStop.name,
          distanceM: progress.distanceM,
          etaIso: progress.etaIso,
          scheduledIso: progress.scheduledIso,
          delayMin: progress.delayMin,
          delayStatus: progress.delayStatus,
        }
      : null,
    distanceToDestinationM: progress.distanceToDestinationM ?? dto.distanceToDestinationM ?? null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    if (!auth.permissions.includes("stats:global")) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Vous n'avez pas accès au suivi GPS de la flotte.");
    }

    const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";

    if (sessionId) {
      // ---- Détail d'une session : trail + événements (§44) ----
      const session = await db.trackingSession.findUnique({ where: { id: sessionId }, include: sessionInclude });
      if (!session) {
        throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
      }
      const [points, pointsCount, events] = await Promise.all([
        db.gpsPoint.findMany({
          where: { sessionId },
          orderBy: { recordedAt: "asc" },
          take: TRACKING.trailMaxPoints,
          select: { latitude: true, longitude: true, speed: true, heading: true, accuracy: true, batteryLevel: true, recordedAt: true },
        }),
        db.gpsPoint.count({ where: { sessionId } }),
        recentTrackingEvents({ sessionId, limit: 100 }),
      ]);
      const last = points[points.length - 1] ?? null;
      const dto = await enrichDto(
        toTrackingSessionDTO(session, (last as SessionLastPoint) ?? denormalizedLastPoint(session), pointsCount),
        session,
        new Date()
      );
      return ok({ sessions: [dto], trail: points, events, generatedAt: new Date().toISOString(), socketUrl: TRACKING_SOCKET_URL, socketToken: "" });
    }

    // ---- Vue flotte : 2 requêtes quel que soit le nombre de bus ----
    const now = new Date();
    const sessions = await db.trackingSession.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      include: sessionInclude,
      orderBy: { startedAt: "asc" },
    });

    // 1 groupBy = compteurs de points de TOUTES les sessions d'un coup.
    const countsById = new Map<string, number>();
    if (sessions.length > 0) {
      const grouped = await db.gpsPoint.groupBy({
        by: ["sessionId"],
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        _count: { _all: true },
      });
      for (const g of grouped) countsById.set(g.sessionId, g._count._all);
    }

    const dtos = await Promise.all(
      sessions.map(async (s) => {
        const base = toTrackingSessionDTO(s, denormalizedLastPoint(s), countsById.get(s.id) ?? 0);
        return enrichDto(base, s, now);
      })
    );

    // ---- KPI (§43) : comptages issus des données réelles ----
    const kpi: FleetKpi = {
      total: dtos.length,
      moving: dtos.filter((d) => d.busStatus === "MOVING").length,
      stopped: dtos.filter((d) => d.busStatus === "STOPPED").length,
      offline: dtos.filter((d) => d.gpsStatus === "GPS_OFFLINE").length,
      arrived: dtos.filter((d) => d.busStatus === "ARRIVED").length,
      paused: sessions.filter((s) => s.status === "PAUSED").length,
      delayed: dtos.filter((d) => d.nextStop?.delayStatus === "SLIGHT_DELAY" || d.nextStop?.delayStatus === "HEAVY_DELAY").length,
      stale: dtos.filter((d) => d.gpsStatus === "GPS_STALE").length,
    };

    // ---- Panneau d'alertes (§35) : événements WARN+CRITICAL récents ----
    let events: TrackingEventDTO[] = [];
    try {
      events = await recentTrackingEvents({ severities: ["WARN", "CRITICAL"], limit: GPS_V5.alertsMaxEvents });
    } catch {
      events = []; // best-effort — la flotte reste affichée
    }

    return ok({
      sessions: dtos,
      kpi,
      events,
      generatedAt: new Date().toISOString(),
      socketUrl: TRACKING_SOCKET_URL,
      socketToken: issueSocketToken(auth.userId),
    });
  } catch (err) {
    return routeError(err, "Erreur vue flotte GPS");
  }
}
