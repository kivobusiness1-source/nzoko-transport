// POST /api/tracking/start — DÉMARRER LE TRAJET (chauffeur)
// Crée la TrackingSession, passe le voyage en DEPARTED (= IN_PROGRESS
// du brief, vocabulaire métier NZOKO), horodate le départ réel,
// journalise TRIP_STARTED/GPS_STARTED et notifie l'agence.

import { NextRequest } from "next/server";
import { ok, routeError, assertSameOriginPost, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { startTrackingSchema } from "@/services/tracking/tracking.validation";
import { startTracking } from "@/services/tracking/tracking.service";

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingStart:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingStart.limit, RATE_LIMITS.trackingStart.windowMs);
    const body = startTrackingSchema.parse(await req.json());
    const result = await startTracking(auth, body.tripId);
    return ok(result, 201);
  } catch (err) {
    return routeError(err, "POST /api/tracking/start");
  }
}
