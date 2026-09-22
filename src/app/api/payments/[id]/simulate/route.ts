// POST /api/payments/[id]/simulate — mode DÉMO : simule le callback du fournisseur
// Uniquement si PAYMENTS_SIMULATION=true (sinon le service refuse avec 403).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { simulateProviderConfirmation } from "@/services/payment";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const payment = await simulateProviderConfirmation(id, getClientIp(req));
    return ok(payment);
  } catch (err) {
    return routeError(err, "POST /api/payments/[id]/simulate");
  }
}
