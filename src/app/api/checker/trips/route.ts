// GET /api/checker/trips — voyages du jour (fuseau Congo) de l'agence → BoardingTripDTO[]
// Statuts SCHEDULED/BOARDING, compteurs sièges vendus / passagers embarqués.

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayRange, todayStr } from "@/lib/dates";

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "trip:read");
    // Agrégats coûteux (full-scan) authentifiés — plafond confort 30/min (ip+user).
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    const agencyId = resolveAgencyScope(auth); // null = toutes les agences (rôles globaux)

    const { start, end } = dayRange(todayStr());
    const trips = await db.trip.findMany({
      where: {
        departureTime: { gte: start, lt: end },
        status: { in: ["SCHEDULED", "BOARDING"] },
        ...(agencyId ? { agencyId } : {}),
      },
      include: {
        route: { include: { originCity: true, destinationCity: true } },
        bus: { include: { seatLayout: { include: { seats: true } } } },
        occupancies: { where: { status: "BOOKED" }, select: { id: true } },
      },
      orderBy: { departureTime: "asc" },
    });

    // Billets embarqués (USED) par voyage — comptage regroupé côté serveur
    const tripIds = trips.map((t) => t.id);
    const usedTickets = tripIds.length
      ? await db.ticket.findMany({
          where: { status: "USED", booking: { tripId: { in: tripIds } } },
          select: { booking: { select: { tripId: true } } },
        })
      : [];
    const boardedByTrip = new Map<string, number>();
    for (const t of usedTickets) {
      boardedByTrip.set(t.booking.tripId, (boardedByTrip.get(t.booking.tripId) ?? 0) + 1);
    }

    const data = trips.map((t) => ({
      id: t.id,
      code: t.code,
      originCityName: t.route.originCity.name,
      destinationCityName: t.route.destinationCity.name,
      departureTime: t.departureTime.toISOString(),
      status: t.status,
      busRegistration: t.bus.registrationNumber,
      totalSeats: t.bus.seatLayout.seats.length,
      boardedCount: boardedByTrip.get(t.id) ?? 0,
      soldCount: t.occupancies.length,
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/checker/trips");
  }
}
