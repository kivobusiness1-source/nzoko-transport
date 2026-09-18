// GET /api/agencies/nearby?lat&lng&cityId — agences NZOKO proches d'une position
// (V3 GPS client). Détection quartier/ville + statut ouverture + distance.
// Public : la position n'est JAMAIS enregistrée — calcul éphémère côté serveur.
// Rate limit 30/min/IP (anti-scraping).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { findNearbyAgencies } from "@/services/agency-routing";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  cityId: z.string().trim().length(25).optional(),
});

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`agenciesNearby:${getClientIp(req)}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs);
    const params = querySchema.parse({
      lat: req.nextUrl.searchParams.get("lat") ?? "",
      lng: req.nextUrl.searchParams.get("lng") ?? "",
      cityId: req.nextUrl.searchParams.get("cityId") ?? undefined,
    });
    const result = await findNearbyAgencies({
      latitude: params.lat,
      longitude: params.lng,
      cityId: params.cityId ?? null,
    });
    return ok(result);
  } catch (err) {
    return routeError(err, "GET /api/agencies/nearby");
  }
}
