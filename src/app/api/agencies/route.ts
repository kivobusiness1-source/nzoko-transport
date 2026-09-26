// GET /api/agencies — contrat API centrale §17 : liste publique des agences
// actives (choix de l'agence par le client §5). Réponse légère, cache OK (§20).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`agencies:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    const agencies = await db.agency.findMany({
      where: { isActive: true },
      include: { city: { select: { id: true, name: true, slug: true } }, neighborhood: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    });
    return ok(
      agencies.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        city: { id: a.city.id, name: a.city.name, slug: a.city.slug },
        neighborhood: a.neighborhood ? { id: a.neighborhood.id, name: a.neighborhood.name } : null,
        address: a.address,
        phone: a.phone,
        email: a.email,
        description: a.description,
        latitude: a.latitude,
        longitude: a.longitude,
        openingTime: a.openingTime,
        closingTime: a.closingTime,
        isActive: a.isActive,
      }))
    );
  } catch (err) {
    return routeError(err, "GET /api/agencies");
  }
}
