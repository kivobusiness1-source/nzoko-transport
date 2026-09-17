// GET /api/client/trips — mes voyages (réservations liées à mon compte :
// passager rattaché OU même téléphone), tri départ DESC. Marque
// hasRated / ratingEligible pour l'évaluation post-voyage.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient, myPassengerIds } from "@/services/client-space";
import { db } from "@/lib/db";
import type { ClientTripDTO } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { id: true, phone: true } });
    if (!user) return ok<ClientTripDTO[]>([]);

    const passengerIds = await myPassengerIds(user);
    if (passengerIds.length === 0) return ok<ClientTripDTO[]>([]);

    const bookings = await db.booking.findMany({
      where: { passengerId: { in: passengerIds } },
      include: {
        trip: { include: { route: { include: { originCity: true, destinationCity: true } }, agency: true, bus: true } },
        seat: true,
      },
      orderBy: { trip: { departureTime: "desc" } },
      take: 200,
    });

    const rated = await db.tripRating.findMany({
      where: { bookingId: { in: bookings.map((b) => b.id) } },
      select: { bookingId: true },
    });
    const ratedIds = new Set(rated.map((r) => r.bookingId));

    const now = Date.now();
    const data: ClientTripDTO[] = bookings.map((b) => {
      const hasRated = ratedIds.has(b.id);
      const arrived =
        (b.status === "COMPLETED" || ["ARRIVED", "COMPLETED"].includes(b.trip.status)) &&
        b.trip.departureTime.getTime() < now;
      return {
        bookingId: b.id,
        bookingReference: b.bookingReference,
        status: b.status as ClientTripDTO["status"],
        originCityName: b.trip.route.originCity.name,
        destinationCityName: b.trip.route.destinationCity.name,
        departureTime: b.trip.departureTime.toISOString(),
        arrivalTime: b.trip.estimatedArrivalTime.toISOString(),
        tripStatus: b.trip.status as ClientTripDTO["tripStatus"],
        agencyName: b.trip.agency.name,
        busRegistration: b.trip.bus.registrationNumber,
        seatNumber: b.seat.seatNumber,
        seatType: b.seat.type as ClientTripDTO["seatType"],
        amount: b.amount,
        hasRated,
        ratingEligible: arrived && !hasRated,
      };
    });

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/client/trips");
  }
}
