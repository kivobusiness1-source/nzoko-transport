// GET /api/tracking/stream-token — jeton HMAC court (60 s) prouvant le
// DROIT de s'abonner aux salons temps réel de l'agence (ou global pour
// SUPER_ADMIN/ADMIN). Le mini-service socket.io vérifie ce jeton avec le
// secret partagé TRACKING_REALTIME_SECRET (jamais envoyé au navigateur).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { createStreamToken, buildStreamScope, isRealtimeEnabled } from "@/services/tracking/realtime.service";
import { assertPermission } from "@/lib/auth";
import { resolveAgencyScope } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    enforceRateLimit(`trackingRead:${auth.userId}:${getClientIp(req)}`, RATE_LIMITS.trackingRead.limit, RATE_LIMITS.trackingRead.windowMs);
    assertPermission(auth, "tracking:read");
    const requestedAgency = req.nextUrl.searchParams.get("agencyId") ?? undefined;
    const scope = resolveAgencyScope(auth, requestedAgency);
    const agencyIds = await buildStreamScope(scope);
    const { token, expiresAt } = createStreamToken({ userId: auth.userId, role: auth.role, agencyIds });
    return ok({ token, expiresAt, agencyIds, realtime: isRealtimeEnabled() });
  } catch (err) {
    return routeError(err, "GET /api/tracking/stream-token");
  }
}
