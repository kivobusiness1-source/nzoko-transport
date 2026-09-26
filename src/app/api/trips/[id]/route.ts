// GET /api/trips/[id] — contrat API centrale §17 : détail public d'un voyage.
// (Les places se consultent via GET /api/trips/[id]/seats — §6.)

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import { releaseExpiredHolds } from "@/services/booking";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    enforceRateLimit(`trip:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    await releaseExpiredHolds();
    const { id } = await params;
    const now = new Date();
    const trip = await db.trip.findUnique({
      where: { id },
      include: {
        route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
        bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
        agency: { include: { city: true } },
        occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
      },
    });
    if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
    const total = trip.bus.seatLayout.seats.length;
    return ok({
      id: trip.id,
      code: trip.code,
      originCity: { id: trip.route.originCity.id, name: trip.route.originCity.name },
      destinationCity: { id: trip.route.destinationCity.id, name: trip.route.destinationCity.name },
      stops: trip.route.stops.map((s) => ({ cityName: s.city.name, minutesFromStart: s.minutesFromStart })),
      departureTime: trip.departureTime.toISOString(),
      estimatedArrivalTime: trip.estimatedArrivalTime.toISOString(),
      price: trip.price,
      status: trip.status,
      bus: {
        id: trip.bus.id,
        registrationNumber: trip.bus.registrationNumber,
        brand: trip.bus.brand,
        model: trip.bus.model,
        capacity: trip.bus.capacity,
      },
      agency: {
        id: trip.agency.id,
        code: trip.agency.code,
        name: trip.agency.name,
        cityName: trip.agency.city.name,
      },
      totalSeats: total,
      availableSeats: Math.max(0, total - trip.occupancies.length),
      reservable: ["SCHEDULED", "BOARDING"].includes(trip.status) && trip.departureTime > now,
    });
  } catch (err) {
    return routeError(err, "GET /api/trips/[id]");
  }
}
