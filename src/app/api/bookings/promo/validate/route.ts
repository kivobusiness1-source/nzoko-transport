// POST /api/bookings/promo/validate — validation publique d'un code promo
// pour un voyage (avant réservation). Code nominatif : utilisable
// uniquement par son propriétaire connecté (rôle PASSENGER).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { validatePromoForTrip } from "@/services/promo";

const schema = z.object({
  code: z.string().trim().min(3, "Code requis.").max(40, "Code trop long."),
  tripId: z.string().trim().min(1, "Voyage requis."),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    enforceRateLimit(`promoValidate:${ip}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    // Un code nominatif n'est valide que pour son propriétaire connecté
    const auth = await getAuth(req);
    const sessionUserId = auth && auth.role === "PASSENGER" ? auth.userId : null;

    const data = await validatePromoForTrip(body.code.toUpperCase(), body.tripId, sessionUserId);
    return ok(data);
  } catch (err) {
    return routeError(err, "POST /api/bookings/promo/validate");
  }
}
