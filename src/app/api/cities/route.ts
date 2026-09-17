// GET /api/cities — villes actives (public, pas d'auth) → CityDTO[]
// Rate limit standard "public" 60/min/IP (données statiques, cache possible côté client).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`cities:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    const cities = await db.city.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, country: true, isActive: true },
    });
    return ok(cities);
  } catch (err) {
    return routeError(err, "GET /api/cities");
  }
}
