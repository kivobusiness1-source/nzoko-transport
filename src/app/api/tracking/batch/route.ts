// POST /api/tracking/batch — lot de points GPS (≤ TRACKING.batchMaxPoints = 50)
// reflushés depuis la file offline IndexedDB du chauffeur.
// Sémantique : 200 = le serveur a jugé le lot (les points invalides sont
// comptés "rejected" et définitivement abandonnés — la file locale ne les
// renverra pas). 409 = session terminée/pause → la file locale est purgée.

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, TRACKING } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { emitRealtime, isStalePoint } from "@/services/tracking";

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(400).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  accuracy: z.number().min(0).max(10_000).nullable().optional(),
  altitude: z.number().min(-1_000).max(10_000).nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }).min(10),
});

const batchSchema = z.object({
  sessionId: z.string().min(10),
  points: z.array(pointSchema).min(1).max(TRACKING.batchMaxPoints),
});

export async function POST(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingWrite:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.trackingWrite.limit, RATE_LIMITS.trackingWrite.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }

    const body = batchSchema.parse(await req.json());
    const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
    if (!driver) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
    }
    const session = await db.trackingSession.findUnique({ where: { id: body.sessionId }, select: { id: true, status: true, agencyId: true, driverId: true } });
    if (!session || session.driverId !== driver.id) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
    }
    if (session.status !== "ACTIVE") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "La session de suivi n'est plus active.");
    }

    const now = new Date();
    // Tri chronologique (recordedAt) — la file garantit déjà l'ordre, par sécurité.
    const sorted = [...body.points].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const valid: (typeof sorted)[number][] = [];
    for (const p of sorted) {
      const recordedAt = new Date(p.recordedAt);
      if (!Number.isNaN(recordedAt.getTime()) && !isStalePoint(recordedAt, now)) {
        valid.push(p);
      }
    }

    if (valid.length > 0) {
      await db.gpsPoint.createMany({
        data: valid.map((p) => ({
          sessionId: session.id,
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed ?? null,
          heading: p.heading ?? null,
          accuracy: p.accuracy ?? null,
          altitude: p.altitude ?? null,
          recordedAt: new Date(p.recordedAt),
        })),
      });
    }

    // Dernier point du lot en temps réel (les intermédiaires sont de l'historique).
    const last = valid[valid.length - 1];
    if (last) {
      await emitRealtime({
        room: "fleet",
        event: "gps",
        payload: {
          sessionId: session.id,
          agencyId: session.agencyId,
          latitude: last.latitude,
          longitude: last.longitude,
          speed: last.speed ?? null,
          heading: last.heading ?? null,
          recordedAt: last.recordedAt,
        },
      });
    }

    return ok({ accepted: valid.length, rejected: body.points.length - valid.length });
  } catch (err) {
    return routeError(err, "Erreur lot points GPS");
  }
}
