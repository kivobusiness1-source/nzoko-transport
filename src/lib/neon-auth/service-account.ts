// ============================================================
// OCÉAN DU NORD — Compte de service admin Neon Auth
// ============================================================
// Le provisioning serveur (créer le compte Neon d'un client qui se
// connecte pour la PREMIÈRE fois par téléphone + OTP, importer à la
// volée les comptes internes existants) utilise le plugin Admin du
// service managé — qui exige une SESSION admin (cookies HttpOnly).
//
// Océan du Nord détient donc un COMPTE DE SERVICE :
//  - créé une fois (script scripts/neon-create-service-account.ts ou
//    inscription dans l'onglet E-mail de l'application) ;
//  - vérifié par e-mail (le code arrive dans la boîte du propriétaire) ;
//  - marqué « admin » dans la console Neon (Auth → Users → ⋮ → Make admin).
//
// La session de service vit UNIQUEMENT en mémoire serveur (jamais de
// cookie côté navigateur, jamais d'identifiants côté client). Elle est
// mise en cache et rafraîchie automatiquement.
//
// Sécurité :
//  - le rôle « admin » Neon Auth ne donne AUCUN droit Océan du Nord : les
//    rôles/permissions métier vivent dans notre base (User.roleId) et
//    sont relus côté serveur à chaque requête ;
//  - le compte de service est REFUSÉ par /api/neon-auth/exchange et par
//    le pont d'import (isNeonServiceAccount) — il ne peut jamais devenir
//    une session utilisateur Océan du Nord ;
//  - les mots de passe transmis (import à la volée) ne sont JAMAIS
//    journalisés ni stockés : transmis au service Neon puis oubliés.
// ============================================================

import { neonAuthBaseUrl, isNeonAuthEnabled } from "./server";
import { db } from "@/lib/db";

const SERVICE_EMAIL = (process.env.NEON_AUTH_SERVICE_EMAIL ?? "").trim().toLowerCase();
const SERVICE_PASSWORD = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";

// ⚠️ Le service managé Neon Auth EXIGE un en-tête Origin sur les appels
// serveur→serveur (403 « Origin header required » sinon — découvert Task 36
// sur le script de création, ici sur le flux applicatif). La valeur doit
// figurer dans les origines autorisées de la console Neon :
//  - NEON_SERVICE_ORIGIN : override explicite (ex. l'URL de production,
//    une fois ajoutée à la console → Auth → Configuration) ;
//  - défaut : http://localhost:3000 — origine de développement
//    universellement autorisée par Neon (validée en Task 36), qui débloque
//    le pont d'import SANS action console.
const SERVICE_ORIGIN = (process.env.NEON_SERVICE_ORIGIN ?? "").trim() || "http://localhost:3000";

/** true = le compte de service est configuré (provisioning possible). */
export const isNeonServiceConfigured = isNeonAuthEnabled && SERVICE_EMAIL.length > 3 && SERVICE_PASSWORD.length >= 8;

/** true = cet e-mail est celui du compte de service (jamais pontable). */
export function isNeonServiceAccount(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  return SERVICE_EMAIL.length > 3 && normalized === SERVICE_EMAIL;
}

// ---------- Session de service (cache mémoire) ----------

interface ServiceSession {
  cookie: string;
  expiresAt: number;
}

let cachedSession: ServiceSession | null = null;

