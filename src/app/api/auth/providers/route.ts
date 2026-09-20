// GET /api/auth/providers — indique à l'interface les modes d'authentification
// actifs (onglet « Neon Auth », badge « Comptes sécurisés par Supabase »,
// champs requis du formulaire d'inscription). Aucune donnée sensible
// n'est exposée : seulement des booléens dérivés de la présence des
// variables d'environnement.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { isSupabaseEnabled } from "@/services/supabase-auth";
import { isNeonAuthEnabled } from "@/lib/neon-auth/server";

export async function GET(_req: NextRequest) {
  try {
    return ok({ supabase: isSupabaseEnabled, neon: isNeonAuthEnabled });
  } catch (err) {
    return routeError(err, "GET /api/auth/providers");
  }
}
