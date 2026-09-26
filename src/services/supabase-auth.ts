// ============================================================
// OCÉAN DU NORD — Intégration Supabase Auth (clients)
// ============================================================
// Les COMPTES CLIENTS sont gérés par Supabase (authentification) :
// inscription, connexion et profil sont délégués à Supabase Auth.
// Le serveur Océan du Nord agit en proxy : il ne voit JAMAIS le mot de passe
// en clair autrement que pour le transmettre à Supabase, et il
// maintient un « miroir » local (Prisma) indispensable au métier
// (billets, fidélité, réclamations — clé téléphone).
//
// Mode de fonctionnement :
//  - SUPABASE_URL + SUPABASE_ANON_KEY définis → mode Supabase actif :
//    register → supabase.auth.signUp (metadata first_name/last_name/phone)
//    login   → supabase.auth.signInWithPassword (email ou téléphone)
//  - variables absentes → repli local bcrypt (sandbox / démarrage),
//    comportement strictement identique à l'existant.
//
// Le token Supabase n'est PAS persisté côté client : la session
// applicative reste le cookie opaque Océan du Nord (HttpOnly).
// ============================================================

import { createClient, type SupabaseClient, type User as SupabaseAuthUser } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { ensureLoyaltyAccount } from "@/services/loyalty";
import { randomUUID } from "crypto";

const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

/** true = les comptes clients sont gérés par Supabase. */
export const isSupabaseEnabled = url.startsWith("http") && anonKey.length > 20;

let cached: SupabaseClient | null = null;

/** Client Supabase côté serveur (sessions non persistées — usage proxy). */
export function supabase(): SupabaseClient {
  if (!isSupabaseEnabled) {
    throw new Error("Supabase non configuré : renseignez SUPABASE_URL et SUPABASE_ANON_KEY.");
  }
  cached ??= createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Traduit une erreur Supabase Auth en message français actionnable. */
export function supabaseAuthMessage(code: string | undefined, message: string): string {
  switch (code) {
    case "user_already_exists":
    case "email_exists":
      return "Un compte existe déjà avec cette adresse e-mail.";
    case "weak_password":
      return "Mot de passe trop faible : 8 caractères minimum, mélangez lettres et chiffres.";
    case "invalid_credentials":
      return "Identifiants incorrects.";
    case "over_request_rate_limit":
      return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
    case "user_banned":
      return "Ce compte a été suspendu. Contactez le support Océan du Nord.";
    case "email_not_confirmed":
      return "Confirmez d'abord votre adresse e-mail (lien envoyé à votre boîte mail).";
    case "phone_not_confirmed":
      return "Votre numéro n'a pas encore été confirmé.";
    default:
      if (/fetch|network|timeout|ECONNREFUSED|ENOTFOUND/i.test(message)) {
        return "Service d'authentification momentanément indisponible. Réessayez dans un instant.";
      }
      return message?.slice(0, 160) || "Authentification Supabase impossible.";
  }
}

export interface MirrorInput {
  supabaseId: string;
  email: string;
  phone: string | null; // déjà normalisé E.164 digits
  firstName: string;
  lastName: string;
}

/** Hash inutilisable localement — le mot de passe vit dans Supabase. */
async function unusablePasswordHash(): Promise<string> {
  return hashPassword(randomUUID());
}

/**
 * Crée (ou adopte) le miroir Prisma d'un compte client Supabase :
 * rôle PASSENGER, compte fidélité, rétro-liage des billets achetés
 * sans compte (par téléphone), notification de bienvenue.
 */
export async function upsertClientMirror(input: MirrorInput): Promise<{ id: string; created: boolean }> {
  const existing = (await db.user.findUnique({ where: { supabaseId: input.supabaseId }, select: { id: true } })) ??
    (await db.user.findUnique({ where: { email: input.email.toLowerCase() }, select: { id: true } }));

  if (existing) {
    // Adoption d'un compte local pré-Supabase (même email) ou simple re-lien
    await db.user.update({
      where: { id: existing.id },
      data: {
        supabaseId: input.supabaseId,
        phone: input.phone ?? undefined,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });
    await ensureLoyaltyAccount(existing.id);
    return { id: existing.id, created: false };
  }

  const roleId = await ensurePassengerRoleId();
  const user = await db.user.create({
    data: {
      email: input.email.toLowerCase(),
      phone: input.phone ?? undefined,
      supabaseId: input.supabaseId,
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: await unusablePasswordHash(),
      roleId,
      isActive: true,
    },
  });

  await ensureLoyaltyAccount(user.id);

  if (input.phone) {
    await db.passenger.updateMany({ where: { phone: input.phone }, data: { userId: user.id } });
  }

  await db.notification.create({
    data: {
      userId: user.id,
      title: "Bienvenue chez OCÉAN DU NORD 👋",
      message: "Votre espace client est prêt : billets, points fidélité et réclamations.",
      type: "SUCCESS",
    },
  });

  return { id: user.id, created: true };
}

/** Self-healing du rôle PASSENGER (+ permissions minimales) — partagé avec /api/auth/register. */
export async function ensurePassengerRoleId(): Promise<string> {
  const role = await db.role.upsert({
    where: { code: "PASSENGER" },
    update: {},
    create: { code: "PASSENGER", name: "Client Océan du Nord", isSystem: true },
  });
  const wanted: { code: string; name: string }[] = [
    { code: "booking:create", name: "Créer des réservations" },
    { code: "notification:read", name: "Consulter les notifications" },
  ];
  for (const w of wanted) {
    const permission = await db.permission.upsert({ where: { code: w.code }, update: {}, create: w });
    await db.rolePermission
      .upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      })
      .catch(() => {});
  }
  return role.id;
}

/**
 * Extrait prénom / nom / téléphone d'un utilisateur Supabase
 * (user_metadata : { first_name, last_name, phone }).
 */
export function mirrorDataFromSupabase(su: SupabaseAuthUser): {
  firstName: string;
  lastName: string;
  phone: string | null;
} {
  const meta = (su.user_metadata ?? {}) as Record<string, unknown>;
  const firstName = typeof meta.first_name === "string" && meta.first_name.trim() ? meta.first_name.trim() : "Client";
  const lastName = typeof meta.last_name === "string" && meta.last_name.trim() ? meta.last_name.trim() : "Océan du Nord";
  const rawPhone = typeof meta.phone === "string" ? meta.phone : (su.phone ?? "");
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  return { firstName, lastName, phone };
}
