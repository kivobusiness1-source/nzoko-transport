// GET /api/client/overview — tableau de bord de l'espace client
// Voyages effectués/à venir, dépenses, durée cumulée, agences, fidélité
// (points/palier/prochain palier), trajet préféré + offre personnalisée
// calculée sur les HABITUDES réelles (aucune donnée inventée).

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { formatDate, formatTime } from "@/lib/format";
import { assertClient, myPassengerIds } from "@/services/client-space";
import { ensureLoyaltyAccount, nextTierForPoints, tierForPoints } from "@/services/loyalty";
import { db } from "@/lib/db";
import type { ClientStatsDTO } from "@/types";
import type { Prisma } from "@prisma/client";

const bookingInclude = {
  trip: { include: { route: { include: { originCity: true, destinationCity: true } }, agency: true } },
  payment: { where: { status: "SUCCESS" } as Prisma.PaymentWhereInput },
} satisfies Prisma.BookingInclude;

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { id: true, phone: true } });
    if (!user) return ok(emptyStats());

    const passengerIds = await myPassengerIds(user);
    if (passengerIds.length === 0) return ok(emptyStats());

    const bookings = await db.booking.findMany({
      where: { passengerId: { in: passengerIds } },
      include: bookingInclude,
    });

    const now = new Date();
    const completed = bookings.filter(
      (b) => ["CONFIRMED", "COMPLETED"].includes(b.status) && b.trip.departureTime < now
    );
    const upcoming = bookings.filter((b) => b.status === "CONFIRMED" && b.trip.departureTime >= now);

    // Dépenses : paiements SUCCESS de TOUTES mes réservations (passées et à venir)
    const totalSpent = bookings.reduce((sum, b) => sum + b.payment.reduce((s, p) => s + p.amount, 0), 0);

    const totalTravelMinutes = completed.reduce((sum, b) => sum + b.trip.route.estimatedDurationMinutes, 0);

    const agenciesUsed = new Set(
      completed.map((b) => b.trip.agencyId).filter((id): id is string => Boolean(id))
    ).size;

    // Trajet préféré : paire de villes la plus fréquente parmi les voyages effectués
    const pairCounts = new Map<string, { count: number; originCityId: string; originCityName: string; destinationCityId: string; destinationCityName: string }>();
    for (const b of completed) {
      const key = `${b.trip.route.originCityId}:${b.trip.route.destinationCityId}`;
      const entry = pairCounts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        pairCounts.set(key, {
          count: 1,
          originCityId: b.trip.route.originCityId,
          originCityName: b.trip.route.originCity.name,
          destinationCityId: b.trip.route.destinationCityId,
          destinationCityName: b.trip.route.destinationCity.name,
        });
      }
    }
    const favorite = [...pairCounts.values()].sort((a, b) => b.count - a.count)[0] ?? null;

    // Fidélité
    const account = await ensureLoyaltyAccount(user.id);

    // Offre personnalisée : prochain départ réel sur le trajet préféré
    let personalizedOffer: ClientStatsDTO["personalizedOffer"] = null;
    if (favorite) {
      const nextTrip = await db.trip.findFirst({
        where: {
          status: "SCHEDULED",
          departureTime: { gte: now },
          route: { originCityId: favorite.originCityId, destinationCityId: favorite.destinationCityId, isActive: true },
        },
        orderBy: { departureTime: "asc" },
        select: { departureTime: true },
      });
      if (nextTrip) {
        personalizedOffer = {
          headline: `Votre trajet préféré ${favorite.originCityName} → ${favorite.destinationCityName}`,
          detail: `Prochain départ : ${formatDate(nextTrip.departureTime)} à ${formatTime(nextTrip.departureTime)} — réservez en priorité.`,
        };
      }
    }

    const data: ClientStatsDTO = {
      tripsCompleted: completed.length,
      tripsUpcoming: upcoming.length,
      totalSpent,
      totalTravelMinutes,
      agenciesUsed,
      pointsBalance: account.pointsBalance,
      lifetimePoints: account.lifetimePoints,
      tier: tierForPoints(account.lifetimePoints),
      nextTier: nextTierForPoints(account.lifetimePoints),
      favoriteRoute: favorite
        ? {
            originCityId: favorite.originCityId,
            originCityName: favorite.originCityName,
            destinationCityId: favorite.destinationCityId,
            destinationCityName: favorite.destinationCityName,
            tripsCount: favorite.count,
          }
        : null,
      personalizedOffer,
    };
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/client/overview");
  }
}

function emptyStats(): ClientStatsDTO {
  return {
    tripsCompleted: 0,
    tripsUpcoming: 0,
    totalSpent: 0,
    totalTravelMinutes: 0,
    agenciesUsed: 0,
    pointsBalance: 0,
    lifetimePoints: 0,
    tier: "BRONZE",
    nextTier: { key: "SILVER", label: "ONC Silver", pointsRemaining: 1000 },
    favoriteRoute: null,
    personalizedOffer: null,
  };
}
