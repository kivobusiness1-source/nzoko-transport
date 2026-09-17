// PATCH /api/admin/cities/[id] — renommage / activation (city:manage) → CityDTO

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const updateSchema = z
  .object({
    name: z.string().trim().min(2, "Nom de ville requis.").max(60).optional(),
    country: z.string().trim().length(2, "Code pays ISO à 2 lettres.").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "city:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const existing = await db.city.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Ville introuvable.");

    const city = await db.city.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.country !== undefined ? { country: body.country.toUpperCase() } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });

    await logAudit({
      userId: auth.userId,
      action: "CITY_UPDATED",
      entity: "City",
      entityId: id,
      metadata: { fields: Object.keys(body) },
      ipAddress: ip,
    });

    return ok({ id: city.id, name: city.name, country: city.country, isActive: city.isActive });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/cities/[id]");
  }
}
