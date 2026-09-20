// GET /api/auth/providers — indique à l'interface le mode d'authentification
// actif. Aucune donnée sensible n'est exposée : seulement des dérivés des
// variables d'environnement et des booléens de configuration.
//
//  - mode "neon"  : identité/session centralisées Neon Auth (production) —
//    l'interface enchaîne SDK (sign-in/sign-up/OTP téléphone) → exchange ;
//  - mode "local" : stub de développement sandbox (bcrypt + OTP locaux) ;
//  - neonService  : le compte de service (provisioning téléphone + pont
//    d'import) est configuré côté serveur.

import { NextRequest } from "next/server";
import { ok, routeError } from "@/lib/api-response";
import { isSupabaseEnabled } from "@/services/supabase-auth";
import { isNeonAuthEnabled, neonAuthMode } from "@/lib/neon-auth/server";
import { isNeonServiceConfigured } from "@/lib/neon-auth/service-account";

export async function GET(_req: NextRequest) {
  try {
    return ok({
      supabase: isSupabaseEnabled,
      neon: isNeonAuthEnabled,
      mode: neonAuthMode,
      neonService: isNeonServiceConfigured,
    });
  } catch (err) {
    return routeError(err, "GET /api/auth/providers");
  }
}
