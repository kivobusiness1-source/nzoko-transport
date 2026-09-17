// GET  /api/admin/drivers — chauffeurs du scope agence (driver:read) → DriverDTO[]
// POST /api/admin/drivers — création (driver:manage ; scope agence forcé)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const createSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis.").max(60),
  lastName: z.string().trim().min(1, "Nom requis.").max(60),
  phone: z.string().trim().min(6).max(25).optional(),
  licenseNumber: z.string().trim().min(4, "Numéro de permis requis.").max(30),
  agencyId: z.string().trim().min(1, "Agence requise."),
});

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "driver:read");
    const agencyId = resolveAgencyScope(auth);

    const drivers = await db.driver.findMany({
      where: agencyId ? { agencyId } : {},
      include: { agency: { select: { name: true } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    const data = drivers.map((d) => ({
      id: d.id,
      firstName: d.firstName,
      lastName: d.lastName,
      fullName: `${d.firstName} ${d.lastName}`,
      phone: d.phone,
      licenseNumber: d.licenseNumber,
      userId: d.userId,
      agencyId: d.agencyId,
      agencyName: d.agency.name,
      status: d.status,
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/drivers");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "driver:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    // Scope agence : un non-global recrute DANS son agence
    const agencyId = resolveAgencyScope(auth, body.agencyId);
    if (!agencyId) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Une agence est requise pour créer un chauffeur.");
    }

    const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true } });
    if (!agency) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Agence inconnue.");

    const driver = await db.driver.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone ?? null,
        licenseNumber: body.licenseNumber,
        agencyId,
      },
      include: { agency: { select: { name: true } } },
    });

    await logAudit({
      userId: auth.userId,
      action: "DRIVER_CREATED",
      entity: "Driver",
      entityId: driver.id,
      metadata: { name: `${driver.firstName} ${driver.lastName}`, license: driver.licenseNumber, agencyId },
      ipAddress: ip,
    });

    return ok(
      {
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
      },
      201
    );
  } catch (err) {
    return routeError(err, "POST /api/admin/drivers");
  }
}
