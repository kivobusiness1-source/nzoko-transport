// GET /api/agencies/overview — PUBLIC : agences actives + places disponibles
// (7 prochains jours), prochain départ, prix mini. Aucune donnée sensible.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { getAgenciesOverview } from "@/services/agencies";

export async function GET(_req: NextRequest) {
  try {
    const overview = await getAgenciesOverview();
    return ok(overview);
  } catch (err) {
    return routeError(err, "GET /api/agencies/overview");
  }
}
