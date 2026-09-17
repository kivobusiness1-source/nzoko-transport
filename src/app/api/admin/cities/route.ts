// GET  /api/admin/cities — TOUTES les villes, y compris inactives (city:read) → CityDTO[]
// POST /api/admin/cities — création (city:manage, code pays ISO par défaut CG) → CityDTO

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const createSchema = z.object({
  name: z.string().trim().min(2, "Nom de ville requis.").max(60),
  country: z
    .string()
    .trim()
    .length(2, "Code pays ISO à 2 lettres.")
    .transform((s) => s.toUpperCase())
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "city:read");

    const cities = await db.city.findMany({
      orderBy: [{ country: "asc" }, { name: "asc" }],
      select: { id: true, name: true, country: true, isActive: true },
    });
    return ok(cities);
  } catch (err) {
    return routeError(err, "GET /api/admin/cities");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "city:manage");
    const body = createSchema.parse(await req.json().catch(() => null));

    const city = await db.city.create({
      data: {
        name: body.name,
        country: body.country ?? "CG",
      },
    });

    await logAudit({
      userId: auth.userId,
      action: "CITY_CREATED",
      entity: "City",
      entityId: city.id,
      metadata: { name: city.name, country: city.country },
      ipAddress: getClientIp(req),
    });

    return ok({ id: city.id, name: city.name, country: city.country, isActive: city.isActive }, 201);
  } catch (err) {
    return routeError(err, "POST /api/admin/cities");
  }
}
