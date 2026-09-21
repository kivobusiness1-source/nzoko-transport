// POST /api/tracking/location — point GPS isolé du chauffeur connecté (DRIVER).
// Session ACTIVE obligatoire (PAUSED/terminée → 409 : le client coupe le watch).
// Points hors fenêtre de tolérance (> 6 h) rejetés en 422 VALIDATION_ERROR
// (point abandonné côté client — jugement définitif).

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { emitRealtime, isStalePoint, maybeMarkArrival } from "@/services/tracking";

const pointSchema = z.object({
  sessionId: z.string().min(10),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(400).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  accuracy: z.number().min(0).max(10_000).nullable().optional(),
  altitude: z.number().min(-1_000).max(10_000).nullable().optional(),
  // V4 GPS — pourcentage de batterie du téléphone chauffeur (0–100).
  batteryLevel: z.number().min(0).max(100).nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }).min(10),
});

export async function POST(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingWrite:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.trackingWrite.limit, RATE_LIMITS.trackingWrite.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }

    const point = pointSchema.parse(await req.json());
    const recordedAt = new Date(point.recordedAt);
    if (Number.isNaN(recordedAt.getTime()) || isStalePoint(recordedAt)) {
      throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, "Point GPS trop ancien ou date invalide (fenêtre 6 h).");
    }

    const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
    if (!driver) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
    }
    const session = await db.trackingSession.findUnique({ where: { id: point.sessionId }, select: { id: true, status: true, agencyId: true, driverId: true, tripId: true } });
    if (!session || session.driverId !== driver.id) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
    }
    if (session.status !== "ACTIVE") {
      // Pause/terminée : le client DOIT arrêter le watch (conflit explicite).
      throw new ApiError(409, ERROR_CODES.CONFLICT, "La session de suivi n'est plus active.");
    }

    const created = await db.gpsPoint.create({
      data: {
        sessionId: session.id,
        latitude: point.latitude,
        longitude: point.longitude,
        speed: point.speed ?? null,
        heading: point.heading ?? null,
        accuracy: point.accuracy ?? null,
        altitude: point.altitude ?? null,
        batteryLevel: point.batteryLevel ?? null,
        recordedAt,
      },
    });

    // Temps réel best-effort (salon flotte + salon agence).
    await emitRealtime({
      room: "fleet",
      event: "gps",
      payload: {
        sessionId: session.id,
        agencyId: session.agencyId,
        latitude: created.latitude,
        longitude: created.longitude,
        speed: created.speed,
        heading: created.heading,
        recordedAt: created.recordedAt.toISOString(),
      },
    });

    // V4 GPS — détection d'arrivée best-effort : si le bus entre dans le
    // rayon de la destination officielle, le trip passe ARRIVED + événement
    // « bus-arrived ». Une erreur ici ne fait JAMAIS échouer le point.
    await maybeMarkArrival({
      sessionId: session.id,
      tripId: session.tripId,
      lastPoint: { latitude: created.latitude, longitude: created.longitude },
      actorUserId: auth.userId,
    });

    return ok({ accepted: 1, rejected: 0 }, 201);
  } catch (err) {
    return routeError(err, "Erreur enregistrement point GPS");
  }
}
