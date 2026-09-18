// GET  /api/admin/neighborhoods?cityId — quartiers par ville (city:read) → NeighborhoodDTO[]
// POST /api/admin/neighborhoods — création (city:manage) → NeighborhoodDTO
// V3 — quartier/zone : « Vous êtes probablement à [quartier] » + implantation agences.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { NeighborhoodDTO } from "@/types";

type Row = {
  id: string;
  cityId: string;
  name: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  isActive: boolean;
  createdAt: Date;
  city: { name: string };
  _count: { agencies: number };
};

function toDTO(row: Row): NeighborhoodDTO {
  return {
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
  };
}

const listInclude = {
  city: { select: { name: true } },
  _count: { select: { agencies: true } },
} as const;

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "city:read");
    const cityId = req.nextUrl.searchParams.get("cityId");
    const rows = await db.neighborhood.findMany({
      where: cityId ? { cityId } : undefined,
      include: listInclude,
      orderBy: [{ city: { name: "asc" } }, { name: "asc" }],
    });
    return ok(rows.map(toDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/neighborhoods");
  }
}

const coord = z.coerce.number().min(-90).max(90).nullable().optional();

const createSchema = z.object({
  cityId: z.string().trim().length(25, "Ville invalide."),
  name: z.string().trim().min(2, "Nom du quartier requis.").max(60),
  latitude: coord,
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.coerce.number().int().min(200).max(20000).optional(),
});

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "city:manage");
    const body = createSchema.parse(await req.json().catch(() => null));

    const city = await db.city.findUnique({ where: { id: body.cityId } });
    if (!city) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Ville introuvable.");

    const slug = slugify(body.name);
    const clash = await db.neighborhood.findFirst({ where: { cityId: city.id, slug } });
    if (clash) throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce quartier existe déjà dans cette ville.");

    const row = await db.neighborhood.create({
      data: {
        cityId: city.id,
        name: body.name,
        slug,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        radiusMeters: body.radiusMeters ?? 2500,
      },
      include: listInclude,
    });

    await logAudit({
      userId: auth.userId,
      action: "NEIGHBORHOOD_CREATED",
      entity: "Neighborhood",
      entityId: row.id,
      metadata: { name: row.name, city: city.name },
      ipAddress: getClientIp(req),
    });

    return ok(toDTO(row), 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/neighborhoods");
  }
}
