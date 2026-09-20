// Migration ponctuelle : emails de démo @nzoko.cg → Gmail plus-addressé.
// Toutes les adresses atterrissent dans la boîte geormakoma1@gmail.com
// (plus-addressing Gmail : geormakoma1+role@gmail.com), tout en restant
// uniques en base — ainsi les e-mails réels (codes de vérification Neon
// Auth, notifications) deviennent consultables pendant les tests.
//
// USAGE :
//   - Sandbox (SQLite)   : bun scripts/migrate-emails-gmail.ts
//   - Production (Neon)  : DATABASE_URL="<pooler Neon>" DIRECT_DATABASE_URL="<direct Neon>" bun scripts/migrate-emails-gmail.ts
//
// Idempotent : ne touche QUE les anciennes adresses @nzoko.cg connues.
// Ne supprime AUCUN compte (simple renommage d'e-mail).

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const MAP: Record<string, string> = {
  "superadmin@nzoko.cg": "geormakoma1+superadmin@gmail.com",
  "admin@nzoko.cg": "geormakoma1+admin@gmail.com",
  "manager.pn@nzoko.cg": "geormakoma1+manager@gmail.com",
  "agent.pn@nzoko.cg": "geormakoma1+agent@gmail.com",
  "checker.pn@nzoko.cg": "geormakoma1+checker@gmail.com",
  "comptable@nzoko.cg": "geormakoma1+comptable@gmail.com",
  "chauffeur.jean@nzoko.cg": "geormakoma1+chauffeur@gmail.com",
  "support@nzoko.cg": "geormakoma1+support@gmail.com",
  "pointenoire@nzoko.cg": "geormakoma1+agence-pointenoire@gmail.com",
  "brazzaville@nzoko.cg": "geormakoma1+agence-brazzaville@gmail.com",
  "test.supauth@nzoko.cg": "geormakoma1+demo-client@gmail.com",
};

async function main() {
  let users = 0;
  let agencies = 0;
  for (const [old, neu] of Object.entries(MAP)) {
    const u = await db.user.updateMany({ where: { email: old }, data: { email: neu } });
    const a = await db.agency.updateMany({ where: { email: old }, data: { email: neu } });
    users += u.count;
    agencies += a.count;
    if (u.count || a.count) {
      console.log(`✓ ${old} → ${neu} (users:${u.count} agencies:${a.count})`);
    }
  }
  console.log(`Terminé : ${users} utilisateurs, ${agencies} agences migrés.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
