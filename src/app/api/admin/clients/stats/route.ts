// GET /api/admin/clients/stats — tableau de bord fidélité & clients
// Accès : SUPER_ADMIN, ADMIN. Population, points, paliers, réclamations
// ouvertes, demandes en attente, moyenne des évaluations + par ligne.

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, INACTIVE_CLIENT_DAYS } from "@/lib/constants";
import { loadAdminClientRows } from "@/services/admin-clients";
import { db } from "@/lib/db";
import type { AdminLoyaltyStatsDTO } from "@/types";
import type { LoyaltyTier } from "@/lib/constants";

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    if (!["SUPER_ADMIN", "ADMIN"].includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé aux administrateurs.");
    }
    enforceRateLimit(`adminRead:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const rows = await loadAdminClientRows();
    const now = Date.now();
    const activeCutoff = now - INACTIVE_CLIENT_DAYS * 86_400_000;

    let activeClients = 0;
    let inactiveClients = 0;
    let pointsOutstanding = 0;
    let pointsIssued = 0;
    const tierCounts: Record<LoyaltyTier, number> = { BRONZE: 0, SILVER: 0, GOLD: 0, VIP: 0 };

    for (const r of rows) {
      pointsOutstanding += r.pointsBalance;
      pointsIssued += r.lifetimePoints;
      tierCounts[r.tier] += 1;
      if (r.lastTripAt && r.lastTripAt.getTime() >= activeCutoff) activeClients += 1;
      else if (
        (r.lastTripAt !== null && r.lastTripAt.getTime() < activeCutoff) ||
        (r.lastTripAt === null && r.createdAt.getTime() < activeCutoff)
      ) {
        inactiveClients += 1;
      }
    }

    const [openComplaints, pendingRedemptions, ratings] = await Promise.all([
      db.complaint.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      db.redemptionRequest.count({ where: { status: "PENDING" } }),
      db.tripRating.findMany({
        select: {
          average: true,
          trip: { select: { routeId: true, route: { select: { originCity: { select: { name: true } }, destinationCity: { select: { name: true } } } } } },
        },
      }),
    ]);

    // Moyennes d'évaluation : globale + par ligne
    const byRoute = new Map<string, { routeId: string; routeLabel: string; sum: number; count: number }>();
    let globalSum = 0;
    for (const r of ratings) {
      globalSum += r.average;
      const label = `${r.trip.route.originCity.name} → ${r.trip.route.destinationCity.name}`;
      const entry = byRoute.get(r.trip.routeId);
      if (entry) {
        entry.sum += r.average;
        entry.count += 1;
      } else {
        byRoute.set(r.trip.routeId, { routeId: r.trip.routeId, routeLabel: label, sum: r.average, count: 1 });
      }
    }

    const data: AdminLoyaltyStatsDTO = {
      totalClients: rows.length,
      activeClients,
      inactiveClients,
      pointsOutstanding,
      pointsIssued,
      tierCounts,
      openComplaints,
      pendingRedemptions,
      averageRating: ratings.length > 0 ? Math.round((globalSum / ratings.length) * 10) / 10 : null,
      ratingCount: ratings.length,
      ratingsByRoute: [...byRoute.values()]
        .map((e) => ({
          routeId: e.routeId,
          routeLabel: e.routeLabel,
          average: Math.round((e.sum / e.count) * 10) / 10,
          count: e.count,
        }))
        .sort((a, b) => b.count - a.count),
    };
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/clients/stats");
  }
}
