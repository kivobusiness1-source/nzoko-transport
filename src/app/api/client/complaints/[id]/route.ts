// GET /api/client/complaints/[id] — détail d'une de MES réclamations
// (404 si elle n'est pas à moi — aucune fuite sur l'existence des autres).

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient, getComplaintDetailForUser } from "@/services/client-space";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`clientRead:${auth.userId}`, RATE_LIMITS.clientRead.limit, RATE_LIMITS.clientRead.windowMs);

    const { id } = await params;
    const data = await getComplaintDetailForUser(id, auth.userId);
    return ok(data);
  } catch (err) {
    return routeError(err, "GET /api/client/complaints/[id]");
  }
}
