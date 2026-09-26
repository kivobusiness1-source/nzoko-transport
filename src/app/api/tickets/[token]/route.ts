// GET /api/tickets/[token] — contrat API centrale §17 : consultation d'un
// billet (par token QR, id, ou numéro d'embarquement). Réponse JSON sans PII
// sensible ; le PDF/QR restent sur /api/tickets/[token]/pdf et /qr.

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    enforceRateLimit(`ticket:${getClientIp(req)}`, RATE_LIMITS.bookingDetail.limit, RATE_LIMITS.bookingDetail.windowMs);
    const { token } = await params;
    const raw = decodeURIComponent(token).trim();

    const ticket = await db.ticket.findFirst({
      where: { OR: [{ token: raw }, { id: raw }, { boardingNumber: raw.toUpperCase() }] },
      include: {
        booking: {
          include: {
            trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } },
            seat: true,
            occupancies: { include: { seat: true }, orderBy: { seat: { seatNumber: "asc" } } },
            passenger: true,
            agency: true,
          },
        },
        checkedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!ticket) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Billet introuvable.");

    const b = ticket.booking;
    return ok({
      id: ticket.id,
      token: ticket.token,
      boardingNumber: ticket.boardingNumber,
      status: ticket.status, // VALID | USED | CANCELLED
      issuedAt: ticket.issuedAt.toISOString(),
      checkedAt: ticket.checkedAt?.toISOString() ?? null,
      checkedByName: ticket.checkedBy ? `${ticket.checkedBy.firstName} ${ticket.checkedBy.lastName}` : null,
      booking: {
        id: b.id,
        bookingReference: b.bookingReference,
        status: b.status,
        amount: b.amount,
        seats: (b.occupancies.length > 0
          ? b.occupancies.map((o) => o.seat.seatNumber)
          : [b.seat.seatNumber]
        ).sort(),
        passenger: `${b.passenger.firstName} ${b.passenger.lastName}`,
        trip: {
          id: b.trip.id,
          code: b.trip.code,
          originCityName: b.trip.route.originCity.name,
          destinationCityName: b.trip.route.destinationCity.name,
          departureTime: b.trip.departureTime.toISOString(),
          estimatedArrivalTime: b.trip.estimatedArrivalTime.toISOString(),
          busRegistration: b.trip.bus.registrationNumber,
          status: b.trip.status,
        },
        agencyName: b.agency?.name ?? b.trip.agency.name,
      },
      // Le QR data-URL est chargé à la demande : GET /api/tickets/[token]/qr
      qrUrl: `/api/tickets/${encodeURIComponent(ticket.token)}/qr`,
      pdfUrl: `/api/tickets/${encodeURIComponent(ticket.token)}/pdf`,
    });
  } catch (err) {
    return routeError(err, "GET /api/tickets/[token]");
  }
}
