// /api/auth/[...path] — proxy Neon Auth (Managed Better Auth).
//
// Toutes les API d'authentification Neon (sign-in/email, sign-up/email,
// get-session, sign-out…) transitent par ce handler, qui relaie vers le
// service managé Neon et pose les cookies de session signés.
//
// ⚠️ Résolution Next.js : les routes STATIQUES existantes (login, register,
// logout, me, otp, providers) ont priorité sur ce catch-all — l'auth
// locale NZOKO (staff, comptes de test) reste donc strictement inchangée.
// Aucun des endpoints Better Auth (sign-in/email, sign-up/email,
// get-session, sign-out, ok, error…) n'entre en collision avec elles.

import type { NextRequest } from "next/server";
import { fail } from "@/lib/api-response";
import { isNeonAuthEnabled, neonAuthHandler } from "@/lib/neon-auth/server";

// Next.js 16 : params asynchrone (Promise) pour les segments dynamiques.
type Ctx = { params: Promise<{ path: string[] }> };

function notConfigured() {
  return fail(503, "SERVICE_UNAVAILABLE", "Neon Auth n'est pas configuré sur cet environnement.");
}

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!isNeonAuthEnabled) return notConfigured();
  return neonAuthHandler().GET(req, ctx);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!isNeonAuthEnabled) return notConfigured();
  return neonAuthHandler().POST(req, ctx);
}
