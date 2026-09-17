// GET /api/admin/momo/overview — état d'intégration MTN MoMo + soldes (finance:read)
// AUCUN secret n'est exposé : uniquement configured/env/devise/soldes.
// Rate limit 10/min/utilisateur.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { getMomoOverview } from "@/services/payment";

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "finance:read");
    enforceRateLimit(`momo-overview:${auth.userId}`, RATE_LIMITS.momoOverview.limit, RATE_LIMITS.momoOverview.windowMs);

    const overview = await getMomoOverview();
    return ok(overview);
  } catch (err) {
    return routeError(err, "GET /api/admin/momo/overview");
  }
}
