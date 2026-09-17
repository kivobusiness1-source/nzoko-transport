// GET /api/trips/[id]/seats — plan de sièges public d'un voyage → SeatMapDTO

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { getSeatMap } from "@/services/booking";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Route publique coûteuse (libération des verrous expirés + jointures
    // sièges) — plafonnée anti-scrapping (audit architecture, point 3).
    enforceRateLimit(`seatMap:${getClientIp(req)}`, RATE_LIMITS.seatMap.limit, RATE_LIMITS.seatMap.windowMs);
    const { id } = await params;
    const seatMap = await getSeatMap(id);
    return ok(seatMap);
  } catch (err) {
    return routeError(err, "GET /api/trips/[id]/seats");
  }
}
