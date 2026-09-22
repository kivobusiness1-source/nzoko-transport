// POST /api/tracking/resume — REPRENDRE le suivi après pause — chauffeur uniquement.

import { NextRequest } from "next/server";
import { ok, routeError, assertSameOriginPost, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { resumeTracking } from "@/services/tracking/tracking.service";

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingStart:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingStart.limit, RATE_LIMITS.trackingStart.windowMs);
    const result = await resumeTracking(auth);
    return ok(result);
  } catch (err) {
    return routeError(err, "POST /api/tracking/resume");
  }
}
