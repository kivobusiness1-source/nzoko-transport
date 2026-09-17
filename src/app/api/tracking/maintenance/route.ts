// POST /api/tracking/maintenance — tâches de durabilité du module GPS.
//
// Appelée périodiquement (5 min) par le scheduler du mini-service
// tracking-realtime via signature HMAC-SHA256 du corps brut
// (x-signature, même secret partagé que le pont interne /internal/emit).
// Actions : "watchdog" (sessions orphelines) | "retention" (purge) | "all".
//
// Le SECRET partagé fait office d'authentification : aucun cookie/session
// n'est requis — et aucune donnée sensible n'est exposée en réponse.

import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES } from "@/lib/api-response";
import {
  TRACKING_SECRET,
  runTrackingWatchdog,
  runRetentionCleanup,
  type WatchdogResult,
  type RetentionResult,
} from "@/services/tracking";

const bodySchema = z.object({ action: z.enum(["watchdog", "retention", "all"]) });

/** Vérifie x-signature = HMAC-SHA256(secret, corps brut). */
function verifyMaintenanceSignature(rawBody: string, received: string | undefined): boolean {
  if (typeof received !== "string" || received.length === 0) return false;
  const expected = createHmac("sha256", TRACKING_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    if (!verifyMaintenanceSignature(rawBody, req.headers.get("x-signature") ?? undefined)) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Signature de maintenance invalide.");
    }
    const body = bodySchema.parse(JSON.parse(rawBody));

    const watchdog: WatchdogResult | null = body.action === "retention" ? null : await runTrackingWatchdog();
    const retention: RetentionResult | null = body.action === "watchdog" ? null : await runRetentionCleanup();

    return ok({ ranAt: new Date().toISOString(), watchdog, retention });
  } catch (err) {
    return routeError(err, "Erreur maintenance GPS");
  }
}
