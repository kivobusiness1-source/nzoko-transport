// GET /api/agencies/[id] — contrat API centrale §17 : détail public d'une agence.

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    enforceRateLimit(`agency:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    const { id } = await params;
    const agency = await db.agency.findFirst({
      where: { OR: [{ id }, { code: id.toUpperCase() }] },
      include: { city: { select: { id: true, name: true, slug: true } }, neighborhood: { select: { id: true, name: true } } },
    });
    if (!agency || !agency.isActive) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Agence introuvable.");
    }
    return ok({
      id: agency.id,
      code: agency.code,
      name: agency.name,
      city: { id: agency.city.id, name: agency.city.name, slug: agency.city.slug },
      neighborhood: agency.neighborhood ? { id: agency.neighborhood.id, name: agency.neighborhood.name } : null,
      address: agency.address,
      phone: agency.phone,
      email: agency.email,
      description: agency.description,
      latitude: agency.latitude,
      longitude: agency.longitude,
      openingTime: agency.openingTime,
      closingTime: agency.closingTime,
      isActive: agency.isActive,
    });
  } catch (err) {
    return routeError(err, "GET /api/agencies/[id]");
  }
}
