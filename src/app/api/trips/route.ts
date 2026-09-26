// GET /api/trips — contrat API centrale §17 : recherche publique de voyages.
// Params : from (cityId), to (cityId), date (YYYY-MM-DD), agencyId (optionnel, §5).
// Réutilise le moteur métier searchTrips (disponibilité par voyage, jamais cache).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { searchTrips } from "@/services/booking";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`trips:${getClientIp(req)}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs);
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const date = searchParams.get("date");
    if (!from || !to || !date) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Paramètres requis : from, to, date (YYYY-MM-DD).");
    }
    const trips = await searchTrips({ from, to, date, agencyId: searchParams.get("agencyId") });
    return ok(trips);
  } catch (err) {
    return routeError(err, "GET /api/trips");
  }
}
