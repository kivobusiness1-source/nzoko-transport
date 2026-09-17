// GET /api/admin/stats?days — tableau de bord global/agence → AdminStatsDTO
// Permission : stats:global OU stats:agency. Les rôles non globaux ne voient
// QUE les données de leur agence (filtre agencyId appliqué partout).

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayRange, todayStr } from "@/lib/dates";
import { lastDaysStr, resolveStatsScope } from "@/lib/api-helpers";
import { toTripSearchDTO, toBookingDTO } from "@/services/booking";
import { toPaymentDTO } from "@/services/payment-mappers";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    // Agrégats coûteux (full-scan) authentifiés — plafond confort 30/min (ip+user).
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    if (!auth.permissions.includes("stats:global") && !auth.permissions.includes("stats:agency")) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Vous n'avez pas accès aux statistiques.");
    }

    const scope = resolveStatsScope(auth, req.nextUrl.searchParams.get("agencyId"), () => {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Aucune agence n'est associée à votre compte.");
    });

    const daysRaw = Number(req.nextUrl.searchParams.get("days"));
    const days = Number.isFinite(daysRaw) && daysRaw >= 1 ? Math.min(90, Math.floor(daysRaw)) : 14;

    const now = new Date();
    const today = dayRange(todayStr());
    const monthStart = dayRange(`${todayStr().slice(0, 7)}-01`).start;
    const seriesDays = lastDaysStr(days);
    const windowStart = dayRange(seriesDays[0]).start;
    const weekAhead = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const dayAhead = new Date(now.getTime() + 24 * 3600 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000);

    const agencyFilter = scope ? { agencyId: scope } : {};
    const bookingAgencyFilter = scope ? { agencyId: scope } : {};
    const paymentScopeFilter = scope ? { booking: { agencyId: scope } } : {};

    // ---------- Agrégats revenus (SUM SQL — audit architecture, point 8) ----------
    // KPI jour/mois en aggregate SQL ; la série journalière ET le revenu par
    // agence partagent le MÊME findMany borné à la fenêtre (l'ancienne version
    // rechargeait toutes les transactions depuis le début du mois en mémoire).
    const [todayAgg, monthAgg, seriesTx, windowBookings] = await Promise.all([
      db.transaction.aggregate({
        _sum: { amount: true },
        where: { type: "INCOME", createdAt: { gte: today.start, lt: today.end }, ...agencyFilter },
      }),
      db.transaction.aggregate({
        _sum: { amount: true },
        where: { type: "INCOME", createdAt: { gte: monthStart, lte: now }, ...agencyFilter },
      }),
      db.transaction.findMany({
        where: { type: "INCOME", createdAt: { gte: windowStart, lte: now }, ...agencyFilter },
        select: { agencyId: true, amount: true, createdAt: true },
      }),
      db.booking.findMany({
        where: { createdAt: { gte: windowStart, lte: now }, ...bookingAgencyFilter },
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
          agencyId: true,
          trip: { select: { routeId: true, route: { select: { code: true, originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
        },
      }),
    ]);

    const revenueToday = todayAgg._sum.amount ?? 0;
    const revenueMonth = monthAgg._sum.amount ?? 0;

    const revenueSeries = seriesDays.map((date) => {
      const { start, end } = dayRange(date);
      return {
        date,
        amount: seriesTx
          .filter((t) => t.createdAt >= start && t.createdAt < end)
          .reduce((a, t) => a + t.amount, 0),
      };
    });
    const bookingsSeries = seriesDays.map((date) => {
      const { start, end } = dayRange(date);
      return {
        date,
        count: windowBookings.filter((b) => b.createdAt >= start && b.createdAt < end).length,
      };
    });

    // ---------- KPIs ----------
    const [bookingsToday, activeTrips, activeBuses, pendingPayments, expiringBookings] = await Promise.all([
      db.booking.count({ where: { createdAt: { gte: today.start, lt: today.end }, ...bookingAgencyFilter } }),
      db.trip.count({ where: { status: { in: ["SCHEDULED", "BOARDING"] }, departureTime: { gte: now }, ...agencyFilter } }),
      db.bus.count({ where: { status: "ACTIVE", ...agencyFilter } }),
      db.payment.count({ where: { status: "PENDING", ...paymentScopeFilter } }),
      db.booking.count({ where: { status: "PENDING", expiresAt: { gt: now }, ...bookingAgencyFilter } }),
    ]);

    // ---------- Taux d'occupation : voyages futurs à 7 jours ----------
    // _count filtré SQL (pas de matérialisation des ids d'occupations).
    const futureTrips = await db.trip.findMany({
      where: {
        departureTime: { gte: now, lte: weekAhead },
        status: { in: ["SCHEDULED", "BOARDING"] },
        ...agencyFilter,
      },
      select: {
        bus: { select: { capacity: true, agencyId: true } },
        _count: { select: { occupancies: { where: { status: "BOOKED" } } } },
      },
    });
    const totalFutureSeats = futureTrips.reduce((a, t) => a + t.bus.capacity, 0);
    const soldFutureSeats = futureTrips.reduce((a, t) => a + t._count.occupancies, 0);
    const occupancyRate = totalFutureSeats > 0 ? Math.round((soldFutureSeats / totalFutureSeats) * 100) : 0;

    // ---------- Performance par agence ----------
    const agencies = await db.agency.findMany({
      where: { ...(scope ? { id: scope } : {}), isActive: true },
      select: { id: true, name: true },
    });
    // Les transactions INCOME de la fenêtre (seriesTx) portent agencyId →
    // revenu par agence SANS seconde requête (réutilise le findUnique ci-dessus) :
    const performance = agencies.map((ag) => {
      const revenue = seriesTx
        .filter((t) => t.agencyId === ag.id)
        .reduce((a, t) => a + t.amount, 0);
      const bookings = windowBookings.filter((b) => b.agencyId === ag.id).length;
      const ft = futureTrips.filter((t) => t.bus.agencyId === ag.id);
      const total = ft.reduce((a, t) => a + t.bus.capacity, 0);
      const sold = ft.reduce((a, t) => a + t._count.occupancies, 0);
      return {
        agencyId: ag.id,
        agencyName: ag.name,
        revenue,
        bookings,
        occupancy: total > 0 ? Math.round((sold / total) * 100) : 0,
      };
    });

    // ---------- Top routes (5) sur la fenêtre ----------
    const routeAgg = new Map<string, { bookings: number; revenue: number }>();
    for (const b of windowBookings) {
      if (b.status !== "CONFIRMED" && b.status !== "COMPLETED") continue;
      const label = `${b.trip.route.originCity.name} → ${b.trip.route.destinationCity.name}`;
      const cur = routeAgg.get(label) ?? { bookings: 0, revenue: 0 };
      cur.bookings += 1;
      cur.revenue += b.amount;
      routeAgg.set(label, cur);
    }
    const topRoutes = [...routeAgg.entries()]
      .map(([route, v]) => ({ route, ...v }))
      .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
      .slice(0, 5);

    // ---------- Activité récente ----------
    const [recentBookingsRaw, recentPaymentsRaw, upcomingRaw] = await Promise.all([
      db.booking.findMany({
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
      }),
      db.payment.findMany({
        where: paymentScopeFilter,
        include: { createdBy: true, booking: { include: { passenger: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.trip.findMany({
        where: { departureTime: { gte: now }, status: { in: ["SCHEDULED", "BOARDING"] }, ...agencyFilter },
        include: {
          route: { include: { originCity: true, destinationCity: true, stops: { include: { city: true }, orderBy: { position: "asc" } } } },
          bus: { include: { seatLayout: { include: { seats: true } }, agency: true } },
          agency: true,
          occupancies: { where: { OR: [{ status: "BOOKED" }, { status: "HELD", expiresAt: { gt: now } }] } },
        },
        orderBy: { departureTime: "asc" },
        take: 5,
      }),
    ]);

    const recentPayments = recentPaymentsRaw.map((p) => ({
      ...toPaymentDTO(p),
      passengerName:
        p.booking.passenger.firstName || p.booking.passenger.lastName
          ? `${p.booking.passenger.firstName} ${p.booking.passenger.lastName}`.trim()
          : undefined,
    }));

    // ---------- Alertes opérationnelles ----------
    const [maintenanceBuses, stalePendingPayments, unassignedTrips] = await Promise.all([
      db.bus.count({ where: { status: "MAINTENANCE", ...agencyFilter } }),
      db.payment.count({ where: { status: "PENDING", createdAt: { lt: twoHoursAgo }, ...paymentScopeFilter } }),
      db.trip.count({
        where: {
          driverId: null,
          departureTime: { gte: now, lte: dayAhead },
          status: { in: ["SCHEDULED", "BOARDING"] },
          ...agencyFilter,
        },
      }),
    ]);

    const alerts: { level: "WARNING" | "ALERT" | "INFO"; message: string }[] = [];
    if (maintenanceBuses > 0) {
      alerts.push({ level: "WARNING", message: `${maintenanceBuses} bus en maintenance.` });
    }
    if (stalePendingPayments > 0) {
      alerts.push({
        level: "ALERT",
        message: `${stalePendingPayments} paiement(s) en attente depuis plus de 2 heures.`,
      });
    }
    if (unassignedTrips > 0) {
      alerts.push({
        level: "ALERT",
        message: `${unassignedTrips} voyage(s) dans les 24 h sans chauffeur assigné.`,
      });
    }
    if (pendingPayments > 0) {
      alerts.push({ level: "INFO", message: `${pendingPayments} paiement(s) en attente de confirmation.` });
    }

    return ok({
      kpis: {
        bookingsToday,
        revenueToday,
        revenueMonth,
        activeTrips,
        activeBuses,
        occupancyRate,
        pendingPayments,
        expiringBookings,
      },
      revenueSeries,
      bookingsSeries,
      agencyPerformance: performance,
      topRoutes,
      recentBookings: recentBookingsRaw.map(toBookingDTO),
      recentPayments,
      upcomingTrips: upcomingRaw.map((t) =>
        toTripSearchDTO(t, t.bus.seatLayout.seats.length, t.occupancies.length)
      ),
      alerts,
    });
  } catch (err) {
    return routeError(err, "GET /api/admin/stats");
  }
}
