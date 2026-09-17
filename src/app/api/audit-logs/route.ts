// GET /api/audit-logs?entity&userId&page — journal d'audit (audit:read), paginé 20/page

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { buildPaginated, parsePagination, queryString } from "@/lib/api-helpers";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "audit:read");

    const { page, pageSize } = parsePagination(req.nextUrl, 20);
    const entity = queryString(req.nextUrl, "entity");
    const userId = queryString(req.nextUrl, "userId");

    const where = {
      ...(entity ? { entity } : {}),
      ...(userId ? { userId } : {}),
    };

    const [total, logs] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = logs.map((l) => ({
      id: l.id,
      userName: l.user ? `${l.user.firstName} ${l.user.lastName}` : null,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
    }));

    return ok(buildPaginated(items, total, page, pageSize));
  } catch (err) {
    return routeError(err, "GET /api/audit-logs");
  }
}
