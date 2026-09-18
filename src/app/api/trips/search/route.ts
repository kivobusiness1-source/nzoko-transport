// GET /api/trips/search?from&to&date — recherche publique de voyages → TripSearchDTO[]
// Rate limit 30/min/IP (requêtes validées par Zod avant toute requête base).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { searchTrips } from "@/services/booking";
import { isValidDateStr } from "@/lib/dates";

const querySchema = z.object({
  from: z.string().trim().min(1, "Ville de départ requise."),
  to: z.string().trim().min(1, "Ville d'arrivée requise."),
  date: z
    .string()
    .trim()
    .refine((s) => isValidDateStr(s), "Date invalide (format attendu YYYY-MM-DD)."),
  agencyId: z.string().trim().length(25).optional(), // V3 — filtre « Trouver mon agence »
});

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`search:${getClientIp(req)}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs);
    const params = querySchema.parse({
      from: req.nextUrl.searchParams.get("from") ?? "",
      to: req.nextUrl.searchParams.get("to") ?? "",
      date: req.nextUrl.searchParams.get("date") ?? "",
      agencyId: req.nextUrl.searchParams.get("agencyId") ?? undefined,
    });
    const trips = await searchTrips(params);
    return ok(trips);
  } catch (err) {
    return routeError(err, "GET /api/trips/search");
  }
}
