// POST /api/checker/scan — contrôle d'embarquement par QR/référence → ScanResultDTO
// Auth + permission checker:scan + rate limit. Transition atomique VALID→USED.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { GLOBAL_ROLES, RATE_LIMITS } from "@/lib/constants";
import { scanAndBoard } from "@/services/tickets";

const scanSchema = z.object({
  code: z.string().min(1, "Code de billet requis.").max(120),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "checker:scan");
    const ip = getClientIp(req);
    enforceRateLimit(`checker:${ip}:${auth.userId}`, RATE_LIMITS.checker.limit, RATE_LIMITS.checker.windowMs);

    const { code } = scanSchema.parse(await req.json().catch(() => null));

    const result = await scanAndBoard(code, {
      checkerUserId: auth.userId,
      checkerName: auth.sessionUser.fullName,
      checkerAgencyId: auth.agencyId,
      isGlobal: GLOBAL_ROLES.includes(auth.role),
      ip,
    });

    if (result.result === "WRONG_AGENCY" || result.result === "PAYMENT_NOT_CONFIRMED") {
      await logSecurity({
        event: "SUSPICIOUS",
        userId: auth.userId,
        ipAddress: ip,
        details: { scan: result.result, reference: result.ticket?.reference ?? code.slice(0, 20) },
      });
    }

    return ok(result);
  } catch (err) {
    return routeError(err, "POST /api/checker/scan");
  }
}
