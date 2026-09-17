// GET /api/auth/me → SessionUser | null
// Répond TOUJOURS 200 : data null si non connecté (pas de 404).

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth(req);
    return ok(auth ? auth.sessionUser : null);
  } catch (err) {
    return routeError(err, "GET /api/auth/me");
  }
}
