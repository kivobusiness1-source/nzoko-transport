// GET /api/tracking/history/[tripId] — historique GPS d'un voyage :
// polyligne (points paginés), stats (distance, vitesses, durées) et
// arrêts. Chargé UNIQUEMENT à la demande (jamais au dashboard).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { historyQuerySchema } from "@/services/tracking/tracking.validation";
import { getTripHistory } from "@/services/tracking/tracking.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingRead:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingRead.limit, RATE_LIMITS.trackingRead.windowMs);
    const { tripId } = await params;
    const q = historyQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const history = await getTripHistory(auth, tripId, q.cursor, q.limit);
    return ok(history);
  } catch (err) {
    return routeError(err, "GET /api/tracking/history/[tripId]");
  }
}
