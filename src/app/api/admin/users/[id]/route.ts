// PATCH /api/admin/users/[id] — modification partielle (user:manage)
// password → re-hash ; désactivation isActive ; interdiction d'auto-désactiver
// son propre compte super-admin ; rôle SUPER_ADMIN réservé aux SUPER_ADMIN.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ROLES } from "@/lib/constants";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const userInclude = {
  role: { select: { code: true, name: true } },
  agency: { select: { id: true, name: true } },
} satisfies Prisma.UserInclude;

const updateSchema = z
  .object({
    email: z.email("Adresse e-mail invalide.").optional(),
    password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères.").optional(),
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    role: z.enum(ROLES, "Rôle invalide.").optional(),
    agencyId: z.string().trim().min(1).nullable().optional(),
    phone: z.string().trim().min(6).max(25).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "user:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const existing = await db.user.findUnique({ where: { id }, include: userInclude });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Utilisateur introuvable.");

    // Scope agence : un non-global ne modifie que les utilisateurs de son agence
    if (auth.role !== "SUPER_ADMIN" && auth.role !== "ADMIN") {
      if (!auth.agencyId || existing.agencyId !== auth.agencyId) {
        throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Accès refusé : cet utilisateur appartient à une autre agence.");
      }
    }

    // Un super admin ne peut pas désactiver son propre compte
    if (
      body.isActive === false &&
      existing.id === auth.userId &&
      existing.role.code === "SUPER_ADMIN"
    ) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Un super administrateur ne peut pas désactiver son propre compte.");
    }

    // Rôle SUPER_ADMIN : réservé aux SUPER_ADMIN
    if (body.role === "SUPER_ADMIN" && auth.role !== "SUPER_ADMIN") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Seul un super administrateur peut attribuer ce rôle.");
    }
    if (body.role && body.role !== existing.role.code) {
      const role = await db.role.findUnique({ where: { code: body.role } });
      if (!role) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Rôle inconnu.");
    }
    // Retrait du rôle SUPER_ADMIN existant : réservé aux SUPER_ADMIN
    if (existing.role.code === "SUPER_ADMIN" && body.role && body.role !== "SUPER_ADMIN" && auth.role !== "SUPER_ADMIN") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Seul un super administrateur peut retirer ce rôle.");
    }

    // Scope agence de la nouvelle affectation
    const agencyId =
      body.agencyId !== undefined ? resolveAgencyScope(auth, body.agencyId ?? null) : undefined;
    if (agencyId) {
      const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
      if (!agency) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Agence inconnue.");
    }

    const data: Prisma.UserUpdateInput = {};
    if (body.email !== undefined) data.email = body.email.toLowerCase();
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.role !== undefined) data.role = { connect: { code: body.role } };
    if (agencyId !== undefined) data.agency = agencyId ? { connect: { id: agencyId } } : { disconnect: {} };
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated = await db.user.update({ where: { id }, data, include: userInclude });

    await logAudit({
      userId: auth.userId,
      action: "USER_UPDATED",
      entity: "User",
      entityId: id,
      metadata: {
        fields: Object.keys(body).filter((k) => k !== "password"),
        passwordChanged: body.password !== undefined,
        deactivated: body.isActive === false,
      },
      ipAddress: ip,
    });

    return ok({
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      fullName: `${updated.firstName} ${updated.lastName}`,
      phone: updated.phone,
      role: updated.role.code,
      roleLabel: updated.role.name,
      agencyId: updated.agencyId,
      agencyName: updated.agency?.name ?? null,
      isActive: updated.isActive,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/users/[id]");
  }
}
