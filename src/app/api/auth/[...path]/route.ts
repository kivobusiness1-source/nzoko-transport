// /api/auth/[...path] — proxy Neon Auth (Managed Better Auth).
//
// Toutes les API d'authentification Neon transitent par ce handler, qui
// relaie vers le service managé Neon et pose les cookies de session signés.
//
// ⚠️ Résolution Next.js : les routes STATIQUES existantes (login, register,
// logout, me, otp, providers) ont priorité sur ce catch-all — aucune
// collision avec les endpoints Better Auth.
//
// DURCISSEMENT : liste blanche des seuls endpoints exposés au NAVIGATEUR.
// Les appels ADMIN (provisioning, import) sont effectués exclusivement par
// le SERVEUR NZOKO avec le compte de service (src/lib/neon-auth/
// service-account.ts) — jamais via ce proxy public.

import type { NextRequest } from "next/server";
import { fail } from "@/lib/api-response";
import { isNeonAuthEnabled, neonAuthHandler } from "@/lib/neon-auth/server";

// Next.js 16 : params asynchrone (Promise) pour les segments dynamiques.
type Ctx = { params: Promise<{ path: string[] }> };

const ALLOWED_POST_PREFIXES = [
  "sign-in/email", // connexion e-mail + mot de passe (SDK)
  "sign-in/social", // OAuth social (Google/GitHub/Vercel — plugin Managed Auth)
  "sign-up/email", // inscription e-mail (SDK)
  "sign-out", // déconnexion session Neon
  "phone-number/send-otp", // OTP téléphone (plugin Phone Number)
  "phone-number/verify", // vérification OTP → session Neon
  "email-otp/verify-email", // vérification d'adresse e-mail (code)
  "email-otp/send-verification-otp", // renvoi du code de vérification e-mail
  "forget-password", // mot de passe oublié
  "reset-password/", // réinitialisation (token)
];

const ALLOWED_GET_PATHS = [
  "get-session", // lecture de session (SDK)
  "ok", // santé du service
  "error", // page d'erreur standard
];

function notConfigured() {
  return fail(503, "SERVICE_UNAVAILABLE", "Neon Auth n'est pas configuré sur cet environnement.");
}

function notAllowed() {
  return fail(404, "NOT_FOUND", "Endpoint d'authentification inconnu.");
}

function isPathAllowed(pathSegments: string[], method: "GET" | "POST"): boolean {
  const joined = pathSegments.join("/").replace(/\/+$/, "");
  if (!joined) return false;
  if (method === "GET") {
    return ALLOWED_GET_PATHS.some((p) => p === joined || joined.startsWith(`${p}/`));
  }
  return ALLOWED_POST_PREFIXES.some((p) => joined === p || joined.startsWith(p));
}

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!isNeonAuthEnabled) return notConfigured();
  const { path } = await ctx.params;
  if (!isPathAllowed(path ?? [], "GET")) return notAllowed();
  return neonAuthHandler().GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!isNeonAuthEnabled) return notConfigured();
  const { path } = await ctx.params;
  if (!isPathAllowed(path ?? [], "POST")) return notAllowed();
  return neonAuthHandler().POST(req, ctx);
}
