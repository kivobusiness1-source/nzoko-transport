// GET  /api/admin/users?q — liste des utilisateurs (scope agence pour non-globaux) → UserDTO[]
// POST /api/admin/users — création (user:manage, bcrypt, SUPER_ADMIN réservé) → UserDTO

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

function toUserDTO(u: Prisma.UserGetPayload<{ include: typeof userInclude }>) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: `${u.firstName} ${u.lastName}`,
    phone: u.phone,
    role: u.role.code,
    roleLabel: u.role.name,
    agencyId: u.agencyId,
    agencyName: u.agency?.name ?? null,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

const createSchema = z.object({
  email: z.email("Adresse e-mail invalide."),
  password: z.string().min(8, "Le mot de passe doit contenir au moins 8 caractères."),
  firstName: z.string().trim().min(1, "Prénom requis.").max(60),
  lastName: z.string().trim().min(1, "Nom requis.").max(60),
  role: z.enum(ROLES, "Rôle invalide."),
  agencyId: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(6).max(25).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "user:read");
    const agencyId = resolveAgencyScope(auth);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

    const users = await db.user.findMany({
      where: {
        ...(agencyId ? { agencyId } : {}),
        ...(q
          ? {
              OR: [
                { email: { contains: q } },
                { firstName: { contains: q } },
                { lastName: { contains: q } },
              ],
            }
          : {}),
      },
      include: userInclude,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      // Garde-fou mémoire (audit architecture, point 8) : une flotte
      // d'utilisateurs reste petite — au-delà, utiliser la recherche q.
      take: 500,
    });

    return ok(users.map(toUserDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/users");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "user:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    // SUPER_ADMIN : réservé aux super administrateurs
    if (body.role === "SUPER_ADMIN" && auth.role !== "SUPER_ADMIN") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Seul un super administrateur peut créer ce rôle.");
    }

    // Scope agence : les non-globaux créent DANS leur agence (jamais ailleurs)
    const agencyId = resolveAgencyScope(auth, body.agencyId ?? null);

    const role = await db.role.findUnique({ where: { code: body.role } });
    if (!role) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Rôle inconnu.");

    if (agencyId) {
      const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
      if (!agency) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Agence inconnue.");
    }

    const user = await db.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        firstName: body.firstName,
        lastName: body.lastName,
        roleId: role.id,
        agencyId,
        phone: body.phone ?? null,
      },
      include: userInclude,
    });

    await logAudit({
      userId: auth.userId,
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      metadata: { email: user.email, role: body.role, agencyId },
      ipAddress: ip,
    });

    return ok(toUserDTO(user), 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/users");
  }
}
