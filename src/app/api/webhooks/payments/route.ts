// POST /api/webhooks/payments — callback fournisseur (HMAC X-Nzoko-Signature)
// ⚠️ PAS d'auth session NI d'en-tête anti-CSRF : l'authenticité vient de la
// signature HMAC-SHA256 du corps brut avec WEBHOOK_SECRET. Idempotent.

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { handlePaymentWebhook } from "@/services/payment";

export async function POST(req: NextRequest) {
  try {
    // Anti brute-force de la signature HMAC (tentatives avant d'atteindre
    // le hmacSha256 = délai + journalisation) — plafond généreux 60/min/IP.
    enforceRateLimit("webhookPayments:" + getClientIp(req), RATE_LIMITS.webhookPayments.limit, RATE_LIMITS.webhookPayments.windowMs);
    const rawBody = await req.text();
    const signature = req.headers.get("X-Nzoko-Signature") ?? req.headers.get("x-nzoko-signature");
    const ip = getClientIp(req);

    const result = await handlePaymentWebhook(rawBody, signature, ip);
    return ok(result);
  } catch (err) {
    return routeError(err, "POST /api/webhooks/payments");
  }
}
