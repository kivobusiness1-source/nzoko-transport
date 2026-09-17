// GET /api/tickets/[token]/qr — PNG data URL du QR d'un billet (public : le token est un secret)
// Rate limit 30/min/IP (génération QR coûteuse + token secret).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { getTicketQrDataUrl } from "@/services/tickets";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    enforceRateLimit(`ticketQr:${getClientIp(req)}`, RATE_LIMITS.ticketQr.limit, RATE_LIMITS.ticketQr.windowMs);
    const { token } = await params;
    const dataUrl = await getTicketQrDataUrl(token);
    return ok({ dataUrl });
  } catch (err) {
    return routeError(err, "GET /api/tickets/[token]/qr");
  }
}
