// GET /api/finance/transactions?type&agencyId&page — journal comptable (transaction:read)
// Paginé (20/page), scope agence pour les non-globaux.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { buildPaginated, parsePagination, queryString } from "@/lib/api-helpers";
import { TRANSACTION_TYPES } from "@/lib/constants";
import { db } from "@/lib/db";

const typeSchema = z.enum(TRANSACTION_TYPES).optional();

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "transaction:read");
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"), ["ACCOUNTANT"]);

    const { page, pageSize } = parsePagination(req.nextUrl, 20);
    const type = typeSchema.parse(queryString(req.nextUrl, "type"));

    const where = {
      ...(agencyId ? { agencyId } : {}),
      ...(type ? { type } : {}),
    };

    const [total, transactions] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        include: {
          agency: { select: { name: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      reference: t.reference,
      description: t.description,
      agencyName: t.agency?.name ?? null,
      createdByName: t.createdBy ? `${t.createdBy.firstName} ${t.createdBy.lastName}` : null,
      paymentId: t.paymentId,
      createdAt: t.createdAt.toISOString(),
    }));

    return ok(buildPaginated(items, total, page, pageSize));
  } catch (err) {
    return routeError(err, "GET /api/finance/transactions");
  }
}
