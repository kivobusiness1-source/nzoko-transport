"use client";

// ============================================================
// OCÉAN DU NORD — Client Neon Auth côté navigateur
// ============================================================
// Tous les appels (signIn.email, signUp.email, signOut…) partent vers
// NOTRE origine /api/auth/* (le proxy serveur relaie vers Neon) :
// aucun appel direct au service Neon, aucun secret exposé côté client,
// pleinement compatible avec la CSP stricte du projet (connect-src 'self').
// Base URL par défaut du SDK : origine courante + /api/auth (mount
// du catch-all /api/auth/[...path]).
// ============================================================

// POLYFILL AVANT TOUT — doit rester le PREMIER import : le SDK Neon
// Auth appelle crypto.randomUUID() au chargement de son module, et
// cette API n'existe pas sur les origines http:// (non sécurisées) —
// sans ce repli, l'écran de connexion plantait intégralement sur
// une adresse http (crash « Une erreur est survenue »).
import "@/lib/uuid-polyfill";
import { createAuthClient } from "@neondatabase/auth/next";

export const neonAuthClient = createAuthClient();

/** Forme d'erreur attendue par neonAuthErrorMessage (retournée OU lancée). */
export type NeonAuthSdkError = { message?: string; code?: string; status?: number };

/**
 * Exécute un appel du SDK Neon Auth en normalisant ses DEUX modes
 * d'échec vers le contrat { data, error } de better-auth :
 *  - erreur RETOURNÉE ({ data: null, error }) — convention better-auth ;
 *  - erreur LANCÉE — le wrapper @neondatabase/auth fait THROW une
 *    AuthApiError normalisée ({ message, code, status }) sur les
 *    réponses non-OK (constaté en production : signIn.email invalide
 *    → promesse REJETÉE, court-circuitait le pont d'import de
 *    auth-screen.tsx qui déstructurait { error } sans try/catch).
 * Tous les appels SDK de l'app DOIVENT passer par ce wrapper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function neonAuthCall<TData>(call: () => Promise<{ data: TData; error: any }>): Promise<{
  data: TData | null;
  error: NeonAuthSdkError | null;
}> {
  try {
    return await call();
  } catch (thrown) {
    if (thrown && typeof thrown === "object" && ("message" in thrown || "code" in thrown)) {
      return { data: null, error: thrown as NeonAuthSdkError };
    }
    return { data: null, error: { message: thrown instanceof Error ? thrown.message : String(thrown) } };
  }
}

/** Traduit une erreur du service Neon Auth en message français actionnable. */
export function neonAuthErrorMessage(err: { message?: string; code?: string; status?: number } | null | undefined): string {
  const message = (err?.message ?? "").toLowerCase();
  const code = (err?.code ?? "").toUpperCase();
  if (code === "WEBHOOK_NOT_CONFIGURED" || /webhook.*send\.otp|webhook.*must be configured/.test(message)) {
    return "Les codes SMS ne sont pas encore activés (livraison Neon Auth en cours de configuration). En attendant, connectez-vous avec Google ou par e-mail (onglet E-mail) — même compte, mêmes billets.";
  }
  if (/otp.*(not found|invalid)|invalid otp|otp_not_found/.test(message) || code === "OTP_NOT_FOUND") {
    return "Code incorrect ou expiré. Demandez un nouveau code.";
  }
  if (/phone number.*(invalid|required)|invalid phone/i.test(message)) {
    return "Numéro de téléphone invalide (format international requis, ex. +242 06 123 45 67).";
  }
  if (/too many requests|rate limit/i.test(message)) {
    return "Trop de tentatives. Patientez une minute avant de réessayer.";
  }
  if (code === "INVALID_CREDENTIALS" || /invalid email or password|invalid password|invalid_credentials/.test(message)) {
    return "Identifiants incorrects.";
  }
  if (/already exists|user already|email already/.test(message)) {
    return "Un compte existe déjà avec cette adresse e-mail.";
  }
  if (/password.*(short|weak|least)|too short/.test(message)) {
    return "Mot de passe trop faible : 8 caractères minimum.";
  }
  if (/email.*not.*verif|verify your email/.test(message) || code === "EMAIL_NOT_VERIFIED") {
    return "Confirmez d'abord votre adresse e-mail avec le code reçu par mail.";
  }
  if (/fetch|network|timeout|failed to fetch|econnrefused/i.test(message)) {
    return "Service d'authentification momentanément indisponible. Réessayez dans un instant.";
  }
  return err?.message?.slice(0, 160) || "Authentification impossible. Réessayez.";
}
