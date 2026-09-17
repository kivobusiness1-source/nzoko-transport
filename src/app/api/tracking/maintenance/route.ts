// POST /api/tracking/maintenance — tâches de durabilité du module GPS.
//
// Appelée périodiquement (5 min) par le scheduler du mini-service
// tracking-realtime via signature HMAC-SHA256 du corps brut
// (x-signature, même secret partagé que le pont interne /internal/emit).
// Actions : "watchdog" (sessions orphelines) | "retention" (purge) | "all".
//
// GET /api/tracking/maintenance — variante pour CRON D'HEBERGEMENT
// (Vercel Cron, cron-job.org…) : en-tête « Authorization: Bearer <CRON_SECRET> »
// et action "all". Complément indispensable en production : le mini-service
// socket.io ne tourne pas sur les plateformes serverless — sans ce cron, le
// watchdog ne s'exécuterait pas et les sessions orphelines s'accumuleraient.
//
// Deux authentifications distinctes (secret partagé HMAC pour le service
// interne, CRON_SECRET pour l'ordonnanceur de la plateforme) — aucune
// session utilisateur n'est requise, aucune donnée sensible en réponse.

import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import {
  TRACKING_SECRET,
  runTrackingWatchdog,
  runRetentionCleanup,
  type WatchdogResult,
  type RetentionResult,
} from "@/services/tracking";

const bodySchema = z.object({ action: z.enum(["watchdog", "retention", "all"]) });

/** Comparaison à temps constant de deux secrets (longueur incluse). */
function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Vérifie x-signature = HMAC-SHA256(secret, corps brut). */
function verifyMaintenanceSignature(rawBody: string, received: string | undefined): boolean {
  if (typeof received !== "string" || received.length === 0) return false;
  const expected = createHmac("sha256", TRACKING_SECRET).update(rawBody).digest("hex");
  return safeEqual(received, expected);
}

/** Vérifie « Authorization: Bearer <CRON_SECRET> » (cron d'hébergement).
 *  CRON_SECRET non configuré → refus systématique (jamais ouvert sans secret). */
function verifyCronBearer(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && safeEqual(header.slice(7), secret);
}

async function runAll(): Promise<{ ranAt: string; watchdog: WatchdogResult; retention: RetentionResult }> {
  return {
    ranAt: new Date().toISOString(),
    watchdog: await runTrackingWatchdog(),
    retention: await runRetentionCleanup(),
  };
}

export async function POST(req: NextRequest) {
  try {
    enforceRateLimit(
      `trackingMaintenance:${getClientIp(req)}`,
      RATE_LIMITS.trackingMaintenance.limit,
      RATE_LIMITS.trackingMaintenance.windowMs
    );
    const rawBody = await req.text();
    if (!verifyMaintenanceSignature(rawBody, req.headers.get("x-signature") ?? undefined)) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Signature de maintenance invalide.");
    }
    const body = bodySchema.parse(JSON.parse(rawBody));

    if (body.action === "watchdog") {
      return ok({ ranAt: new Date().toISOString(), watchdog: await runTrackingWatchdog(), retention: null });
    }
    if (body.action === "retention") {
      return ok({ ranAt: new Date().toISOString(), watchdog: null, retention: await runRetentionCleanup() });
    }
    return ok(await runAll());
  } catch (err) {
    return routeError(err, "Erreur maintenance GPS");
  }
}

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(
      `trackingMaintenance:${getClientIp(req)}`,
      RATE_LIMITS.trackingMaintenance.limit,
      RATE_LIMITS.trackingMaintenance.windowMs
    );
    if (!verifyCronBearer(req)) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Accès cron non autorisé (CRON_SECRET requis).");
    }
    return ok(await runAll());
  } catch (err) {
    return routeError(err, "Erreur maintenance GPS (cron)");
  }
}
