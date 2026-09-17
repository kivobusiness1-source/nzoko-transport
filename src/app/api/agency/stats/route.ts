// GET /api/agency/stats — tableau de bord agence → AgencyStatsDTO
// Scope : rôles globaux → ?agencyId optionnel (sinon consolidé) ; autres → leur agence.

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayRange, todayStr, addDaysStr } from "@/lib/dates";
import { lastDaysStr } from "@/lib/api-helpers";
import { toTripSearchDTO, toBookingDTO } from "@/services/booking";

const SERIES_DAYS = 14;

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "stats:agency");
    // Agrégats coûteux (full-scan) authentifiés — plafond confort 30/min (ip+user).
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"));

    const now = new Date();
    const today = dayRange(todayStr());
    const monthStart = dayRange(`${todayStr().slice(0, 7)}-01`).start;
    const seriesStart = dayRange(addDaysStr(todayStr(), -(SERIES_DAYS - 1))).start;

    const agencyFilter = agencyId ? { agencyId } : {};
    const bookingAgencyFilter = agencyId ? { agencyId } : {};

    // --- Agrégats revenus (SUM SQL — audit architecture, point 8) ---
    // KPI jour/mois en aggregate SQL indexé ; seule la série 14j reste en
    // findMany borné (nécessaire point par point pour le graphique).
    const [todayAgg, monthAgg, seriesTx] = await Promise.all([
      db.transaction.aggregate({
        _sum: { amount: true },
        where: { type: "INCOME", createdAt: { gte: today.start, lt: today.end }, ...agencyFilter },
      }),
      db.transaction.aggregate({
        _sum: { amount: true },
        where: { type: "INCOME", createdAt: { gte: monthStart, lte: now }, ...agencyFilter },
      }),
      db.transaction.findMany({
        where: { type: "INCOME", createdAt: { gte: seriesStart, lte: now }, ...agencyFilter },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const salesToday = todayAgg._sum.amount ?? 0;
    const revenueMonth = monthAgg._sum.amount ?? 0;

    const seriesDays = lastDaysStr(SERIES_DAYS);
    const salesSeries = seriesDays.map((date) => {
      const { start, end } = dayRange(date);
      return {
        date,
        amount: seriesTx
          .filter((t) => t.createdAt >= start && t.createdAt < end)
          .reduce((a, t) => a + t.amount, 0),
      };
    });

    // --- Compteurs du jour ---
    const [bookingsToday, tripsToday, passengersToday, boardedToday, pendingPayments] = await Promise.all([
      db.booking.count({ where: { createdAt: { gte: today.start, lt: today.end }, ...bookingAgencyFilter } }),
      db.trip.count({ where: { departureTime: { gte: today.start, lt: today.end }, ...agencyFilter } }),
      db.booking.count({
        where: {
          status: { in: ["CONFIRMED", "COMPLETED"] },
          trip: { departureTime: { gte: today.start, lt: today.end }, ...agencyFilter },
        },
      }),
      db.ticket.count({
        where: {
          status: "USED",
          checkedAt: { gte: today.start, lt: today.end },
          booking: { trip: { ...agencyFilter } },
        },
      }),
      db.payment.count({
        where: { status: "PENDING", ...(agencyId ? { booking: { agencyId } } : {}) },
      }),
    ]);

    // --- Départs à venir (avec disponibilités réelles) ---
    const upcoming = await db.trip.findMany({
      where: { departureTime: { gte: now }, status: { in: ["SCHEDULED", "BOARDING"] }, ...agencyFilter },
      include: {
        route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
        bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
        agency: true,
        occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
      },
      orderBy: { departureTime: "asc" },
      take: 10,
    });
    const upcomingDepartures = upcoming.map((t) =>
      toTripSearchDTO(t, t.bus.seatLayout.seats.length, t.occupancies.length)
    );

    // --- Dernières ventes ---
    const recent = await db.booking.findMany({
      where: bookingAgencyFilter,
      include: {
        trip: { include: { route: { include: { originCity: true, destinationCity: true } }, bus: true, agency: true } },
        seat: true,
        passenger: true,
        agency: true,
        createdBy: true,
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    return ok({
      kpis: {
        salesToday,
        bookingsToday,
        tripsToday,
        passengersToday,
        boardedToday,
        revenueMonth,
        pendingPayments,
      },
      salesSeries,
      upcomingDepartures,
      recentSales: recent.map(toBookingDTO),
    });
  } catch (err) {
    return routeError(err, "GET /api/agency/stats");
  }
}
