// POST /api/tracking/heartbeat — battement de cœur de la session GPS
// du chauffeur connecté (DRIVER), SÉPARÉ des positions (§11) :
// prouve que le TÉLÉPHONE est en ligne même sans position GPS
// (tunnel, GPS perdu, écran verrouillé…). Ne crée AUCUNE ligne de
// position — met à jour lastHeartbeatAt uniquement.
//
// Réponse idempotente 200 : { ok, positionFresh, sessionStatus }.
// 409 si la session n'est plus ACTIVE (le client doit arrêter).

import { NextRequest } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordHeartbeat } from "@/services/tracking-ingest";

const heartbeatSchema = z.object({
  sessionId: z.string().min(10),
  batteryLevel: z.number().min(0).max(100).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingWrite:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.trackingWrite.limit, RATE_LIMITS.trackingWrite.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Le suivi GPS est réservé aux chauffeurs.");
    }

    const body = heartbeatSchema.parse(await req.json());
    const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
    if (!driver) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
    }
    const session = await db.trackingSession.findUnique({
      where: { id: body.sessionId },
      select: { id: true, status: true, driverId: true, lastPositionAt: true, lastHeartbeatAt: true },
    });
    if (!session || session.driverId !== driver.id) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Session de suivi introuvable.");
    }
    if (session.status !== "ACTIVE") {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "La session de suivi n'est plus active.");
    }

    const result = await recordHeartbeat({
      session,
      batteryLevel: body.batteryLevel ?? null,
    });
    return ok(result);
  } catch (err) {
    return routeError(err, "Erreur heartbeat GPS");
  }
}
