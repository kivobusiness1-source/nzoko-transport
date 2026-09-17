// POST /api/payments/[id]/confirm-cash — encaissement espèces au guichet
// Auth + permission payment:cash-collect. (Le service journalise PAYMENT_CONFIRMED.)

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { confirmCashPayment } from "@/services/payment";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "payment:cash-collect");

    const payment = await confirmCashPayment(id, auth.userId, getClientIp(req));
    return ok(payment);
  } catch (err) {
    return routeError(err, "POST /api/payments/[id]/confirm-cash");
  }
}
