// ============================================================
// NZOKO TRANSPORT — Vue publique des agences
// Calcule les places réellement disponibles par agence sur les
// 7 prochains jours (voyages SCHEDULED/BOARDING, verrous inclus).
// ============================================================

import { db } from "@/lib/db";
import { releaseExpiredHolds } from "@/services/booking";
import type { AgencyOverviewDTO } from "@/types";

const OVERVIEW_DAYS = 7;

export async function getAgenciesOverview(): Promise<AgencyOverviewDTO[]> {
  await releaseExpiredHolds();

  const now = new Date();
  const horizon = new Date(now.getTime() + OVERVIEW_DAYS * 24 * 3600 * 1000);

  const [agencies, trips] = await Promise.all([
    db.agency.findMany({
      where: { isActive: true },
      include: { city: { select: { name: true } } },
      orderBy: [{ city: { name: "asc" } }, { name: "asc" }],
    }),
    db.trip.findMany({
      where: {
        departureTime: { gt: now, lte: horizon },
        status: { in: ["SCHEDULED", "BOARDING"] },
      },
      include: {
        route: { include: { destinationCity: { select: { name: true } } } },
        bus: { include: { seatLayout: { include: { seats: { select: { id: true } } } } } },
        occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] }, select: { id: true } },
      },
      orderBy: { departureTime: "asc" },
    }),
  ]);

  return agencies.map((agency) => {
    const agencyTrips = trips.filter((t) => t.agencyId === agency.id);
    const availableSeats = agencyTrips.reduce(
      (sum, t) => sum + Math.max(0, t.bus.seatLayout.seats.length - t.occupancies.length),
      0
    );
    const next = agencyTrips[0];
    const prices = agencyTrips.map((t) => t.price);
    return {
      id: agency.id,
      code: agency.code,
      name: agency.name,
      cityName: agency.city.name,
      address: agency.address,
      phone: agency.phone,
      imageUrl: agency.imageUrl,
      availableSeats,
      upcomingTrips: agencyTrips.length,
      nextDeparture: next
        ? {
            departureTime: next.departureTime.toISOString(),
            destinationCityName: next.route.destinationCity.name,
            availableSeats: Math.max(0, next.bus.seatLayout.seats.length - next.occupancies.length),
            price: next.price,
          }
        : null,
      priceFrom: prices.length > 0 ? Math.min(...prices) : null,
    };
  });
}
