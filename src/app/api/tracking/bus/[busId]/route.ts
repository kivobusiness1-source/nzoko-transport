// GET /api/tracking/bus/[busId] — voyages suivis d'un bus sur une période
// (l'ID d'un bus d'une AUTRE agence ne donne AUCUN accès — 404).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { busHistoryQuerySchema } from "@/services/tracking/tracking.validation";
import { getBusHistory } from "@/services/tracking/tracking.service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ busId: string }> }) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingRead:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingRead.limit, RATE_LIMITS.trackingRead.windowMs);
    const { busId } = await params;
    const q = busHistoryQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const history = await getBusHistory(auth, busId, q.from, q.to, q.limit);
    return ok(history);
  } catch (err) {
    return routeError(err, "GET /api/tracking/bus/[busId]");
  }
}
