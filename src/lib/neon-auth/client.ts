"use client";

// ============================================================
// NZOKO TRANSPORT — Client Neon Auth côté navigateur
// ============================================================
// Tous les appels (signIn.email, signUp.email, signOut…) partent vers
// NOTRE origine /api/auth/* (le proxy serveur relaie vers Neon) :
// aucun appel direct au service Neon, aucun secret exposé côté client,
// pleinement compatible avec la CSP stricte du projet (connect-src 'self').
// Base URL par défaut du SDK : origine courante + /api/auth (mount
// du catch-all /api/auth/[...path]).
// ============================================================

import { createAuthClient } from "@neondatabase/auth/next";

export const neonAuthClient = createAuthClient();

/** Traduit une erreur du service Neon Auth en message français actionnable. */
export function neonAuthErrorMessage(err: { message?: string; code?: string; status?: number } | null | undefined): string {
  const message = (err?.message ?? "").toLowerCase();
  const code = err?.code ?? "";
  if (code === "invalid_credentials" || /invalid email or password|invalid password/.test(message)) {
    return "Identifiants incorrects.";
  }
  if (/already exists|user already|email already/.test(message)) {
    return "Un compte existe déjà avec cette adresse e-mail.";
  }
  if (/password.*(short|weak|least)|too short/.test(message)) {
    return "Mot de passe trop faible : 8 caractères minimum.";
  }
  if (/email.*not.*verif|verify your email/.test(message)) {
    return "Confirmez d'abord votre adresse e-mail (lien envoyé par Neon Auth).";
  }
  if (/fetch|network|timeout|failed to fetch|econnrefused/i.test(message)) {
    return "Service d'authentification momentanément indisponible. Réessayez dans un instant.";
  }
  return err?.message?.slice(0, 160) || "Authentification Neon impossible. Réessayez.";
}
