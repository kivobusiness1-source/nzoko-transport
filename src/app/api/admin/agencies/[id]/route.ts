// PATCH /api/admin/agencies/[id] — modification (agency:manage) → AgencyDTO

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const updateSchema = z
  .object({
    code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9-]+$/, "Code invalide (alphanumérique).").optional(),
    name: z.string().trim().min(2).max(80).optional(),
    cityId: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).max(160).nullable().optional(),
    phone: z.string().trim().min(6).max(25).nullable().optional(),
    email: z.email("Adresse e-mail invalide.").nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "agency:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const existing = await db.agency.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Agence introuvable.");

    if (body.cityId) {
      const city = await db.city.findUnique({ where: { id: body.cityId }, select: { id: true } });
      if (!city) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Ville inconnue.");
    }

    const agency = await db.agency.update({
      where: { id },
      data: {
        ...(body.code !== undefined ? { code: body.code.toUpperCase() } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.cityId !== undefined ? { cityId: body.cityId } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: { city: { select: { name: true } } },
    });

    await logAudit({
      userId: auth.userId,
      action: "AGENCY_UPDATED",
      entity: "Agency",
      entityId: id,
      metadata: { fields: Object.keys(body) },
      ipAddress: ip,
    });

    return ok({
      id: agency.id,
      code: agency.code,
      name: agency.name,
      cityId: agency.cityId,
      cityName: agency.city.name,
      address: agency.address,
      phone: agency.phone,
      email: agency.email,
      isActive: agency.isActive,
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/agencies/[id]");
  }
}
