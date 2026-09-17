// GET  /api/admin/routes — routes avec arrêts ordonnés (route:read) → RouteDTO[]
// POST /api/admin/routes — création (route:manage ; origin≠destination ; code auto) → RouteDTO

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { generateRouteCode } from "@/lib/security";
import { db } from "@/lib/db";

const routeInclude = {
  originCity: { select: { id: true, name: true } },
  destinationCity: { select: { id: true, name: true } },
  stops: { include: { city: { select: { name: true } } }, orderBy: { position: "asc" as const } },
};

const createSchema = z.object({
  originCityId: z.string().trim().min(1, "Ville d'origine requise."),
  destinationCityId: z.string().trim().min(1, "Ville de destination requise."),
  distanceKm: z.number().int("Distance entière requise.").positive("La distance doit être positive."),
  estimatedDurationMinutes: z.number().int().positive("La durée doit être positive."),
  basePrice: z.number().int("Montant entier XAF requis.").min(0, "Le prix de base ne peut pas être négatif."),
  stops: z
    .array(
      z.object({
        cityId: z.string().trim().min(1, "Arrêt : ville requise."),
        minutesFromStart: z.number().int().min(1, "Arrêt : minutes depuis le départ requises."),
      })
    )
    .max(20)
    .optional()
    .default([]),
});

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "route:read");

    const routes = await db.route.findMany({
      include: routeInclude,
      orderBy: [{ originCity: { name: "asc" } }, { destinationCity: { name: "asc" } }],
    });

    const data = routes.map((r) => ({
      id: r.id,
      code: r.code,
      originCityId: r.originCityId,
      originCityName: r.originCity.name,
      destinationCityId: r.destinationCityId,
      destinationCityName: r.destinationCity.name,
      distanceKm: r.distanceKm,
      estimatedDurationMinutes: r.estimatedDurationMinutes,
      basePrice: r.basePrice,
      isActive: r.isActive,
      stops: r.stops.map((s) => ({
        id: s.id,
        cityId: s.cityId,
        cityName: s.city.name,
        position: s.position,
        minutesFromStart: s.minutesFromStart,
      })),
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/routes");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "route:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    if (body.originCityId === body.destinationCityId) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "L'origine et la destination doivent être différentes.");
    }

    const [origin, destination] = await Promise.all([
      db.city.findUnique({ where: { id: body.originCityId } }),
      db.city.findUnique({ where: { id: body.destinationCityId } }),
    ]);
    if (!origin || !destination) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Ville d'origine ou de destination inconnue.");
    }

    // Les villes d'arrêt doivent exister et être distinctes des extrémités
    const stopCityIds = [...new Set(body.stops.map((s) => s.cityId))];
    const stopCities = await db.city.findMany({ where: { id: { in: stopCityIds } }, select: { id: true, name: true } });
    if (stopCities.length !== stopCityIds.length) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Un arrêt référence une ville inconnue.");
    }

    const route = await db.$transaction(async (tx) => {
      const created = await tx.route.create({
        data: {
          code: generateRouteCode(origin.name, destination.name),
          originCityId: body.originCityId,
          destinationCityId: body.destinationCityId,
          distanceKm: body.distanceKm,
          estimatedDurationMinutes: body.estimatedDurationMinutes,
          basePrice: body.basePrice,
        },
      });
      // Positions automatiques 0..n dans l'ordre fourni
      for (let i = 0; i < body.stops.length; i++) {
        await tx.routeStop.create({
          data: {
            routeId: created.id,
            cityId: body.stops[i].cityId,
            position: i,
            minutesFromStart: body.stops[i].minutesFromStart,
          },
        });
      }
      return tx.route.findUnique({ where: { id: created.id }, include: routeInclude });
    });

    // findUnique est théoriquement nullable — en pratique impossible ici
    // (création immédiatement suivie de la relecture), mais on garde un
    // échec explicite plutôt qu'une assertion non-null.
    if (!route) {
      throw new ApiError(500, ERROR_CODES.INTERNAL, "Création de la ligne impossible — relancez.");
    }

    await logAudit({
      userId: auth.userId,
      action: "ROUTE_CREATED",
      entity: "Route",
      entityId: route.id,
      metadata: { code: route.code, distanceKm: body.distanceKm, basePrice: body.basePrice, stops: body.stops.length },
      ipAddress: ip,
    });

    return ok(
      {
        id: route.id,
        code: route.code,
        originCityId: route.originCityId,
        originCityName: route.originCity.name,
        destinationCityId: route.destinationCityId,
        destinationCityName: route.destinationCity.name,
        distanceKm: route.distanceKm,
        estimatedDurationMinutes: route.estimatedDurationMinutes,
        basePrice: route.basePrice,
        isActive: route.isActive,
        stops: route.stops.map((s) => ({
          id: s.id,
          cityId: s.cityId,
          cityName: s.city.name,
          position: s.position,
          minutesFromStart: s.minutesFromStart,
        })),
      },
      201
    );
  } catch (err) {
    return routeError(err, "POST /api/admin/routes");
  }
}
