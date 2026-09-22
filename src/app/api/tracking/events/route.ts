// GET /api/tracking/events — journal des événements GPS (scope serveur).
// ?agencyId= (rôles globaux uniquement) &limit= (max 200)

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { eventsQuerySchema } from "@/services/tracking/tracking.validation";
import { getTrackingEvents } from "@/services/tracking/tracking.service";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingRead:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingRead.limit, RATE_LIMITS.trackingRead.windowMs);
    const params = eventsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const events = await getTrackingEvents(auth, params.agencyId, params.limit);
    return ok(events);
  } catch (err) {
    return routeError(err, "GET /api/tracking/events");
  }
}
