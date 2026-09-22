// GET /api/tracking/trip/[tripId] — session de suivi d'un voyage (lecture,
// filtrée par agence autorisée — jamais parce qu'un simple ID est connu).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { getTripSession } from "@/services/tracking/tracking.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingRead:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingRead.limit, RATE_LIMITS.trackingRead.windowMs);
    const { tripId } = await params;
    const session = await getTripSession(auth, tripId);
    return ok(session);
  } catch (err) {
    return routeError(err, "GET /api/tracking/trip/[tripId]");
  }
}
