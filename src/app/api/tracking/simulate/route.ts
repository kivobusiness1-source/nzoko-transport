// POST /api/tracking/simulate — simulation GPS (DÉVELOPPEMENT UNIQUEMENT).
// Ce endpoint n'existe PAS en production (garde NODE_ENV) : il permet de
// tester le pipeline complet (validation, géofences, realtime, dashboard)
// sans téléphone réel. Authentification + rate limit maintenus.

import { NextRequest, NextResponse } from "next/server";
import { ok, routeError, assertSameOriginPost, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { simulateSchema } from "@/services/tracking/tracking.validation";
import { simulateLocation } from "@/services/tracking/tracking.service";

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Route inexistante." } },
        { status: 404 }
      );
    }
    assertSameOriginPost(req);
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingSimulate:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingSimulate.limit, RATE_LIMITS.trackingSimulate.windowMs);
    const body = simulateSchema.parse(await req.json());
    const result = await simulateLocation(auth, body);
    return ok(result);
  } catch (err) {
    return routeError(err, "POST /api/tracking/simulate");
  }
}
