// GET /api/tracking/current — positions ACTUELLES des bus (dashboard flotte).
// OPTIMISÉ : lit TrackingSession uniquement (jamais BusLocation).
// Scope serveur : AGENCY_MANAGER = SON agence, SUPER_ADMIN/ADMIN = toutes
// (filtrable par ?agencyId=). L'agencyId client ne fait jamais foi.

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { currentQuerySchema } from "@/services/tracking/tracking.validation";
import { getFleetSnapshot } from "@/services/tracking/tracking.service";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingRead:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingRead.limit, RATE_LIMITS.trackingRead.windowMs);
    const params = currentQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const snapshot = await getFleetSnapshot(auth, params.agencyId);
    return ok(snapshot);
  } catch (err) {
    return routeError(err, "GET /api/tracking/current");
  }
}
