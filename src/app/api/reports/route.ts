// GET /api/reports?type&from&to&agencyId&format=json|csv — rapports agrégés (report:read)
// daily|weekly|monthly|agency|bus|route — JSON (ReportDTO) ou CSV (BOM UTF-8, attachment).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { dayRange, todayStr } from "@/lib/dates";
import { congoDayKey, congoMonthKey } from "@/lib/api-helpers";
import { db } from "@/lib/db";

const typeSchema = z.enum(["daily", "weekly", "monthly", "agency", "bus", "route", "city", "agent"]);

function frDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Lundi (UTC+1) de la semaine contenant la date. */
function weekKey(d: Date): string {
  const shifted = new Date(d.getTime() + 3600_000); // fuseau Congo
  const day = shifted.getUTCDay(); // 0 = dimanche
  const diff = day === 0 ? 6 : day - 1;
  shifted.setUTCDate(shifted.getUTCDate() - diff);
  return shifted.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "report:read");
    // Agrégats coûteux (full-scan) authentifiés — plafond confort 30/min (ip+user).
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    const agencyScope = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"), ["ACCOUNTANT"]);

    const type = typeSchema.parse(req.nextUrl.searchParams.get("type") ?? "daily");
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";

    // Bornes de période : défauts selon le type de rapport
    const now = new Date();
    let from: Date;
    let to: Date;
    if (fromParam && toParam && !Number.isNaN(Date.parse(fromParam)) && !Number.isNaN(Date.parse(toParam))) {
      from = new Date(fromParam);
      to = new Date(toParam);
    } else {
      const today = todayStr();
      if (type === "daily") {
        from = dayRange(today).start;
        to = dayRange(today).end;
      } else if (type === "weekly") {
        from = dayRange(today).start;
        from = new Date(from.getTime() - 6 * 24 * 3600 * 1000);
        to = dayRange(today).end;
      } else if (type === "monthly") {
        from = dayRange(`${today.slice(0, 7)}-01`).start;
        to = now;
      } else {
        from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        to = now;
      }
    }
    if (from > to) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "La date de début doit précéder la date de fin.");
    }

    const agencyFilter = agencyScope ? { agencyId: agencyScope } : {};

    // Réservations CONFIRMÉES de la période (revenu au montant figé)
    const bookings = await db.booking.findMany({
      where: {
        status: { in: ["CONFIRMED", "COMPLETED"] },
        createdAt: { gte: from, lte: to },
        ...agencyFilter,
      },
      select: {
        amount: true,
        createdAt: true,
        agency: { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        trip: {
          select: {
            bus: { select: { registrationNumber: true } },
            route: {
              select: {
                originCity: { select: { name: true } },
                destinationCity: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    // Dépenses de la période
    const expenses = await db.expense.findMany({
      where: { date: { gte: from, lte: to }, ...agencyFilter },
      select: { amount: true, date: true, agency: { select: { name: true } } },
    });

    const bookingLabel = (b: (typeof bookings)[number]) =>
      `${b.trip.route.originCity.name} → ${b.trip.route.destinationCity.name}`;

    // Agrégation par ligne selon le type
    const agg = new Map<string, { bookings: number; revenue: number; expenses: number }>();
    const bump = (label: string, b: { bookings?: number; revenue?: number; expenses?: number }) => {
      const cur = agg.get(label) ?? { bookings: 0, revenue: 0, expenses: 0 };
      cur.bookings += b.bookings ?? 0;
      cur.revenue += b.revenue ?? 0;
      cur.expenses += b.expenses ?? 0;
      agg.set(label, cur);
    };

    if (type === "daily") {
      for (const b of bookings) bump(congoDayKey(b.createdAt), { bookings: 1, revenue: b.amount });
      for (const e of expenses) bump(congoDayKey(e.date), { expenses: e.amount });
    } else if (type === "weekly") {
      for (const b of bookings) bump(weekKey(b.createdAt), { bookings: 1, revenue: b.amount });
      for (const e of expenses) bump(weekKey(e.date), { expenses: e.amount });
    } else if (type === "monthly") {
      for (const b of bookings) bump(congoMonthKey(b.createdAt), { bookings: 1, revenue: b.amount });
      for (const e of expenses) bump(congoMonthKey(e.date), { expenses: e.amount });
    } else if (type === "agency") {
      for (const b of bookings) bump(b.agency?.name ?? "Sans agence", { bookings: 1, revenue: b.amount });
      for (const e of expenses) bump(e.agency?.name ?? "Sans agence", { expenses: e.amount });
    } else if (type === "city") {
      // V3 — par ville de DÉPART du voyage
      for (const b of bookings) bump(b.trip.route.originCity.name, { bookings: 1, revenue: b.amount });
    } else if (type === "agent") {
      // V3 — par vendeur : agent guichet ou canal site web
      for (const b of bookings) {
        const label = b.createdBy ? `${b.createdBy.firstName} ${b.createdBy.lastName}` : "Site web";
        bump(label, { bookings: 1, revenue: b.amount });
      }
    } else if (type === "bus") {
      for (const b of bookings) bump(b.trip.bus.registrationNumber, { bookings: 1, revenue: b.amount });
    } else {
      for (const b of bookings) bump(bookingLabel(b), { bookings: 1, revenue: b.amount });
    }

    const rows = [...agg.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const totalBookings = rows.reduce((a, r) => a + r.bookings, 0);
    const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0);
    const totalExpenses = rows.reduce((a, r) => a + r.expenses, 0);

    const periodLabel =
      type === "daily"
        ? `Journée du ${frDate(congoDayKey(from))}`
        : type === "weekly"
          ? `Semaine du ${frDate(congoDayKey(from))} au ${frDate(congoDayKey(to))}`
          : type === "monthly"
            ? `Mois de ${congoMonthKey(from)}`
            : `Du ${frDate(congoDayKey(from))} au ${frDate(congoDayKey(to))}`;

    const report = {
      type,
      period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel },
      totalBookings,
      totalRevenue,
      totalExpenses,
      netResult: totalRevenue - totalExpenses,
      rows,
    };

    if (format === "csv") {
      const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const lines = ["label,bookings,revenue,expenses"];
      for (const r of rows) {
        lines.push(`${esc(r.label)},${r.bookings},${r.revenue},${r.expenses}`);
      }
      const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ocean-du-nord-rapport-${type}.csv"`,
        },
      });
    }

    return ok(report);
  } catch (err) {
    return routeError(err, "GET /api/reports");
  }
}
