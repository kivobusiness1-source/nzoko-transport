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
import { ensureNeonServiceAccountReady, neonServiceGuardReport } from "@/lib/neon-auth/service-account-guards";

export async function GET(_req: NextRequest) {
  try {
    // Déclenchement paresseux (idempotent, une fois par instance) : les
    // bundles instrumentation ↔ routes ne partagent pas l'état module —
    // la route exécute sa propre copie du garde-fou pour un diagnostic
    // exact (2 requêtes information_schema légères au premier appel).
    await ensureNeonServiceAccountReady();
    return ok({
      supabase: isSupabaseEnabled,
      neon: isNeonAuthEnabled,
      mode: neonAuthMode,
      neonService: isNeonServiceConfigured,
      // Diagnostic d'infrastructure (noms de tables managées uniquement —
      // aucune donnée utilisateur, aucun secret) : état de l'auto-
      // configuration du compte de service.
      serviceGuard: neonServiceGuardReport(),
    });
  } catch (err) {
    return routeError(err, "GET /api/auth/providers");
  }
}
