// GET /api/tickets/[token]/pdf — billet PDF A4 (V3) : logo, passager, voyage,
// agence, siège, montant, statut paiement, numéro d'embarquement, QR,
// instructions, conditions. Public : le token est le secret du billet
// (mêmes garanties que /qr). Rate limit 15/min/IP (génération coûteuse).

import { NextRequest, NextResponse } from "next/server";
import { routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { renderTicketPdf } from "@/services/ticket-pdf";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    enforceRateLimit(`ticketPdf:${getClientIp(req)}`, RATE_LIMITS.bookingDetail.limit, RATE_LIMITS.bookingDetail.windowMs);
    const { token } = await params;
    const { bytes, fileName } = await renderTicketPdf(token);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return routeError(err, "GET /api/tickets/[token]/pdf");
  }
}
