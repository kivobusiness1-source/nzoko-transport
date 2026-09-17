// GET /api/admin/trips/[id]/contacts — contacts passagers d'un voyage annulé
// (ou sur le point de l'être) pour PRÉVENIR les clients :
//   - message WhatsApp pré-rempli (wa.me) personnalisé par passager ;
//   - lien d'appel tel: ;
//   - message de diffusion générique (groupes WhatsApp) ;
//   - résumé remboursements (montants à traiter).
// Permission trip:manage + scope agence ; rate limit 10/min/IP+user ;
// consultation journalisée (accès à des données personnelles).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp, ApiError, ERROR_CODES } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getTripCancellationContacts } from "@/services/trip-contacts";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "trip:manage");
    const ip = getClientIp(req);
    enforceRateLimit(`tripContacts:${ip}:${auth.userId}`, RATE_LIMITS.tripContacts.limit, RATE_LIMITS.tripContacts.windowMs);

    const { id } = await params;

    // Scope agence : un non-global ne voit que les voyages de son agence.
    const trip = await db.trip.findUnique({ where: { id }, select: { agencyId: true, code: true } });
    if (!trip) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Voyage introuvable.");
    resolveAgencyScope(auth, trip.agencyId);

    const contacts = await getTripCancellationContacts(id);

    // Accès à des données personnelles (téléphones passagers) → journalisé.
    await logAudit({
      userId: auth.userId,
      action: "TRIP_CONTACTS_VIEWED",
      entity: "Trip",
      entityId: id,
      metadata: { code: trip.code, total: contacts.summary.total, paid: contacts.summary.paid },
      ipAddress: ip,
    });

    return ok(contacts);
  } catch (err) {
    return routeError(err, "GET /api/admin/trips/[id]/contacts");
  }
}
