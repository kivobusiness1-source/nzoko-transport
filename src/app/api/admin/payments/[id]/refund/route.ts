// POST /api/admin/payments/[id]/refund — initier un remboursement (payment:manage)
//   Modes : MOMO_REFUND (Refund API MTN, paiement MoMo d'origine),
//           MOMO_TRANSFER (envoi de fonds vers un MSISDN),
//           CASH (espèces — finalisation immédiate).
// GET  /api/admin/payments/[id]/refund — suivre le remboursement asynchrone MoMo
//   (poll GET /disbursement/v1_0/{refund|transfer}/{referenceId}) et finaliser
//   (Payment REFUNDED + Transaction REFUND) le cas échéant.
// Rate limit 10/min/IP ; journalisé (REFUND_INITIATED/CONFIRMED/FAILED).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { initiatePaymentRefund, pollPaymentRefundStatus } from "@/services/payment";

const refundSchema = z.object({
  mode: z.enum(["MOMO_REFUND", "MOMO_TRANSFER", "CASH"], "Mode de remboursement invalide."),
  amount: z.number().int().positive().optional(),
  msisdn: z
    .string()
    .trim()
    .regex(/^(\+|00|\d)[\d\s.-]+$/, "Numéro Mobile Money invalide.")
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "payment:manage");
    const ip = getClientIp(req);
    enforceRateLimit(`refund:${ip}:${auth.userId}`, RATE_LIMITS.refund.limit, RATE_LIMITS.refund.windowMs);

    const { id } = await params;
    const input = refundSchema.parse(await req.json().catch(() => null));

    const payment = await initiatePaymentRefund(id, input, {
      userId: auth.userId,
      userName: `${auth.sessionUser.firstName} ${auth.sessionUser.lastName}`.trim(),
      ip,
    });
    return ok(payment);
  } catch (err) {
    return routeError(err, "POST /api/admin/payments/[id]/refund");
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "payment:manage");
    const ip = getClientIp(req);
    enforceRateLimit(`refund:${ip}:${auth.userId}`, RATE_LIMITS.refund.limit, RATE_LIMITS.refund.windowMs);

    const { id } = await params;
    const payment = await pollPaymentRefundStatus(id, {
      userId: auth.userId,
      ip,
    });
    return ok(payment);
  } catch (err) {
    return routeError(err, "GET /api/admin/payments/[id]/refund");
  }
}
