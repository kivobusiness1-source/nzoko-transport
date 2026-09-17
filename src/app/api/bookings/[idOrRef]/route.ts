// GET /api/bookings/[idOrRef] — détail public par id ou référence non prédictible → BookingDetailDTO
// Rate limit 15/min/IP : la référence est un identifiant semi-secret (anti-énumération).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { getBookingDetail } from "@/services/booking";

export async function GET(req: NextRequest, { params }: { params: Promise<{ idOrRef: string }> }) {
  try {
    enforceRateLimit(`bookingDetail:${getClientIp(req)}`, RATE_LIMITS.bookingDetail.limit, RATE_LIMITS.bookingDetail.windowMs);
    const { idOrRef } = await params;
    const detail = await getBookingDetail(decodeURIComponent(idOrRef));
    return ok(detail);
  } catch (err) {
    return routeError(err, "GET /api/bookings/[idOrRef]");
  }
}
