// GET /api/finance/summary?from&to — synthèse financière (finance:read)
// from/to ISO, défaut 30 derniers jours. Scope agence pour les non-globaux.

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { db } from "@/lib/db";
import { congoMonthKey } from "@/lib/api-helpers";

const DEFAULT_DAYS = 30;

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "finance:read");
    // Agrégats coûteux (full-scan) authentifiés — plafond confort 30/min (ip+user).
    enforceRateLimit(`authedRead:${getClientIp(req)}:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"), ["ACCOUNTANT"]);

    const now = new Date();
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");

    const to = toParam && !Number.isNaN(Date.parse(toParam)) ? new Date(toParam) : now;
    const from =
      fromParam && !Number.isNaN(Date.parse(fromParam))
        ? new Date(fromParam)
        : new Date(to.getTime() - DEFAULT_DAYS * 24 * 3600 * 1000);
    if (from > to) {
      throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "La date de début doit précéder la date de fin.");
    }

    const agencyFilter = agencyId ? { agencyId } : {};

    const [incomeTx, expenseRows] = await Promise.all([
      db.transaction.findMany({
        where: { type: "INCOME", createdAt: { gte: from, lte: to }, ...agencyFilter },
        select: { amount: true, createdAt: true, agencyId: true },
      }),
      db.expense.findMany({
        where: { date: { gte: from, lte: to }, ...agencyFilter },
        select: { amount: true, category: true, date: true, agencyId: true },
      }),
    ]);

    const income = incomeTx.reduce((a, t) => a + t.amount, 0);
    const expenses = expenseRows.reduce((a, e) => a + e.amount, 0);

    // --- 6 derniers mois (incluant le mois courant, fuseau Congo) ---
    const monthKeys: string[] = [];
    const cursor = new Date(Date.now() + 3600_000);
    for (let i = 0; i < 6; i++) {
      monthKeys.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCDate(1);
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
    const byMonth = monthKeys
      .slice()
      .reverse()
      .map((month) => ({
        month,
        income: incomeTx.filter((t) => congoMonthKey(t.createdAt) === month).reduce((a, t) => a + t.amount, 0),
        expenses: expenseRows.filter((e) => congoMonthKey(e.date) === month).reduce((a, e) => a + e.amount, 0),
      }));

    // --- Par agence (scope) ---
    const agencies = await db.agency.findMany({
      where: agencyId ? { id: agencyId } : {},
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const byAgency = agencies.map((ag) => ({
      agencyName: ag.name,
      income: incomeTx.filter((t) => t.agencyId === ag.id).reduce((a, t) => a + t.amount, 0),
      expenses: expenseRows.filter((e) => e.agencyId === ag.id).reduce((a, e) => a + e.amount, 0),
    }));

    // --- Par route : revenu des réservations confirmées de la période ---
    const bookings = await db.booking.findMany({
      where: {
        status: { in: ["CONFIRMED", "COMPLETED"] },
        createdAt: { gte: from, lte: to },
        ...(agencyId ? { agencyId } : {}),
      },
      select: {
        amount: true,
        trip: {
          select: {
            route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } },
          },
        },
      },
    });
    const routeAgg = new Map<string, { income: number; bookings: number }>();
    for (const b of bookings) {
      const label = `${b.trip.route.originCity.name} → ${b.trip.route.destinationCity.name}`;
      const cur = routeAgg.get(label) ?? { income: 0, bookings: 0 };
      cur.income += b.amount;
      cur.bookings += 1;
      routeAgg.set(label, cur);
    }
    const byRoute = [...routeAgg.entries()]
      .map(([routeName, v]) => ({ routeName, ...v }))
      .sort((a, b) => b.income - a.income)
      .slice(0, 20);

    // --- Par catégorie de dépense ---
    const categoryAgg = new Map<string, number>();
    for (const e of expenseRows) {
      categoryAgg.set(e.category, (categoryAgg.get(e.category) ?? 0) + e.amount);
    }
    const byCategory = [...categoryAgg.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return ok({
      period: { from: from.toISOString(), to: to.toISOString() },
      income,
      expenses,
      net: income - expenses,
      byMonth,
      byAgency,
      byRoute,
      byCategory,
    });
  } catch (err) {
    return routeError(err, "GET /api/finance/summary");
  }
}
