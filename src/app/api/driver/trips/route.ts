// GET /api/driver/trips — voyages du chauffeur connecté (±fenêtre 2j passé / 7j futur)
// Liste des passagers CONFIRMÉS + embarquement. AUCUNE donnée financière.

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";

import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    // Agrégats coûteux (full-scan) authentifiés — plafond confort 30/min (ip+user).
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    if (auth.role !== "DRIVER") {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux chauffeurs.");
    }

    const driver = await db.driver.findUnique({ where: { userId: auth.userId } });
    if (!driver) {
      throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun profil chauffeur n'est lié à votre compte.");
    }

    const now = new Date();
    const from = new Date(now.getTime() - 2 * 24 * 3600 * 1000);
    const to = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

    const trips = await db.trip.findMany({
      where: { driverId: driver.id, departureTime: { gte: from, lte: to } },
      include: {
        route: { include: { originCity: true, destinationCity: true } },
        bus: true,
        occupancies: {
          where: { booking: { status: "CONFIRMED" } },
          include: {
            seat: true,
            passenger: { select: { firstName: true, lastName: true } },
            booking: {
              select: {
                bookingReference: true,
                dropOffNeighborhood: { select: { name: true } },
                ticket: { select: { status: true } },
                passenger: { select: { firstName: true, lastName: true } },
              },
            },
          },
          orderBy: { seat: { seatNumber: "asc" } },
        },
      },
      orderBy: { departureTime: "asc" },
    });

    const data = trips.map((t) => {
      // Passagers PAR PLACE (§24 — passagers nommés) : chaque place porte SON
      // voyageur. Fallback héritage (ticket USED) UNIQUEMENT si AUCUNE place
      // de la réservation n'est datée (embarquement partiel sinon faussé).
      const bookingsWithBoarded = new Set(
        t.occupancies.filter((o) => o.boardedAt !== null).map((o) => o.bookingId)
      );
      const passengers = t.occupancies.map((o) => {
        // Passager de LA place, à défaut l'acheteur de la réservation.
        const passenger = o.passenger ?? o.booking.passenger;
        return {
          seatNumber: o.seat.seatNumber,
          passengerName: `${passenger.firstName} ${passenger.lastName}`.trim() || "Passager",
          boarded:
            o.boardedAt !== null ||
            (o.booking.ticket?.status === "USED" && !bookingsWithBoarded.has(o.bookingId)),
          reference: o.booking.bookingReference,
          dropOffNeighborhoodName: o.booking.dropOffNeighborhood?.name ?? null,
        };
      });
      return {
        id: t.id,
        code: t.code,
        originCityName: t.route.originCity.name,
        destinationCityName: t.route.destinationCity.name,
        departureTime: t.departureTime.toISOString(),
        estimatedArrivalTime: t.estimatedArrivalTime.toISOString(),
        status: t.status,
        busRegistration: t.bus.registrationNumber,
        busModel: t.bus.model,
        passengers,
        boardedCount: passengers.filter((p) => p.boarded).length,
        soldCount: passengers.length,
      };
    });

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/driver/trips");
  }
}
