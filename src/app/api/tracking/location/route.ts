// POST /api/tracking/location — point GPS isolé du chauffeur connecté
// (DRIVER). Session ACTIVE obligatoire (PAUSED/terminée → 409 : le
// client coupe le watch).
//
// V5 : le point traverse le pipeline d'ingestion complet —
//   - positionId (idempotence §9) : doublon → 200 { duplicate: true } ;
//   - validation serveur (§8) : coordonnées/horodatage/vitesse/
//     téléportation contrôlés → 422 si REJECT, 200 { flagged: true }
//     si anomalie signalée mais plausible ;
//   - anti-hors-ordre (§12) : une position plus ancienne que l'état
//     courant est ARCHIVÉE (200 { historyOnly: true }) sans jamais
//     faire reculer l'état ;
//   - géofences + arrivée destination (§20/§21) + temps réel enrichi.

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { ingestPositions, type IngestSession } from "@/services/tracking-ingest";
import { VERDICT_LABELS, type PositionVerdict } from "@/services/tracking-validate";

const pointSchema = z.object({
  sessionId: z.string().min(10),
  /** V5 — identifiant d'idempotence généré par le téléphone à la capture. */
  positionId: z.string().min(8).max(64).nullable().optional(),
  /** V5 — identifiant du téléphone (info d'audit, cf. device-id). */
  deviceId: z.string().min(8).max(64).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(400).nullable().optional(),
  heading: z.number().min(0).max(360).nullable().optional(),
  accuracy: z.number().min(0).max(10_000).nullable().optional(),
  altitude: z.number().min(-1_000).max(10_000).nullable().optional(),
  batteryLevel: z.number().min(0).max(100).nullable().optional(),
  recordedAt: z.string().datetime({ offset: true }).min(10),
});

/** Réponse normalisée : verdict au client (jamais d'échec global). */
function pointResponse(verdict: PositionVerdict, reason: string | null, extra: Record<string, unknown> = {}) {
  const rejected = verdict.startsWith("REJECT_");
  return ok(
    {
      verdict,
      label: VERDICT_LABELS[verdict],
      reason,
      accepted: rejected ? 0 : 1,
      rejected: rejected ? 1 : 0,
      duplicate: verdict === "DUPLICATE",
      flagged: verdict === "ACCEPT_FLAGGED",
      historyOnly: verdict === "ACCEPT_HISTORY_ONLY",
      ...extra,
    },
    rejected ? 422 : 200
  );
}

export async function POST(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingWrite:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.trackingWrite.limit, RATE_LIMITS.trackingWrite.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }

    const point = pointSchema.parse(await req.json());
    const recordedAt = new Date(point.recordedAt);
    if (Number.isNaN(recordedAt.getTime())) {
      throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, "Horodatage GPS invalide.");
    }

    const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
    if (!driver) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
    }
    const session = await db.trackingSession.findUnique({
      where: { id: point.sessionId },
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
      // Pause/terminée : le client DOIT arrêter le watch (conflit explicite).
      throw new ApiError(409, ERROR_CODES.CONFLICT, "La session de suivi n'est plus active.");
    }

    const outcome = await ingestPositions({
      session: session as IngestSession,
      points: [
        {
          positionId: point.positionId ?? null,
          latitude: point.latitude,
          longitude: point.longitude,
          speed: point.speed ?? null,
          heading: point.heading ?? null,
          accuracy: point.accuracy ?? null,
          altitude: point.altitude ?? null,
          batteryLevel: point.batteryLevel ?? null,
          recordedAt,
        },
      ],
      actorUserId: auth.userId,
      deviceId: point.deviceId ?? null,
    });

    const result = outcome.results[0];
    if (!result) {
      // Impossible par construction — défensif.
      return ok({ accepted: 0, rejected: 0, verdict: "ACCEPT", label: VERDICT_LABELS.ACCEPT, reason: null });
    }
    return pointResponse(result.verdict, result.reason, {
      destinationArrived: outcome.destinationArrived,
      routeLabel: outcome.routeLabel,
    });
  } catch (err) {
    return routeError(err, "Erreur enregistrement point GPS");
  }
}
