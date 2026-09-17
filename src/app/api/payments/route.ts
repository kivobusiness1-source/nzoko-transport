// POST /api/payments — initie un paiement pour une réservation PENDING → PaymentDTO
// Public (l'acteur connecté, s'il existe, est journalisé comme créateur).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS, PAYMENT_PROVIDERS } from "@/lib/constants";
import { createPayment } from "@/services/payment";

const paySchema = z.object({
  bookingId: z.string().trim().min(1, "Réservation requise."),
  provider: z.enum(PAYMENT_PROVIDERS, "Mode de paiement invalide."),
  momoPhone: z
    .string()
    .trim()
    .regex(/^(\+|00|\d)[\d\s.-]+$/, "Numéro Mobile Money invalide.")
    .optional(),
  senderName: z.string().trim().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    enforceRateLimit(`payment:${ip}`, RATE_LIMITS.payment.limit, RATE_LIMITS.payment.windowMs);

    const input = paySchema.parse(await req.json().catch(() => null));
    const auth = await getAuth(req); // optionnel

    const payment = await createPayment(input, {
      actorUserId: auth?.userId ?? null,
      ip,
    });
    return ok(payment, 201);
  } catch (err) {
    return routeError(err, "POST /api/payments");
  }
}
