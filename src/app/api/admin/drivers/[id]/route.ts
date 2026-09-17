// PATCH /api/admin/drivers/[id] — statut / liaison compte / infos (driver:manage ; scope)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { DRIVER_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const driverInclude = {
  agency: { select: { name: true } },
} satisfies Prisma.DriverInclude;

const updateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    phone: z.string().trim().min(6).max(25).nullable().optional(),
    licenseNumber: z.string().trim().min(4).max(30).optional(),
    agencyId: z.string().trim().min(1).optional(),
    status: z.enum(DRIVER_STATUSES, "Statut invalide.").optional(),
    userId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "driver:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const existing = await db.driver.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Chauffeur introuvable.");

    // Scope agence
    resolveAgencyScope(auth, existing.agencyId);
    let targetAgencyId: string | undefined;
    if (body.agencyId !== undefined) {
      const scopeAgencyId = resolveAgencyScope(auth, body.agencyId);
      if (!scopeAgencyId) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Une agence valide est requise.");
      }
      targetAgencyId = scopeAgencyId;
    }

    // Liaison compte : l'utilisateur lié doit exister et avoir le rôle DRIVER
    if (body.userId) {
      const user = await db.user.findUnique({
        where: { id: body.userId },
        include: { role: { select: { code: true } } },
      });
      if (!user) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Utilisateur inconnu.");
      if (user.role.code !== "DRIVER") {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Seul un compte de rôle CHAUFFEUR peut être lié.");
      }
    }

    const data: Prisma.DriverUncheckedUpdateInput = {};
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.licenseNumber !== undefined) data.licenseNumber = body.licenseNumber;
    if (targetAgencyId !== undefined) data.agencyId = targetAgencyId;
    if (body.status !== undefined) data.status = body.status;
    if (body.userId !== undefined) data.userId = body.userId;

    const driver = await db.driver.update({ where: { id }, data, include: driverInclude });

    await logAudit({
      userId: auth.userId,
      action: "DRIVER_UPDATED",
      entity: "Driver",
      entityId: id,
      metadata: {
        driver: `${driver.firstName} ${driver.lastName}`,
        fields: Object.keys(body),
        ...(body.userId !== undefined ? { accountLinked: body.userId ?? null } : {}),
      },
      ipAddress: ip,
    });

    return ok({
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      fullName: `${driver.firstName} ${driver.lastName}`,
      phone: driver.phone,
      licenseNumber: driver.licenseNumber,
      userId: driver.userId,
      agencyId: driver.agencyId,
      agencyName: driver.agency.name,
      status: driver.status,
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/drivers/[id]");
  }
}
