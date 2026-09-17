// GET /api/security-logs?event&page — journal de sécurité (security:read), paginé 20/page
// details JSON converti en chaîne lisible.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { buildPaginated, parsePagination, queryString, detailsToReadableString } from "@/lib/api-helpers";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "security:read");

    const { page, pageSize } = parsePagination(req.nextUrl, 20);
    const event = queryString(req.nextUrl, "event");

    const where = event ? { event } : {};

    const [total, logs] = await Promise.all([
      db.securityLog.count({ where }),
      db.securityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = logs.map((l) => ({
      id: l.id,
      email: l.email,
      event: l.event,
      ipAddress: l.ipAddress,
      details: detailsToReadableString(l.details),
      createdAt: l.createdAt.toISOString(),
    }));

    return ok(buildPaginated(items, total, page, pageSize));
  } catch (err) {
    return routeError(err, "GET /api/security-logs");
  }
}
