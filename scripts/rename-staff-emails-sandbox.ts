// Renomme les e-mails des comptes internes de la base SANDBOX (SQLite)
// vers la convention kivobusiness1+<rôle>@gmail.com (boîte unique
// kivobusiness1@gmail.com). Idempotent, exécution dans le projet :
//   bun scripts/rename-staff-emails-sandbox.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const RENAMES: Array<[string, string]> = [
  ["geormakoma1+superadmin@gmail.com", "kivobusiness1+superadmin@gmail.com"],
  ["geormakoma1+admin@gmail.com", "kivobusiness1+admin@gmail.com"],
  ["geormakoma1+manager@gmail.com", "kivobusiness1+manager@gmail.com"],
  ["geormakoma1+agent@gmail.com", "kivobusiness1+agent@gmail.com"],
  ["geormakoma1+checker@gmail.com", "kivobusiness1+checker@gmail.com"],
  ["geormakoma1+comptable@gmail.com", "kivobusiness1+comptable@gmail.com"],
  ["geormakoma1+chauffeur@gmail.com", "kivobusiness1+chauffeur@gmail.com"],
  ["geormakoma1+support@gmail.com", "kivobusiness1+support@gmail.com"],
];

async function main() {
  for (const [from, to] of RENAMES) {
    const user = await db.user.findUnique({ where: { email: from } });
    if (!user) {
      const already = await db.user.findUnique({ where: { email: to } });
      console.log(already ? `= ${to} (déjà à jour)` : `! ${from} introuvable`);
      continue;
    }
    const conflict = await db.user.findUnique({ where: { email: to } });
    if (conflict) {
      console.log(`!! conflit : ${to} existe déjà (id ${conflict.id}) — ignoré`);
      continue;
    }
    await db.user.update({ where: { id: user.id }, data: { email: to } });
    console.log(`✓ ${from} → ${to}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
