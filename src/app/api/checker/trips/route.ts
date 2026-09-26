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
        occupancies: {
          where: { status: "BOOKED" },
          select: { id: true, boardedAt: true, bookingId: true, booking: { select: { ticket: { select: { status: true } } } } },
        },
      },
      orderBy: { departureTime: "asc" },
    });

    // Passagers embarqués PAR PLACE (§24) : occupancy.boardedAt fait foi —
    // fallback héritage (ticket USED) UNIQUEMENT si AUCUNE place de la
    // réservation n'est datée. Comptage en places (1 billet = N places).
    const bookingsWithBoarded = new Set<string>();
    for (const t of trips) {
      for (const o of t.occupancies) {
        if (o.boardedAt !== null) bookingsWithBoarded.add(o.bookingId);
      }
    }
    const boardedByTrip = new Map<string, number>();
    for (const t of trips) {
      let boarded = 0;
      for (const o of t.occupancies) {
        if (o.boardedAt !== null || (o.booking.ticket?.status === "USED" && !bookingsWithBoarded.has(o.bookingId))) {
          boarded++;
        }
      }
      if (boarded > 0) boardedByTrip.set(t.id, boarded);
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
