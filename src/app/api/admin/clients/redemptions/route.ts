// GET /api/admin/clients/redemptions — demandes de récompense fidélité
// Toutes les demandes, PENDING d'abord puis date décroissante.
// Accès : SUPER_ADMIN, ADMIN.

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { toRedemptionRequestDTO } from "@/services/client-space";
import { db } from "@/lib/db";
import type { RedemptionRequestDTO } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    if (!["SUPER_ADMIN", "ADMIN"].includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux administrateurs.");
    }
    enforceRateLimit(`adminRead:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const redemptions = await db.redemptionRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // PENDING d'abord (file de traitement), puis le reste par date
    const pending = redemptions.filter((r) => r.status === "PENDING");
    const decided = redemptions.filter((r) => r.status !== "PENDING");
    const data: RedemptionRequestDTO[] = [...pending, ...decided].map(toRedemptionRequestDTO);
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/clients/redemptions");
  }
}
