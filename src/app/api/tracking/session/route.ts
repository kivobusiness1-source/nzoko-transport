// GET  /api/tracking/session — session courante du chauffeur connecté (réconciliation
//        après rechargement de page en plein trajet) → TrackingSessionDTO | null
// POST /api/tracking/session — actions { START | PAUSE | RESUME | STOP } (DRIVER seul).
//        START : lie optionnellement un voyage du jour (tripId) → bus + agence déduits,
//        chauffeur passe ON_TRIP ; STOP : chauffeur repasse AVAILABLE.

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { toTrackingSessionDTO, toTrackingSessionActionDTO, emitRealtime } from "@/services/tracking";

const actionSchema = z.object({
  action: z.enum(["START", "PAUSE", "RESUME", "STOP"]),
  tripId: z.string().min(1).nullable().optional(),
});

/** Charge le profil chauffeur + session ACTIVE/PAUSED existante. */
async function loadDriverContext(userId: string) {
  const driver = await db.driver.findUnique({ where: { userId }, include: { agency: true } });
  if (!driver) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
  }
  const current = await db.trackingSession.findFirst({
    where: { driverId: driver.id, status: { in: ["ACTIVE", "PAUSED"] } },
    orderBy: { startedAt: "desc" },
    include: { driver: true, agency: true, trip: { include: { route: { include: { originCity: true, destinationCity: true } } } }, bus: true },
  });
  return { driver, current };
}

async function serializeWithLastPoint(sessionId: string, withSocketUrl: boolean) {
  const session = await db.trackingSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { driver: true, agency: true, trip: { include: { route: { include: { originCity: true, destinationCity: true } } } }, bus: true },
  });
  const [lastPoint, pointsCount] = await Promise.all([
    db.gpsPoint.findFirst({ where: { sessionId }, orderBy: { recordedAt: "desc" } }),
    db.gpsPoint.count({ where: { sessionId } }),
  ]);
  return withSocketUrl
    ? toTrackingSessionActionDTO(session, lastPoint, pointsCount)
    : toTrackingSessionDTO(session, lastPoint, pointsCount);
}

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }
    const { current } = await loadDriverContext(auth.userId);
    if (!current) return ok(null);
    const dto = await serializeWithLastPoint(current.id, false);
    return ok(dto);
  } catch (err) {
    return routeError(err, "Erreur lecture session GPS");
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingSession:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.trackingSession.limit, RATE_LIMITS.trackingSession.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }

    const body = actionSchema.parse(await req.json());
    const { driver, current } = await loadDriverContext(auth.userId);

    switch (body.action) {
      case "START": {
        if (current) {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Une session de suivi est déjà en cours. Arrêtez-la avant d'en démarrer une nouvelle.");
        }
        // Voyage rattaché : doit appartenir au chauffeur, agence cohérente.
        let trip = null as Awaited<ReturnType<typeof db.trip.findFirst>>;
        if (body.tripId) {
          trip = await db.trip.findFirst({
            where: { id: body.tripId, driverId: driver.id },
            include: { route: { include: { originCity: true, destinationCity: true } } },
          });
          if (!trip) {
            throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable ou non assigné à votre compte.");
          }
        }
        const session = await db.trackingSession.create({
          data: {
            driverId: driver.id,
            tripId: trip?.id ?? null,
            busId: trip?.busId ?? null,
            agencyId: trip?.agencyId ?? driver.agencyId,
            status: "ACTIVE",
          },
        });
        await db.driver.update({ where: { id: driver.id }, data: { status: "ON_TRIP" } });
        const dto = await serializeWithLastPoint(session.id, true);
        await emitRealtime({ room: "fleet", event: "session-started", payload: dto });
        return ok(dto, 201);
      }

      case "PAUSE": {
        if (!current || current.status !== "ACTIVE") {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Aucune session active à mettre en pause.");
        }
        await db.trackingSession.update({ where: { id: current.id }, data: { status: "PAUSED" } });
        const dto = await serializeWithLastPoint(current.id, true);
        await emitRealtime({ room: "fleet", event: "session-updated", payload: dto });
        return ok(dto);
      }

      case "RESUME": {
        if (!current || current.status !== "PAUSED") {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Aucune session en pause à reprendre.");
        }
        await db.trackingSession.update({ where: { id: current.id }, data: { status: "ACTIVE" } });
        const dto = await serializeWithLastPoint(current.id, true);
        await emitRealtime({ room: "fleet", event: "session-updated", payload: dto });
        return ok(dto);
      }

      case "STOP": {
        if (!current) {
          throw new ApiError(409, ERROR_CODES.CONFLICT, "Aucune session de suivi en cours.");
        }
        await db.trackingSession.update({ where: { id: current.id }, data: { status: "COMPLETED", endedAt: new Date() } });
        await db.driver.update({ where: { id: driver.id }, data: { status: "AVAILABLE" } });
        const dto = await serializeWithLastPoint(current.id, true);
        await emitRealtime({ room: "fleet", event: "session-stopped", payload: dto });
        return ok(dto);
      }
    }
  } catch (err) {
    return routeError(err, "Erreur action session GPS");
  }
}
