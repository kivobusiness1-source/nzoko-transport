// GET /api/agencies/nearby?lat&lng&cityId&accuracy&approximate — agences Océan du Nord
// proches d'une position (V3 GPS client). Détection quartier/ville + statut
// ouverture + distance.
// `accuracy` (m) : précision GPS du navigateur ; `approximate=true` : la
// position est un point de référence (repli manuel ville), PAS la position
// de l'utilisateur → aucun quartier affirmé (honnêteté géographique).
// Public : la position n'est JAMAIS enregistrée — calcul éphémère.
// Rate limit 30/min/IP (anti-scraping).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { findNearbyAgencies } from "@/services/agency-routing";

const boolFromQuery = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  cityId: z.string().trim().length(25).optional(),
  accuracy: z.coerce.number().min(0).max(10_000_000).optional(),
  approximate: boolFromQuery.optional(),
});

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`agenciesNearby:${getClientIp(req)}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs);
    const params = querySchema.parse({
      lat: req.nextUrl.searchParams.get("lat") ?? "",
      lng: req.nextUrl.searchParams.get("lng") ?? "",
      cityId: req.nextUrl.searchParams.get("cityId") ?? undefined,
      accuracy: req.nextUrl.searchParams.get("accuracy") ?? undefined,
      approximate: req.nextUrl.searchParams.get("approximate") ?? undefined,
    });
    const result = await findNearbyAgencies({
      latitude: params.lat,
      longitude: params.lng,
      cityId: params.cityId ?? null,
      accuracy: params.accuracy ?? null,
      approximate: params.approximate ?? false,
    });
    return ok(result);
  } catch (err) {
    return routeError(err, "GET /api/agencies/nearby");
  }
}
