// POST|PUT /api/webhooks/momo — callback officiel MTN MoMo (X-Callback-Url)
// ⚠️ PAS d'auth session NI d'en-tête anti-CSRF : appel émis par la plateforme MTN.
// Le callback MoMo n'est pas signé : il ne fait office que de SIGNAL —
// le statut est systématiquement RE-VÉRIFIÉ auprès de MTN par GET
// (source de vérité unique, jamais sur parole du corps reçu).
// Rate limit 60/min/IP ; idempotent.

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { handleMomoWebhook } from "@/services/payment";

async function process(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    enforceRateLimit(`momo-webhook:${ip}`, RATE_LIMITS.momoWebhook.limit, RATE_LIMITS.momoWebhook.windowMs);

    const rawBody = await req.text();
    const result = await handleMomoWebhook(rawBody, ip);
    return ok(result);
  } catch (err) {
    return routeError(err, "/api/webhooks/momo");
  }
}

export async function POST(req: NextRequest) {
  return process(req);
}

// La doc MTN impose d'accepter PUT en plus de POST sur l'hôte de callback.
export async function PUT(req: NextRequest) {
  return process(req);
}
