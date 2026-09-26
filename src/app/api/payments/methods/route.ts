// GET /api/payments/methods — contrat API centrale §3.1 : méthodes de
// paiement avec disponibilité HONNÊTE calculée côté serveur.
//
// POURQUOI : avant, le client voyait « MTN Mobile Money » même sans clés
// MOMO_COLLECTION_* configurées → la tentative finissait en 503 et laissait
// une ligne « Échoué » dans l'historique de PAIEMENTS du billet. Désormais
// l'UI sait quelles méthodes sont réellement utilisables (aucun secret
// exposé — uniquement un booléen + un message français clair).
//
// PUBLIC (sans auth) — aucune donnée sensible : labels + disponibilité.
// Utile aussi au SITE AGENCES : il peut vérifier quels canaux d'encaissement
// sont actifs AVANT d'initier un paiement (§11 canal service).

import { NextRequest } from "next/server";
import { ok, routeError, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { listPaymentMethods } from "@/services/payment";

export async function GET(req: NextRequest) {
  try {
    enforceRateLimit(`paymethods:${getClientIp(req)}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    return ok({ methods: listPaymentMethods() });
  } catch (err) {
    return routeError(err, "GET /api/payments/methods");
  }
}
