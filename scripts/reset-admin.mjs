// ============================================================
// NZOKO TRANSPORT — Réinitialisation du mot de passe administrateur
// ------------------------------------------------------------
// Usage : node scripts/reset-admin.mjs   (ou : bun scripts/reset-admin.mjs)
// Génère un NOUVEAU mot de passe aléatoire pour le compte
// super-administrateur (créé s'il n'existe pas), l'affiche dans la
// console et révoque toutes les sessions existantes de ce compte.
// Pensez ensuite à le changer depuis l'application.
// ============================================================

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const db = new PrismaClient();
const ADMIN_EMAIL = "superadmin@nzoko.cg";

function generatePassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function main() {
  const role = await db.role.findUnique({ where: { code: "SUPER_ADMIN" } });
  if (!role) throw new Error("Rôle SUPER_ADMIN introuvable — la base n'est pas initialisée (lancez d'abord `npm run dev`).");

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (user) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash, isActive: true },
    });
    // Sécurité : révoque toutes les sessions ouvertes de ce compte.
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await db.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash,
        firstName: "Administrateur",
        lastName: "NZOKO",
        roleId: role.id,
        isActive: true,
      },
    });
  }

  console.warn("──────────────────────────────────────────────────────────");
  console.warn("🔑 MOT DE PASSE ADMINISTRATEUR RÉINITIALISÉ :");
  console.warn(`   E-mail       : ${ADMIN_EMAIL}`);
  console.warn(`   Mot de passe : ${password}`);
  console.warn("   ⚠  Affiché une seule fois — changez-le après connexion");
  console.warn("      (menu utilisateur → « Changer mon mot de passe »).");
  console.warn("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("❌ Échec :", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
