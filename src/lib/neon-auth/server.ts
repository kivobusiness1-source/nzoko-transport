// ============================================================
// NZOKO TRANSPORT — Neon Auth (Managed Better Auth) côté serveur
// ============================================================
// Système d'IDENTITÉ et de SESSION centralisé de NZOKO :
//  - tous les comptes (clients → super-admin) s'authentifient chez
//    Neon Auth (téléphone + OTP, e-mail + mot de passe) ;
//  - les rôles/permissions NZOKO restent dans NOTRE base (autorisation) ;
//  - la session applicative nzoko_session est délivrée UNIQUEMENT par
//    /api/neon-auth/exchange après validation serveur de la session Neon.
//
// Variables requises :
//  - NEON_AUTH_BASE_URL      : URL Auth du projet Neon (onglet Configuration)
//  - NEON_AUTH_COOKIE_SECRET : ≥ 32 caractères (openssl rand -base64 32)
//
// Absentes → isNeonAuthEnabled = false : l'app démarre en mode local
// (bcrypt, comportement inchangé) et les routes Neon répondent 503.
//
// NEON_AUTH_MODE :
//  - "neon"  (défaut si Neon configuré) : TOUTE l'authentification passe
//    par Neon Auth — login e-mail, OTP téléphone, inscription. Un seul
//    système (exigence produit).
//  - "local" : stub de DÉVELOPPEMENT sandbox uniquement (le webhook
//    Neon exige une URL HTTPS publique, inaccessible depuis la sandbox) :
//    mêmes routes, même contrat d'interface, backend local (bcrypt + OTP
//    local). À NE JAMAIS activer en production.
//
// ⚠️ Le cookie secret doit être IDENTIQUE sur tous les environnements
// qui partagent la même session (local + Vercel) : c'est lui qui signe
// le cookie de session Neon côté navigateur.
// ============================================================

import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = (process.env.NEON_AUTH_BASE_URL ?? "").trim();
const cookieSecret = (process.env.NEON_AUTH_COOKIE_SECRET ?? "").trim();

/** true = l'authentification Neon Auth est disponible. */
export const isNeonAuthEnabled = baseUrl.startsWith("https://") && cookieSecret.length >= 32;

/**
 * Mode d'authentification actif.
 *  - "neon"  : identité/session centralisées Neon Auth (production) ;
 *  - "local" : stub de dev sandbox (bcrypt + OTP locaux).
 * Explicite via NEON_AUTH_MODE ; défaut : "neon" si Neon est configuré.
 */
export const neonAuthMode: "neon" | "local" = (() => {
  const explicit = (process.env.NEON_AUTH_MODE ?? "").trim().toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "neon") return "neon";
  return isNeonAuthEnabled ? "neon" : "local";
})();

type NeonAuthInstance = ReturnType<typeof createNeonAuth>;

let instance: NeonAuthInstance | null = null;
let handler: ReturnType<NeonAuthInstance["handler"]> | null = null;

/** Instance serveur unique (créée uniquement si configurée). */
export function neonAuth(): NeonAuthInstance {
  if (!isNeonAuthEnabled) {
    throw new Error("Neon Auth non configuré : renseignez NEON_AUTH_BASE_URL et NEON_AUTH_COOKIE_SECRET.");
  }
  instance ??= createNeonAuth({
    baseUrl,
    cookies: { secret: cookieSecret },
  });
  return instance;
}

/** Handlers GET/POST du proxy /api/auth/[...path] (mis en cache). */
export function neonAuthHandler(): ReturnType<NeonAuthInstance["handler"]> {
  handler ??= neonAuth().handler();
  return handler;
}

/** URL racine du service Neon Auth (sans slash final). */
export const neonAuthBaseUrl = baseUrl.replace(/\/+$/, "");
