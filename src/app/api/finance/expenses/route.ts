// GET  /api/finance/expenses?agencyId&category — dépenses du scope (expense:read) → ExpenseDTO[]
// POST /api/finance/expenses — création (expense:manage) + Transaction EXPENSE liée

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { EXPENSE_CATEGORIES } from "@/lib/constants";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const expenseInclude = {
  agency: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  trip: { select: { code: true } },
} satisfies Prisma.ExpenseInclude;

function toExpenseDTO(e: Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>) {
  return {
    id: e.id,
    category: e.category,
    amount: e.amount,
    description: e.description,
    agencyId: e.agencyId,
    agencyName: e.agency?.name ?? null,
    tripId: e.tripId,
    createdByName: e.createdBy ? `${e.createdBy.firstName} ${e.createdBy.lastName}` : null,
    date: e.date.toISOString(),
  };
}

const categorySchema = z.enum(EXPENSE_CATEGORIES).optional();

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "expense:read");
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"), ["ACCOUNTANT"]);
    const category = categorySchema.parse(
      req.nextUrl.searchParams.get("category") ?? undefined
    );

    const expenses = await db.expense.findMany({
      where: {
        ...(agencyId ? { agencyId } : {}),
        ...(category ? { category } : {}),
      },
      include: expenseInclude,
      orderBy: { date: "desc" },
      take: 200,
    });

    return ok(expenses.map(toExpenseDTO));
  } catch (err) {
    return routeError(err, "GET /api/finance/expenses");
  }
}

const createSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, "Catégorie invalide."),
  amount: z.number().int("Montant entier XAF requis.").positive("Le montant doit être positif."),
  description: z.string().trim().min(3, "Description requise.").max(200),
  agencyId: z.string().trim().min(1).nullable().optional(),
  tripId: z.string().trim().min(1).nullable().optional(),
  date: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Date invalide.")
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "expense:manage");
    const body = createSchema.parse(await req.json().catch(() => null));
    const ip = getClientIp(req);

    // Scope agence : un non-global impute DANS son agence
    const agencyId = resolveAgencyScope(auth, body.agencyId ?? null, ["ACCOUNTANT"]);

    if (agencyId) {
      const agency = await db.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
      if (!agency) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Agence inconnue.");
    }
    if (body.tripId) {
      const trip = await db.trip.findUnique({ where: { id: body.tripId }, select: { id: true, agencyId: true } });
      if (!trip) throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Voyage inconnu.");
      if (agencyId && trip.agencyId !== agencyId) {
        throw new ApiError(400, ERROR_CODES.BAD_REQUEST, "Le voyage n'appartient pas à l'agence sélectionnée.");
      }
    }

    const date = body.date ? new Date(body.date) : new Date();

    const expense = await db.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          category: body.category,
          amount: body.amount,
          description: body.description,
          agencyId,
          tripId: body.tripId ?? null,
          createdById: auth.userId,
          date,
        },
        include: expenseInclude,
      });

      // Écriture comptable liée (référence = id de la dépense)
      await tx.transaction.create({
        data: {
          type: "EXPENSE",
          amount: body.amount,
          reference: created.id,
          description: `Dépense ${body.category} — ${body.description}`.slice(0, 200),
          agencyId,
          createdById: auth.userId,
        },
      });

      return created;
    });

    await logAudit({
      userId: auth.userId,
      action: "EXPENSE_CREATED",
      entity: "Expense",
      entityId: expense.id,
      metadata: { category: body.category, amount: body.amount, agencyId, tripId: body.tripId ?? null },
      ipAddress: ip,
    });

    return ok(toExpenseDTO(expense), 201);
  } catch (err) {
    return routeError(err, "POST /api/finance/expenses");
  }
}
