// GET /api/neighborhoods?cityId — quartiers ACTIFS d'une ville (public, pas d'auth)
// → PublicNeighborhoodDTO[] { id, name }
// Utilisé par le tunnel de réservation : « Quartier d'arrêt » à la destination.
// Les quartiers sont configurés dans l'admin (Parc → Quartiers).
// Rate limit standard "public" 60/min/IP (données quasi statiques).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import type { PublicNeighborhoodDTO } from "@/types";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`neighborhoods:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);

    const cityId = req.nextUrl.searchParams.get("cityId");
    if (!cityId || cityId.length > 60) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Paramètre cityId requis.");
    }

    const rows = await db.neighborhood.findMany({
      where: { cityId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    return ok(rows satisfies PublicNeighborhoodDTO[]);
  } catch (err) {
    return routeError(err, "GET /api/neighborhoods");
  }
}
