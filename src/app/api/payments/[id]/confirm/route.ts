// POST /api/payments/[id]/confirm — confirmation manuelle (production)
// Carte bancaire / virement : après vérification du justificatif reçu,
// un administrateur ou un comptable (permission payment:manage) confirme
// la réception des fonds et déclenche l'émission du billet.
// (Le service journalise PAYMENT_CONFIRMED avec l'auteur.)

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { RATE_LIMITS } from "@/lib/constants";
import { enforceRateLimit } from "@/lib/rate-limit";
import { confirmManualPayment } from "@/services/payment";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const { id } = await params;
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "payment:manage");
    enforceRateLimit(`payment-confirm:${auth.userId}`, RATE_LIMITS.payment.limit, RATE_LIMITS.payment.windowMs);

    const payment = await confirmManualPayment(id, auth.userId, getClientIp(req));
    return ok(payment);
  } catch (err) {
    return routeError(err, "POST /api/payments/[id]/confirm");
  }
}
