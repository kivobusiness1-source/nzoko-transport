// GET /api/admin/roles — rôles et permissions (triées) → RoleDTO[]

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    assertPermission(assertAuthenticated(await getAuth(req)), "role:read");

    const roles = await db.role.findMany({
      include: { permissions: { include: { permission: { select: { code: true } } } } },
      orderBy: { code: "asc" },
    });

    const data = roles.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      permissions: r.permissions
        .map((rp) => rp.permission.code)
        .sort((a, b) => a.localeCompare(b)),
    }));

    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/admin/roles");
  }
}
