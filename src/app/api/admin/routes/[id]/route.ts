// PATCH /api/admin/routes/[id] — prix/distance/durée/activation (route:manage)
// logAudit PRICE_CHANGED si basePrice modifié, sinon ROUTE_UPDATED.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const updateSchema = z
  .object({
    distanceKm: z.number().int().positive("La distance doit être positive.").optional(),
    estimatedDurationMinutes: z.number().int().positive("La durée doit être positive.").optional(),
    basePrice: z.number().int("Montant entier XAF requis.").min(0, "Le prix de base ne peut pas être négatif.").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "route:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const existing = await db.route.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Route introuvable.");

    const route = await db.route.update({
      where: { id },
      data: {
        ...(body.distanceKm !== undefined ? { distanceKm: body.distanceKm } : {}),
        ...(body.estimatedDurationMinutes !== undefined
          ? { estimatedDurationMinutes: body.estimatedDurationMinutes }
          : {}),
        ...(body.basePrice !== undefined ? { basePrice: body.basePrice } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: {
        originCity: { select: { name: true } },
        destinationCity: { select: { name: true } },
        stops: { include: { city: { select: { name: true } } }, orderBy: { position: "asc" as const } },
      },
    });

    await logAudit({
      userId: auth.userId,
      action: body.basePrice !== undefined ? "PRICE_CHANGED" : "ROUTE_UPDATED",
      entity: "Route",
      entityId: id,
      metadata: {
        code: existing.code,
        fields: Object.keys(body),
        ...(body.basePrice !== undefined ? { oldPrice: existing.basePrice, newPrice: body.basePrice } : {}),
      },
      ipAddress: ip,
    });

    return ok({
      id: route.id,
      code: route.code,
      originCityId: route.originCityId,
      originCityName: route.originCity.name,
      destinationCityId: route.destinationCityId,
      destinationCityName: route.destinationCity.name,
      distanceKm: route.distanceKm,
      estimatedDurationMinutes: route.estimatedDurationMinutes,
      basePrice: route.basePrice,
      isActive: route.isActive,
      stops: route.stops.map((s) => ({
        id: s.id,
        cityId: s.cityId,
        cityName: s.city.name,
        position: s.position,
        minutesFromStart: s.minutesFromStart,
      })),
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/routes/[id]");
  }
}
