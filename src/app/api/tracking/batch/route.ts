// POST /api/tracking/batch — lot de points GPS (≤ TRACKING.batchMaxPoints = 50)
// reflushés depuis la file offline IndexedDB du chauffeur.
//
// V5 (§38) : le serveur juge CHAQUE position indépendamment et rend
// un résultat PAR position — une seule position invalide ne fait
// JAMAIS échouer le lot :
//   results: [{ positionId, verdict, reason }]
//   verdict ∈ ACCEPT | ACCEPT_FLAGGED | ACCEPT_HISTORY_ONLY |
//            DUPLICATE | REJECT_*
// 200 = le serveur a rendu son jugement (les REJECT/DUPLICATE sont
// définitifs — la file locale ne les renverra pas). 409 = session
// terminée/pause → la file locale est purgée.
//
// Idempotent (§9/§10) : les positionIds déjà connus sont comptés
// « duplicates » sans écriture ni erreur.

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, TRACKING } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { ingestPositions, type IngestSession } from "@/services/tracking-ingest";

const pointSchema = z.object({
  positionId: z.string().min(8).max(64).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(400).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  accuracy: z.number().min(0).max(10_000).nullable().optional(),
  altitude: z.number().min(-1_000).max(10_000).nullable().optional(),
  batteryLevel: z.number().min(0).max(100).nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }).min(10),
});

const batchSchema = z.object({
  sessionId: z.string().min(10),
  /** V5 — identifiant du téléphone (audit). */
  deviceId: z.string().min(8).max(64).nullable().optional(),
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
    const session = await db.trackingSession.findUnique({
      where: { id: body.sessionId },
      select: {
        id: true, driverId: true, tripId: true, busId: true, agencyId: true, deviceId: true,
        status: true, lastPositionAt: true, lastLatitude: true, lastLongitude: true, lastSpeed: true,
        geofenceStopId: true, geofenceEnteredAt: true, tripPhase: true,
      },
    });
    if (!session || session.driverId !== driver.id) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
    }
    if (session.status !== "ACTIVE") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "La session de suivi n'est plus active.");
    }

    // Tri chronologique STRICT (recordedAt) — garanti par la file,
    // re-vérifié ici : le pipeline valide contre l'état roulant.
    const sorted = [...body.points].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    const outcome = await ingestPositions({
      session: session as IngestSession,
      points: sorted.map((p) => ({
        positionId: p.positionId ?? null,
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed ?? null,
        heading: p.heading ?? null,
        accuracy: p.accuracy ?? null,
        altitude: p.altitude ?? null,
        batteryLevel: p.batteryLevel ?? null,
        recordedAt: new Date(p.recordedAt),
      })),
      actorUserId: auth.userId,
      deviceId: body.deviceId ?? null,
    });

    return ok({
      accepted: outcome.accepted,
      rejected: outcome.rejected,
      duplicates: outcome.duplicates,
      destinationArrived: outcome.destinationArrived,
      /** Résultat PAR position (§38) — la file locale supprime les
       *  positions jugées (ACCEPT/REJECT/DUPLICATE) et conserve les
       *  autres (échec réseau → non présentes ici). */
      results: outcome.results,
    });
  } catch (err) {
    return routeError(err, "Erreur lot points GPS");
  }
}
