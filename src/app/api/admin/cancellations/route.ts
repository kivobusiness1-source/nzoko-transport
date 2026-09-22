// GET /api/admin/cancellations?agencyId — registre des clients payeurs des
// voyages annulés (booking:read ; scope agence). Groupé par voyage/bus :
// le gérant y retrouve les contacts à prévenir (WhatsApp prérempli / appel).
// PATCH sur /api/admin/cancellations/contacts/[id] pour marquer « informé ».

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAuth, assertAuthenticated, assertPermission, resolveAgencyScope } from "@/lib/auth";
import { db } from "@/lib/db";
import { toCancellationDTO } from "@/services/cancellations";

export async function GET(req: NextRequest) {
  try {
    const auth = assertPermission(assertAuthenticated(await getAuth(req)), "booking:read");
    const agencyId = resolveAgencyScope(auth, req.nextUrl.searchParams.get("agencyId"));

    const cancellations = await db.tripCancellation.findMany({
      where: agencyId ? { agencyId } : undefined,
      include: {
        trip: {
          include: {
            route: { include: { originCity: true, destinationCity: true } },
            bus: true,
            agency: true,
          },
        },
        cancelledBy: { select: { firstName: true, lastName: true } },
        contacts: { orderBy: { seatNumber: "asc" } },
      },
      orderBy: { cancelledAt: "desc" },
      take: 200,
    });

    return ok(cancellations.map(toCancellationDTO));
  } catch (err) {
    return routeError(err, "GET /api/admin/cancellations");
  }
}
