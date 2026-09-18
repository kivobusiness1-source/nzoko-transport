// PATCH  /api/admin/neighborhoods/[id] — modification (city:manage) → NeighborhoodDTO
// DELETE /api/admin/neighborhoods/[id] — désactivation douce (city:manage)
// V3 — un quartier avec agences rattachées n'est jamais supprimé physiquement.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const patchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.coerce.number().int().min(200).max(20000).optional(),
  isActive: z.boolean().optional(),
});

const listInclude = {
  city: { select: { name: true } },
  _count: { select: { agencies: true } },
} as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "city:manage");
    const { id } = await params;
    const body = patchSchema.parse(await req.json().catch(() => null));

    const existing = await db.neighborhood.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Quartier introuvable.");

    const row = await db.neighborhood
      .update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
          ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
          ...(body.radiusMeters !== undefined ? { radiusMeters: body.radiusMeters } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
        include: listInclude,
      })
      .catch(() => {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Un quartier porte déjà ce nom dans cette ville.");
      });

    await logAudit({
      userId: auth.userId,
      action: "NEIGHBORHOOD_UPDATED",
      entity: "Neighborhood",
      entityId: id,
      metadata: { changes: Object.keys(body) },
      ipAddress: getClientIp(req),
    });

    return ok({
      id: row.id,
      cityId: row.cityId,
      cityName: row.city.name,
      name: row.name,
      slug: row.slug,
      latitude: row.latitude,
      longitude: row.longitude,
      radiusMeters: row.radiusMeters,
      isActive: row.isActive,
      agencyCount: row._count.agencies,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/neighborhoods/[id]");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "city:manage");
    const { id } = await params;

    const existing = await db.neighborhood.findUnique({ where: { id }, include: { _count: { select: { agencies: true } } } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Quartier introuvable.");

    if (existing._count.agencies > 0) {
      // Agences rattachées → désactivation douce (l'historique reste cohérent)
      await db.neighborhood.update({ where: { id }, data: { isActive: false } });
      await logAudit({
        userId: auth.userId,
        action: "NEIGHBORHOOD_DEACTIVATED",
        entity: "Neighborhood",
        entityId: id,
        metadata: { reason: "agencies-attached", agencies: existing._count.agencies },
        ipAddress: getClientIp(req),
      });
      return ok({ deactivated: true, agencies: existing._count.agencies });
    }

    await db.neighborhood.delete({ where: { id } });
    await logAudit({
      userId: auth.userId,
      action: "NEIGHBORHOOD_DELETED",
      entity: "Neighborhood",
      entityId: id,
      ipAddress: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch (err) {
    return routeError(err, "DELETE /api/admin/neighborhoods/[id]");
  }
}
