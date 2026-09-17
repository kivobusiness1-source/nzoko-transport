// GET /api/admin/clients?q= — liste des clients (rôle PASSENGER) avec
// agrégats (voyages, dépenses, points, palier, dernier voyage, inactivité).
// Accès : SUPER_ADMIN, ADMIN. Recherche nom/téléphone/e-mail, limite 200.

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { loadAdminClientRows } from "@/services/admin-clients";
import type { AdminClientDTO } from "@/types";

const MAX_ROWS = 200;

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    if (!["SUPER_ADMIN", "ADMIN"].includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux administrateurs.");
    }
    enforceRateLimit(`adminRead:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const q = req.nextUrl.searchParams.get("q") ?? undefined;
    const rows = await loadAdminClientRows(q);

    const data: AdminClientDTO[] = rows.slice(0, MAX_ROWS).map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      createdAt: r.createdAt.toISOString(),
      tripsCompleted: r.tripsCompleted,
      totalSpent: r.totalSpent,
      pointsBalance: r.pointsBalance,
      lifetimePoints: r.lifetimePoints,
      tier: r.tier,
      lastTripAt: r.lastTripAt?.toISOString() ?? null,
      inactiveDays: r.inactiveDays,
    }));
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/clients");
  }
}
