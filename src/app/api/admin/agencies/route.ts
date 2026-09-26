// GET  /api/admin/agencies — agences avec ville (agency:read) → AgencyDTO[]
// POST /api/admin/agencies — création (agency:manage, code unique) → AgencyDTO

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const agencyInclude = { city: { select: { id: true, name: true } } };

function toAgencyDTO(a: { id: string; code: string; name: string; cityId: string; address: string | null; phone: string | null; email: string | null; isActive: boolean; city: { name: string } }) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    cityId: a.cityId,
    cityName: a.city.name,
    address: a.address,
    phone: a.phone,
    email: a.email,
    isActive: a.isActive,
  };
}

const createSchema = z.object({
  code: z.string().trim().min(2, "Code agence requis.").max(12).regex(/^[A-Za-z0-9-]+$/, "Code invalide (alphanumérique)."),
  name: z.string().trim().min(2, "Nom de l'agence requis.").max(80),
  cityId: z.string().trim().min(1, "Ville requise."),
  address: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().min(6).max(25).optional(),
  email: z.email("Adresse e-mail invalide.").optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "agency:read");
    // « Pas de mélanges » : un rôle d'agence (chef d'agence, agent,…) ne
    // voit QUE son agence (les sélecteurs d'agence des formulaires aussi).
    const agencyId = resolveAgencyScope(auth);
    const agencies = await db.agency.findMany({
      where: agencyId ? { id: agencyId } : {},
      include: agencyInclude,
      orderBy: { name: "asc" },
    });
    return ok(agencies.map(toAgencyDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/agencies");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "agency:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const city = await db.city.findUnique({ where: { id: body.cityId } });
    if (!city) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Ville inconnue.");

    const agency = await db.agency.create({
      data: {
        code: body.code.toUpperCase(),
        name: body.name,
        cityId: body.cityId,
        address: body.address ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
      },
      include: agencyInclude,
    });

    await logAudit({
      userId: auth.userId,
      action: "AGENCY_CREATED",
      entity: "Agency",
      entityId: agency.id,
      metadata: { code: agency.code, name: agency.name, cityId: agency.cityId },
      ipAddress: ip,
    });

    return ok(toAgencyDTO(agency), 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/agencies");
  }
}
