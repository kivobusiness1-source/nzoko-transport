// POST /api/auth/logout — révoque la session courante + efface le cookie → true

import { NextRequest } from "next/server";
import { ok, routeError, assertSameOriginPost, getClientIp } from "@/lib/api-response";
import { revokeSession, clearSessionCookie } from "@/lib/auth";
import { logSecurity } from "@/lib/audit";
import { getAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = await getAuth(req);
    await revokeSession(req);
    if (auth) {
      await logSecurity({ event: "LOGOUT", userId: auth.userId, email: auth.email, ipAddress: getClientIp(req) });
    }
    const res = ok(true);
    return clearSessionCookie(res);
  } catch (err) {
    return routeError(err, "POST /api/auth/logout");
  }
}
