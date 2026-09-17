// PATCH /api/admin/buses/[id] — modification (bus:manage ; scope agence)
// Si seatLayoutId change → capacity recalculée depuis le nouveau layout.

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
  seatLayout: { select: { name: true } },
} satisfies Prisma.BusInclude;

const updateSchema = z
  .object({
    registrationNumber: z.string().trim().min(4).max(20).optional(),
    brand: z.string().trim().min(2).max(40).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    year: z.number().int().min(1990).max(new Date().getFullYear() + 1).nullable().optional(),
    status: z.enum(BUS_STATUSES, "Statut invalide.").optional(),
    agencyId: z.string().trim().min(1).optional(),
    seatLayoutId: z.string().trim().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Aucune modification fournie." });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "bus:manage");
    const body = updateSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    const existing = await db.bus.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Bus introuvable.");

    // Scope agence : un non-global ne touche que les bus de son agence
    resolveAgencyScope(auth, existing.agencyId);

    let targetAgencyId: string | undefined;
    if (body.agencyId !== undefined) {
      const scopeAgencyId = resolveAgencyScope(auth, body.agencyId);
      if (!scopeAgencyId) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Une agence valide est requise.");
      }
      targetAgencyId = scopeAgencyId;
    }

    let capacity: number | undefined;
    if (body.seatLayoutId && body.seatLayoutId !== existing.seatLayoutId) {
      const layout = await db.seatLayout.findUnique({
        where: { id: body.seatLayoutId },
        include: { seats: { select: { id: true } } },
      });
      if (!layout) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Configuration de sièges inconnue.");
      capacity = layout.seats.length;
    }

    const data: Prisma.BusUncheckedUpdateInput = {};
    if (body.registrationNumber !== undefined) data.registrationNumber = body.registrationNumber.toUpperCase();
    if (body.brand !== undefined) data.brand = body.brand;
    if (body.model !== undefined) data.model = body.model;
    if (body.year !== undefined) data.year = body.year;
    if (body.status !== undefined) data.status = body.status;
    if (targetAgencyId !== undefined) data.agencyId = targetAgencyId;
    if (body.seatLayoutId !== undefined) data.seatLayoutId = body.seatLayoutId;
    if (capacity !== undefined) data.capacity = capacity;

    const bus = await db.bus.update({ where: { id }, data, include: busInclude });

    await logAudit({
      userId: auth.userId,
      action: "BUS_UPDATED",
      entity: "Bus",
      entityId: id,
      metadata: {
        registration: existing.registrationNumber,
        fields: Object.keys(body),
        ...(capacity !== undefined ? { capacityRecalculated: capacity } : {}),
      },
      ipAddress: ip,
    });

    return ok({
      id: bus.id,
      registrationNumber: bus.registrationNumber,
      brand: bus.brand,
      model: bus.model,
      year: bus.year,
      capacity: bus.capacity,
      status: bus.status,
      agencyId: bus.agencyId,
      agencyName: bus.agency.name,
      seatLayoutId: bus.seatLayoutId,
      seatLayoutName: bus.seatLayout.name,
    });
  } catch (err) {
    return routeError(err, "PATCH /api/admin/buses/[id]");
  }
}
