// GET /api/tracking/config — configuration GPS & carte EFFECTIVE (PUBLIQUE).
// Aucune authentification, aucune donnée sensible : intervalles d'envoi du
// hook chauffeur, seuils serveur (offline/arrivée/vitesse) et tuiles de la
// carte ouverte. C'est la source UNIQUE du navigateur (le client ne lit
// JAMAIS process.env directement pour ces valeurs). Rate limit léger.

import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { trackingConfigSnapshot } from "@/lib/gps-config";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`trackingConfig:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    return ok(trackingConfigSnapshot());
  } catch (err) {
    return routeError(err, "Erreur configuration GPS");
  }
}
