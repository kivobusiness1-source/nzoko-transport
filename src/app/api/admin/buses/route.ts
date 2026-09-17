// GET  /api/admin/buses — parc bus du scope (bus:read) → BusDTO[]
// POST /api/admin/buses — création (bus:manage ; capacity = nb sièges du layout)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { BUS_STATUSES } from "@/lib/constants";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const busInclude = {
  agency: { select: { name: true } },
  seatLayout: { select: { name: true, rows: true, columns: true } },
} satisfies Prisma.BusInclude;

function toBusDTO(b: {
  id: string;
  registrationNumber: string;
  brand: string;
  model: string;
  year: number | null;
  capacity: number;
  status: string;
  agencyId: string;
  seatLayoutId: string;
  agency: { name: string };
  seatLayout: { name: string };
}) {
  return {
    id: b.id,
    registrationNumber: b.registrationNumber,
    brand: b.brand,
    model: b.model,
    year: b.year,
    capacity: b.capacity,
    status: b.status,
    agencyId: b.agencyId,
    agencyName: b.agency.name,
    seatLayoutId: b.seatLayoutId,
    seatLayoutName: b.seatLayout.name,
  };
}

const createSchema = z.object({
  registrationNumber: z.string().trim().min(4, "Immatriculation requise.").max(20),
  brand: z.string().trim().min(2, "Marque requise.").max(40),
  model: z.string().trim().min(1, "Modèle requis.").max(60),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  status: z.enum(BUS_STATUSES, "Statut invalide."),
  agencyId: z.string().trim().min(1, "Agence requise."),
  seatLayoutId: z.string().trim().min(1, "Configuration de sièges requise."),
});

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "bus:read");
    const agencyId = resolveAgencyScope(auth);

    const buses = await db.bus.findMany({
      where: agencyId ? { agencyId } : {},
      include: busInclude,
      orderBy: { registrationNumber: "asc" },
    });
    return ok(buses.map(toBusDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/buses");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "bus:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    // Scope agence : un non-global crée DANS son agence (403 sinon)
    const agencyId = resolveAgencyScope(auth, body.agencyId);
    if (!agencyId) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Une agence est requise pour créer un bus.");
    }

    const [agency, layout] = await Promise.all([
      db.agency.findUnique({ where: { id: agencyId }, select: { id: true, name: true } }),
      db.seatLayout.findUnique({ where: { id: body.seatLayoutId }, include: { seats: { select: { id: true } } } }),
    ]);
    if (!agency) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Agence inconnue.");
    if (!layout) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Configuration de sièges inconnue.");

    const bus = await db.bus.create({
      data: {
        registrationNumber: body.registrationNumber.toUpperCase(),
        brand: body.brand,
        model: body.model,
        year: body.year ?? null,
        capacity: layout.seats.length,
        status: body.status,
        agencyId,
        seatLayoutId: body.seatLayoutId,
      },
      include: busInclude,
    });

    await logAudit({
      userId: auth.userId,
      action: "BUS_CREATED",
      entity: "Bus",
      entityId: bus.id,
      metadata: { registration: bus.registrationNumber, agencyId, capacity: bus.capacity, status: bus.status },
      ipAddress: ip,
    });

    return ok(toBusDTO(bus), 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/buses");
  }
}
