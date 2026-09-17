// GET /api/admin/complaints?status=&q= — file de traitement des réclamations
// Accès : SUPER_ADMIN, ADMIN, SUPPORT (c'est leur métier).
// Filtres : statut, recherche libre (référence/sujet/client).

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, COMPLAINT_STATUSES } from "@/lib/constants";
import { toAdminComplaintDTO, adminComplaintInclude } from "@/services/client-space";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN", "SUPPORT"];

export async function GET(req: NextRequest) {
  try {
    const auth = assertAuthenticated(await getAuth(req));
    if (!ALLOWED_ROLES.includes(auth.role)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Cet espace est réservé au support et à l'administration.");
    }
    enforceRateLimit(`adminRead:${auth.userId}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);

    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const q = req.nextUrl.searchParams.get("q")?.trim() ?? undefined;

    const where: Prisma.ComplaintWhereInput = {
      ...(status && COMPLAINT_STATUSES.includes(status as (typeof COMPLAINT_STATUSES)[number])
        ? { status }
        : {}),
      ...(q
        ? {
            OR: [
              { reference: { contains: q.toUpperCase() } },
              { subject: { contains: q } },
              { message: { contains: q } },
              { user: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } },
            ],
          }
        : {}),
    };

    const complaints = await db.complaint.findMany({
      where,
      include: adminComplaintInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return ok(complaints.map(toAdminComplaintDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/complaints");
  }
}
