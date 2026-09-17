// DELETE /api/finance/expenses/[id] — supprime la dépense ET sa Transaction liée (reference=id)

import { NextRequest } from "next/server";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "expense:manage");
    const ip = getClientIp(req);

    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Dépense introuvable.");

    // Scope agence : un non-global ne supprime que les dépenses de son agence
    resolveAgencyScope(auth,  expense.agencyId, ["ACCOUNTANT"]);

    await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { reference: id, type: "EXPENSE" } });
      await tx.expense.delete({ where: { id } });
    });

    await logAudit({
      userId: auth.userId,
      action: "EXPENSE_DELETED",
      entity: "Expense",
      entityId: id,
      metadata: { category: expense.category, amount: expense.amount, agencyId: expense.agencyId },
      ipAddress: ip,
    });

    return ok(true);
  } catch (err) {
    return routeError(err, "DELETE /api/finance/expenses/[id]");
  }
}
