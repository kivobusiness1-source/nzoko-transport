// GET/POST /api/client/favorites — trajets favoris
// GET  : favoris manuels + top 3 des trajets auto-détectés (≥ 2 voyages
//        effectués, non déjà en favori manuel — représentés sans ligne en
//        base : id "originCityId:destinationCityId:auto")
// POST : ajout manuel (doublon protégé par contrainte unique → 409)

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient, myPassengerIds, buildFavoriteRouteDTO } from "@/services/client-space";
import { db } from "@/lib/db";
import type { FavoriteRouteDTO } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { id: true, phone: true } });
    if (!user) return ok<FavoriteRouteDTO[]>([]);

    // Favoris manuels
    const manual = await db.favoriteRoute.findMany({
      where: { userId: user.id, isManual: true },
      orderBy: { createdAt: "desc" },
    });

    // Voyages effectués → paires fréquentes
    const passengerIds = await myPassengerIds(user);
    const pairCounts = new Map<string, number>();
    if (passengerIds.length > 0) {
      const bookings = await db.booking.findMany({
        where: {
          passengerId: { in: passengerIds },
          status: { in: ["CONFIRMED", "COMPLETED"] },
          trip: { departureTime: { lt: new Date() } },
        },
        select: { trip: { select: { route: { select: { originCityId: true, destinationCityId: true } } } } },
      });
      for (const b of bookings) {
        const key = `${b.trip.route.originCityId}:${b.trip.route.destinationCityId}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }

    // Top 3 paires ≥ 2 voyages, hors favoris manuels existants
    const manualKeys = new Set(manual.map((f) => `${f.originCityId}:${f.destinationCityId}`));
    const autoTop = [...pairCounts.entries()]
      .filter(([key, count]) => count >= 2 && !manualKeys.has(key))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const data: FavoriteRouteDTO[] = [
      ...(await Promise.all(
        manual.map((f) =>
          buildFavoriteRouteDTO({
            id: f.id,
            originCityId: f.originCityId,
            destinationCityId: f.destinationCityId,
            isManual: true,
            tripsCount: pairCounts.get(`${f.originCityId}:${f.destinationCityId}`) ?? 0,
          })
        )
      )),
      ...(await Promise.all(
        autoTop.map(([key, count]) => {
          const [originCityId, destinationCityId] = key.split(":");
          return buildFavoriteRouteDTO({
            id: `${originCityId}:${destinationCityId}:auto`,
            originCityId,
            destinationCityId,
            isManual: false,
            tripsCount: count,
          });
        })
      )),
    ];

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/client/favorites");
  }
}

const createSchema = z.object({
  originCityId: z.string().trim().min(1, "Ville de départ requise."),
  destinationCityId: z.string().trim().min(1, "Ville d'arrivée requise."),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    const body = createSchema.parse(await req.json().catch(() => null));

    // Les villes doivent exister (et être distinctes)
    const cities = await db.city.findMany({
      where: { id: { in: [body.originCityId, body.destinationCityId] } },
      select: { id: true },
    });
    if (cities.length < 2 || body.originCityId === body.destinationCityId) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Ville introuvable.");
    }

    try {
      const favorite = await db.favoriteRoute.create({
        data: {
          userId: auth.userId,
          originCityId: body.originCityId,
          destinationCityId: body.destinationCityId,
          isManual: true,
        },
      });

      // Compteur de voyages effectués sur ce trajet
      const user = await db.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, phone: true },
      });
      const passengerIds = user ? await myPassengerIds(user) : [];
      let tripsCount = 0;
      if (passengerIds.length > 0) {
        tripsCount = await db.booking.count({
          where: {
            passengerId: { in: passengerIds },
            status: { in: ["CONFIRMED", "COMPLETED"] },
            trip: {
              departureTime: { lt: new Date() },
              route: { originCityId: body.originCityId, destinationCityId: body.destinationCityId },
            },
          },
        });
      }

      const data = await buildFavoriteRouteDTO({
        id: favorite.id,
        originCityId: favorite.originCityId,
        destinationCityId: favorite.destinationCityId,
        isManual: true,
        tripsCount,
      });
      return ok(data, 201);
    } catch (err) {
      const prismaErr = err as { code?: string };
      if (prismaErr?.code === "P2002") {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce trajet est déjà dans vos favoris.");
      }
      throw err;
    }
  } catch (err) {
    return routeError(err, "POST /api/client/favorites");
  }
}
