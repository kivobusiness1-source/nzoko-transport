// ============================================================
// NZOKO TRANSPORT — Miroir local des comptes Neon Auth (universel)
// ============================================================
// Neon Auth (Managed Better Auth) gère l'IDENTITÉ et la SESSION de
// TOUS les comptes NZOKO (clients, guichets, agences, contrôleurs,
// chauffeurs, comptables, support, admins, super-admins). Le métier
// NZOKO (billets, fidélité, rôles, permissions, agences) exige une
// ligne User locale : ce service retrouve ou provisionne le miroir,
// la colonne User.supabaseId servant d'identifiant du fournisseur
// d'identité externe (Neon Auth).
//
// RÈGLES D'AUTORITÉ (exigence sécurité produit) :
//  - le RÔLE et l'AGENCE vivent UNIQUEMENT ici (base NZOKO) : jamais
//    dans le jeton du navigateur ni dans le compte Neon ;
//  - re-lien par identifiant Neon (supabaseId) ou adoption par e-mail :
//    le compte local EXISTANT (notamment le staff) garde son rôle,
//    son agence et ses permissions — aucune donnée métier n'est écrasée ;
//  - création réservée aux inconnus → rôle PASSENGER (client) ;
//  - le téléphone fourni par Neon (vérifié) est adopté si le miroir
//    n'en a pas (clé de liaison des billets).
// ============================================================

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ensureLoyaltyAccount } from "@/services/loyalty";
import { ensurePassengerRoleId } from "@/services/supabase-auth";

const MIRROR_SELECT = {
  id: true,
  isActive: true,
  role: { select: { code: true } },
} as const;

/** Hash inutilisable localement — le mot de passe vit chez Neon Auth. */
async function unusableNeonPasswordHash(): Promise<string> {
  return hashPassword(randomUUID());
}

/** Découpe « Grâce Mabika » → { Grâce, Mabika } avec replis sobres. */
export function splitFullName(rawName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (rawName ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Client",
    lastName: parts.slice(1).join(" ") || "NZOKO",
  };
}

export interface NeonMirrorInput {
  /** Identifiant utilisateur chez Neon Auth (Better Auth user.id). */
  neonUserId: string;
  email: string;
  name: string | null;
  /** Téléphone E.164 vérifié chez Neon (plugin Phone Number), le cas échéant. */
  phoneNumber?: string | null;
}

export interface NeonMirrorResult {
  id: string;
  created: boolean;
  roleCode: string;
  isActive: boolean;
}

/**
 * Retrouve (par identifiant Neon, puis par e-mail) ou provisionne le
 * miroir User d'un compte Neon Auth — CLIENT comme STAFF :
 *  - re-lien : compte déjà lié (supabaseId = identifiant Neon) ;
 *  - adoption : compte local pré-existant avec le même e-mail (staff
 *    importé à la volée par le pont /api/auth/login, ou client local
 *    historique) → rôle, agence et permissions locaux CONSERVÉS ;
 *  - création : rôle PASSENGER, compte fidélité, notification de
 *    bienvenue.
 */
export async function upsertNeonUserMirror(input: NeonMirrorInput): Promise<NeonMirrorResult> {
  const email = input.email.trim().toLowerCase();
  const { firstName, lastName } = splitFullName(input.name);
  const hasName = Boolean(input.name?.trim());
  const phone = input.phoneNumber?.trim() || null;

  const existing =
    (await db.user.findFirst({
      where: { OR: [{ supabaseId: input.neonUserId }, { email }] },
      select: { ...MIRROR_SELECT, phone: true, supabaseId: true, email: true },
    })) ?? null;

  if (existing) {
    // Re-lien / adoption — on n'écrase JAMAIS le rôle, l'agence ni les
    // permissions locaux. Le nom Neon n'écrase le nom local que pour les
    // comptes créés via Neon (client) : le staff garde son identité NZOKO.
    const isAdoption = existing.supabaseId !== input.neonUserId;
    const shouldUpdateName = hasName && (isAdoption ? existing.role.code === "PASSENGER" : true);
    const user = await db.user.update({
      where: { id: existing.id },
      data: {
        supabaseId: input.neonUserId,
        ...(shouldUpdateName ? { firstName, lastName } : {}),
        // Adoption du téléphone vérifié si le miroir n'en a pas
        ...(phone && !existing.phone ? { phone } : {}),
      },
      select: MIRROR_SELECT,
    });
    await ensureLoyaltyAccount(user.id);
    return { id: user.id, created: false, roleCode: user.role.code, isActive: user.isActive };
  }

  const roleId = await ensurePassengerRoleId();
  const user = await db.user.create({
    data: {
      email,
      supabaseId: input.neonUserId,
      firstName,
      lastName,
      ...(phone ? { phone } : {}),
      passwordHash: await unusableNeonPasswordHash(),
      roleId,
      isActive: true,
    },
    select: MIRROR_SELECT,
  });

  await ensureLoyaltyAccount(user.id);

  await db.notification.create({
    data: {
      userId: user.id,
      title: "Bienvenue chez NZOKO TRANSPORT 👋",
      message:
        "Votre espace client est prêt : billets, points fidélité et réclamations. Pensez à renseigner votre téléphone dans votre profil.",
      type: "SUCCESS",
    },
  });

  return { id: user.id, created: true, roleCode: user.role.code, isActive: user.isActive };
}

/**
 * Alias historique (compatibilité) : l'ancien nom de la fonction.
 * Le pont est désormais universel — clients ET équipes NZOKO.
 */
export const upsertNeonClientMirror = upsertNeonUserMirror;
