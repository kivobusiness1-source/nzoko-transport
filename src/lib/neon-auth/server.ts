// ============================================================
// NZOKO TRANSPORT — Neon Auth (Managed Better Auth) côté serveur
// ============================================================
// Comptes CLIENTS gérés par Neon Auth (console Neon → Auth) :
// inscription / connexion / sessions déléguées au service managé,
// proxifiées par /api/auth/[...path] (auth.handler()).
//
// Variables requises :
//  - NEON_AUTH_BASE_URL      : URL Auth du projet Neon (onglet Configuration)
//  - NEON_AUTH_COOKIE_SECRET : ≥ 32 caractères (openssl rand -base64 32)
//
// Absentes → isNeonAuthEnabled = false : l'app démarre en mode local
// (bcrypt, comportement inchangé) et les routes Neon répondent 503.
//
// ⚠️ Le cookie secret doit être IDENTIQUE sur tous les environnements
// qui partagent la même session (local + Vercel) : c'est lui qui signe
// le cookie de session Neon côté navigateur.
// ============================================================

import { createNeonAuth } from "@neondatabase/auth/next/server";

const baseUrl = (process.env.NEON_AUTH_BASE_URL ?? "").trim();
const cookieSecret = (process.env.NEON_AUTH_COOKIE_SECRET ?? "").trim();

/** true = les comptes clients peuvent s'authentifier via Neon Auth. */
export const isNeonAuthEnabled = baseUrl.startsWith("https://") && cookieSecret.length >= 32;

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
