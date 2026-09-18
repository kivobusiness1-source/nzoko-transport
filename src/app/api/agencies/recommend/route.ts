// POST /api/agencies/recommend — agence recommandée pour un voyage (V3).
// Corps : { lat, lng, fromCityId, toCityId, date, seats? }.
// CAS 1 : agence la plus proche disponible → proposée directement.
// CAS 2 : la plus proche complète/fermée → alternative motivée la plus proche.
// CAS 3 : aucune disponible → liste + sélection manuelle.
// Public (même-origine) : position jamais enregistrée. Rate limit 20/min/IP.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { isValidDateStr } from "@/lib/dates";
import { recommendAgency } from "@/services/agency-routing";

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  fromCityId: z.string().trim().length(25),
  toCityId: z.string().trim().length(25),
  date: z.string().trim().refine((s) => isValidDateStr(s), "Date invalide (format attendu YYYY-MM-DD)."),
  seats: z.coerce.number().int().min(1).max(10).optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    enforceRateLimit(`agenciesRecommend:${getClientIp(req)}`, RATE_LIMITS.seatMap.limit, RATE_LIMITS.seatMap.windowMs);
    const body = bodySchema.parse(await req.json().catch(() => null));
    const result = await recommendAgency({
      latitude: body.lat,
      longitude: body.lng,
      fromCityId: body.fromCityId,
      toCityId: body.toCityId,
      date: body.date,
      seats: body.seats ?? 1,
    });
    return ok(result);
  } catch (err) {
    return routeError(err, "POST /api/agencies/recommend");
  }
}
