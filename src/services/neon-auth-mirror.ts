// ============================================================
// NZOKO TRANSPORT — Miroir local des comptes clients Neon Auth
// ============================================================
// Neon Auth (Managed Better Auth) gère l'IDENTITÉ (e-mail + mot de
// passe, sessions, vérification d'e-mail). Le métier NZOKO (billets,
// fidélité, réclamations) exige une ligne User locale : ce service
// retrouve ou provisionne le miroir, exactement comme l'intégration
// Supabase historique — la colonne User.supabaseId sert d'identifiant
// du fournisseur d'identité EXTERNE (désormais Neon Auth).
//
// Le miroir ne délivre AUCUNE session : la route appelante
// (/api/neon-auth/exchange) applique les garde-fous (rôle PASSENGER
// uniquement, compte actif) puis crée la session NZOKO opaque.
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
}

export interface NeonMirrorResult {
  id: string;
  created: boolean;
  roleCode: string;
  isActive: boolean;
}

/**
 * Retrouve (par identifiant Neon, puis par e-mail) ou provisionne le
 * miroir User d'un compte client Neon Auth :
 *  - re-lien : compte déjà lié (supabaseId = identifiant Neon) ;
 *  - adoption : compte local pré-existant avec le même e-mail (le
 *    téléphone local est conservé — clé de rétro-liage des billets) ;
 *  - création : rôle PASSENGER, compte fidélité, notification de
 *    bienvenue (le téléphone sera complété dans le profil).
 */
export async function upsertNeonClientMirror(input: NeonMirrorInput): Promise<NeonMirrorResult> {
  const email = input.email.trim().toLowerCase();
  const { firstName, lastName } = splitFullName(input.name);
  const hasName = Boolean(input.name?.trim());

  const existing =
    (await db.user.findUnique({ where: { supabaseId: input.neonUserId }, select: MIRROR_SELECT })) ??
    (await db.user.findUnique({ where: { email }, select: MIRROR_SELECT }));

  if (existing) {
    // Re-lien / adoption : on n'écrase les noms locaux que si Neon
    // fournit un nom explicite (pas le repli « Client NZOKO »).
    const user = await db.user.update({
      where: { id: existing.id },
      data: {
        supabaseId: input.neonUserId,
        ...(hasName ? { firstName, lastName } : {}),
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
