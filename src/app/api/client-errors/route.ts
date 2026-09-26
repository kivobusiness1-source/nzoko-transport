import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginPost, getClientIp, getUserAgent } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";

// ============================================================
// OCÉAN DU NORD — POST /api/client-errors
// Télémétrie des erreurs navigateur (cf. src/lib/client-telemetry.ts) :
// le journal part dans dev.log (développement) / stdout (Vercel).
// CONTRAT : répond TOUJOURS 204 silencieux — même en cas de rejet
// (payload invalide, rate limit, CSRF) : la télémétrie ne doit jamais
// remonter une erreur visible côté client, ni devenir une charge.
// Incident d'origine (Task 31) : un plantage d'affichage côté client
// ne laissait AUCUNE trace côté serveur alors que toutes les API
// répondaient 200.
// ============================================================

const PayloadSchema = z.object({
  kind: z.enum(["render", "chunk", "uncaught", "rejection"]),
  context: z.string().min(1).max(100),
  message: z.string().min(1).max(600),
  stack: z.string().max(2000).optional(),
  componentStack: z.string().max(2000).optional(),
  attempts: z.number().int().min(0).max(99).optional(),
  extra: z.string().max(400).optional(),
});

// Journal serveur = raison d'être de cette route : console.log est
// ici volontaire (format grep-pable dans dev.log / stdout Vercel).
/* eslint-disable no-console */

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOriginPost(req);

    // Anti-spam : 20 rapports/min/IP (largement au-dessus du rythme
    // d'une vraie erreur + auto-reload, assez bas pour un spam réseau).
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`client-errors:${ip}`, 20, 60_000);
    if (!allowed) return new NextResponse(null, { status: 204 });

    const raw: unknown = await req.json().catch(() => null);
    const parsed = PayloadSchema.safeParse(raw);
    if (parsed.success) {
      const { kind, context, message, stack, componentStack, attempts, extra } = parsed.data;
      console.log(`[CLIENT-ERROR] ${kind} | context=${context} | t${attempts ?? 0} | ${getUserAgent(req)}`);
      console.log(`  message: ${message}`);
      if (stack) console.log(`  stack: ${stack}`);
      if (componentStack) console.log(`  componentStack: ${componentStack}`);
      if (extra) console.log(`  extra: ${extra}`);
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    // CSRF / JSON cassé / toute erreur : silencieux.
    return new NextResponse(null, { status: 204 });
  }
}
