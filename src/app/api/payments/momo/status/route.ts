// POST /api/payments/momo/status — suivi du paiement MTN MoMo (Request to Pay)
// Public (rate limit 15/min/IP) : le paymentId est un identifiant non prédictible.
// Idempotent : statut final → simple relecture ; SUCCESSFUL → confirmation
// + émission billet via le cœur existant (jamais sur parole du client —
// le statut est TOUJOURS re-vérifié auprès de MTN par GET).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { pollMomoPaymentStatus } from "@/services/payment";

const statusSchema = z.object({
  paymentId: z.string().trim().min(1, "Paiement requis."),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    enforceRateLimit(`momo-status:${ip}`, RATE_LIMITS.momoStatus.limit, RATE_LIMITS.momoStatus.windowMs);

    const input = statusSchema.parse(await req.json().catch(() => null));
    const auth = await getAuth(req); // optionnel — journalisé si présent

    const payment = await pollMomoPaymentStatus(input.paymentId, {
      actorUserId: auth?.userId ?? null,
      ip,
    });
    return ok(payment);
  } catch (err) {
    return routeError(err, "POST /api/payments/momo/status");
  }
}
