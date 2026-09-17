// GET /api/client/spending — historique de dépenses du client
// Paiements SUCCESS via MES réservations : mois courant, année, total,
// et la série mensuelle des 12 derniers mois (clé "2026-01", fuseau Congo).

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient, myPassengerIds } from "@/services/client-space";
import { congoMonthKey } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import type { SpendingDTO } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId }, select: { id: true, phone: true } });
    if (!user) return ok(emptySpending());

    const passengerIds = await myPassengerIds(user);
    if (passengerIds.length === 0) return ok(emptySpending());

    const payments = await db.payment.findMany({
      where: { booking: { passengerId: { in: passengerIds } }, status: "SUCCESS" },
      select: { amount: true, createdAt: true },
    });

    const now = new Date();
    const currentMonth = congoMonthKey(now);
    const currentYear = currentMonth.slice(0, 4);

    const byMonth = new Map<string, number>();
    let total = 0;
    for (const p of payments) {
      total += p.amount;
      const key = congoMonthKey(p.createdAt);
      byMonth.set(key, (byMonth.get(key) ?? 0) + p.amount);
    }

    // 12 derniers mois au fuseau Congo, du plus ancien au plus récent
    const congoNow = new Date(now.getTime() + 3600_000);
    const year = congoNow.getUTCFullYear();
    const month = congoNow.getUTCMonth(); // 0-11
    const monthly: { month: string; amount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      let mm = month - i;
      let yy = year;
      while (mm < 0) {
        mm += 12;
        yy -= 1;
      }
      const key = `${yy}-${String(mm + 1).padStart(2, "0")}`;
      monthly.push({ month: key, amount: byMonth.get(key) ?? 0 });
    }

    const data: SpendingDTO = {
      thisMonth: byMonth.get(currentMonth) ?? 0,
      thisYear: [...byMonth.entries()]
        .filter(([k]) => k.slice(0, 4) === currentYear)
        .reduce((s, [, v]) => s + v, 0),
      total,
      monthly,
    };
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/client/spending");
  }
}

function emptySpending(): SpendingDTO {
  return { thisMonth: 0, thisYear: 0, total: 0, monthly: [] };
}