/** Cookie de session du service, signé au besoin (cache 45 min). */
async function getServiceCookie(): Promise<string> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 60_000) {
    return cachedSession.cookie;
  }
  const res = await fetch(`${neonAuthBaseUrl}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SERVICE_ORIGIN },
    body: JSON.stringify({ email: SERVICE_EMAIL, password: SERVICE_PASSWORD }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new Error(
      `Session du compte de service Neon impossible (${res.status} ${body.code ?? body.message ?? ""}). ` +
        "Vérifiez NEON_AUTH_SERVICE_EMAIL / NEON_AUTH_SERVICE_PASSWORD, la vérification d'e-mail du compte et son rôle admin (console Neon → Auth → Users → Make admin)."
    );
  }
  // Agrège les Set-Cookie de la réponse (session signée du service managé)
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    throw new Error("Le service Neon n'a pas renvoyé de cookie de session pour le compte de service.");
  }
  cachedSession = { cookie, expiresAt: Date.now() + 45 * 60 * 1000 };
  return cookie;
}

/** Appel authentifié au service Neon avec la session de service admin. */
async function serviceFetch(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const cookie = await getServiceCookie();
  const res = await fetch(`${neonAuthBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: SERVICE_ORIGIN },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Session expirée entre-temps → une seule relance propre
  if (res.status === 401 && cachedSession) {
    cachedSession = null;
    const retryCookie = await getServiceCookie();
    const retry = await fetch(`${neonAuthBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: retryCookie, Origin: SERVICE_ORIGIN },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const retryJson = (await retry.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: retry.ok, status: retry.status, json: retryJson };
  }
  return { ok: res.ok, status: res.status, json };
}

// ---------- Provisioning ----------

/**
 * Identifiant Better Auth d'un compte managé, lu DIRECTEMENT dans la table
 * neon_auth."user" de la base applicative (le service Neon Auth persiste
 * ses utilisateurs dans la base du projet — constaté : updatedAt frais,
 * comptes créés via /admin/create-user visibles en lecture SQL).
 * Remplace l'endpoint /admin/list-users, RETIRÉ du service managé
 * (2026-09-23 : 404 — Neon Auth a restreint les routes admin à
 * create-user / update-user / set-user-password / remove-user /
 * ban-user / list-user-sessions).
 * SQLite (sandbox) : la table n'existe pas → null (le provisioning Neon
 * n'y tourne pas, mode local).
 */
export async function neonManagedUserId(email: string): Promise<string | null> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) return null;
  const normalized = email.trim().toLowerCase();
  const rows = (await db.$queryRawUnsafe(
    `SELECT "id" FROM neon_auth."user" WHERE lower("email") = $1 LIMIT 1`,
    normalized
  )) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Identifiant Better Auth d'un compte managé portant ce numéro E.164. */
export async function neonManagedUserIdByPhone(phoneE164: string): Promise<string | null> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) return null;
  const rows = (await db.$queryRawUnsafe(
    `SELECT "id" FROM neon_auth."user" WHERE "phoneNumber" = $1 LIMIT 1`,
    phoneE164
  )) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/**
 * Suppression best-effort d'un compte managé (nettoyage des anciens
 * comptes lors d'une migration d'identifiants). Aucune erreur remontée :
 * un compte Neon orphelin restant est inoffensif (aucun e-mail local ne
 * pointe vers lui après migration).
 */
export async function removeNeonAccountSilently(email: string): Promise<boolean> {
  try {
    const userId = await neonManagedUserId(email);
    if (!userId) return false;
    const res = await serviceFetch("/admin/remove-user", { userId });
    return res.ok;
  } catch {
    return false;
  }
}

/** E-mail synthétique déterministe d'un compte créé par téléphone. */
export function phoneSyntheticEmail(phoneE164: string): string {
  return `${phoneE164}@phone.nzoko.cg`;
}

export interface EnsurePhoneUserResult {
  provisioned: boolean;
  neonUserId: string | null;
}

/**
 * Garantit qu'un utilisateur Neon Auth existe avec ce numéro E.164.
 * 1. Recherche par téléphone (listUsers filterField=phoneNumber) ;
 * 2. Recherche par e-mail synthétique ({phone}@phone.nzoko.cg) ;
 * 3. Sinon création via admin.createUser (data.phoneNumber — le numéro
 *    est marqué « vérifié » automatiquement par /phone-number/verify
 *    à la saisie du code ; aucune seconde identité n'est créée).
 */
export async function ensureNeonPhoneUser(phoneE164: string): Promise<EnsurePhoneUserResult> {
  if (!isNeonServiceConfigured) {
    throw new Error("Compte de service Neon non configuré (NEON_AUTH_SERVICE_EMAIL / NEON_AUTH_SERVICE_PASSWORD).");
  }

  // 1. Utilisateur existant avec ce numéro ? (lecture directe de la table
  //    managée — /admin/list-users n'existe plus sur le service)
  const existingId = await neonManagedUserIdByPhone(phoneE164);
  if (existingId) {
    return { provisioned: false, neonUserId: existingId };
  }

  // 2/3. Création (idempotente : l'e-mail synthétique est unique par numéro)
  const synthetic = phoneSyntheticEmail(phoneE164);
  const created = await serviceFetch("/admin/create-user", {
    email: synthetic,
    name: `Client ${phoneE164}`,
    role: "user",
    // emailVerified : un e-mail synthétique {phone}@phone.nzoko.cg n'est
    // JAMAIS vérifiable par boîte mail — sans cela la connexion du client
    // serait bloquée (« Email not verified », configuration Neon exigeant
    // la vérification). Le numéro, lui, est vérifié par l'OTP lui-même.
    data: { phoneNumber: phoneE164, emailVerified: true },
  });
  if (created.ok) {
    const user = created.json.user as { id?: string } | undefined;
    return { provisioned: true, neonUserId: user?.id ?? null };
  }
  const code = String(created.json.code ?? "");
  const message = String(created.json.message ?? "");
  // Déjà existant (e-mail synthétique) → numéro déjà provisionné
  if (created.status === 400 && /already exists/i.test(message)) {
    const syntheticId = await neonManagedUserId(synthetic);
    return { provisioned: false, neonUserId: syntheticId };
  }
  throw new Error(`Provisioning téléphone impossible (${created.status} ${code} ${message}).`);
}

export interface ImportAccountResult {
  imported: boolean;
  neonUserId: string | null;
}

/**
 * Pont d'import « à la volée » : crée (ou met à jour le mot de passe du)
 * compte Neon d'un utilisateur Océan du Nord EXISTANT dont le mot de passe local
 * bcrypt vient d'être vérifié côté serveur. Le mot de passe n'est jamais
 * stocké ni journalisé — il est transmis au service Neon puis oublié.
 */
export async function importNeonAccount(input: {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
}): Promise<ImportAccountResult> {
  if (!isNeonServiceConfigured) {
    throw new Error("Compte de service Neon non configuré (NEON_AUTH_SERVICE_EMAIL / NEON_AUTH_SERVICE_PASSWORD).");
  }
  const email = input.email.trim().toLowerCase();

  const created = await serviceFetch("/admin/create-user", {
    email,
    password: input.password,
    name: input.name || email.split("@")[0],
    role: "user",
    // emailVerified : le compte staff vient d'être authentifié par le
    // mot de passe local bcrypt VÉRIFIÉ CÔTÉ SERVEUR — le marquer vérifié
    // d'office, sinon la connexion Neon suivante échouerait (« Email not
    // verified », constaté en production sur le compte de service).
    ...(input.phone ? { data: { phoneNumber: input.phone, emailVerified: true } } : { data: { emailVerified: true } }),
  });
  if (created.ok) {
    const user = created.json.user as { id?: string } | undefined;
    return { imported: true, neonUserId: user?.id ?? null };
  }

  const message = String(created.json.message ?? "");
  if (created.status === 400 && /already exists/i.test(message)) {
    // Compte Neon déjà existant (ex. client inscrit par e-mail) :
    // on aligne son mot de passe sur l'identifiant local vérifié.
    // (L'identifiant est lu directement dans la table managée —
    // /admin/list-users n'existe plus sur le service.)
    const existingId = await neonManagedUserId(email);
    if (!existingId) {
      throw new Error("Compte Neon existant introuvable pour l'alignement du mot de passe.");
    }
    const updated = await serviceFetch("/admin/set-user-password", {
      userId: existingId,
      newPassword: input.password,
    });
    if (!updated.ok) {
      throw new Error(`Alignement du mot de passe impossible (${updated.status}).`);
    }
    // Compte Neon PRÉ-EXISTANT (ex. inscrit via l'onglet e-mail) : on
    // aligne AUSSI l'état de vérification — sinon la connexion resterait
    // bloquée (« Email not verified »). Best-effort : un échec (permission
    // manquante, champ inconnu) est non bloquant, l'alignement du mot de
    // passe a déjà réussi.
    await serviceFetch("/admin/update-user", {
      userId: existingId,
      data: { emailVerified: true },
    });
    return { imported: true, neonUserId: existingId };
  }
  const code = String(created.json.code ?? "");
  throw new Error(`Import du compte vers Neon impossible (${created.status} ${code} ${message}).`);
}
