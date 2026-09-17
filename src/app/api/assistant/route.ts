// POST /api/assistant — Assistant IA (questions voyages, promotions, tarifs).
// Public : rate limit 10/min/IP + CSRF même-origine (assertSameOriginPost).
// Les réponses sont ancrées sur les données réelles de la base
// (anti-hallucination) — voir src/services/assistant.ts.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { askAssistant } from "@/services/assistant";

const bodySchema = z.object({
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "Identifiant de session invalide.")
    .optional(),
  message: z
    .string()
    .trim()
    .min(1, "Posez votre question.")
    .max(500, "Message trop long (500 caractères maximum)."),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    enforceRateLimit(`assistant:${ip}`, RATE_LIMITS.assistant.limit, RATE_LIMITS.assistant.windowMs);

    const input = bodySchema.parse(await req.json().catch(() => null));
    const result = await askAssistant({ sessionId: input.sessionId, message: input.message, ip });
    return ok(result);
  } catch (err) {
    return routeError(err, "POST /api/assistant");
  }
}
