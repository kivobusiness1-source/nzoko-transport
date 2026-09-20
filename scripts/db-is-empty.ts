// ============================================================
// NZOKO TRANSPORT — Détection de base vierge (boot anti-reboot)
// Sortie : code 0 + « EMPTY » si la base n'a AUCUNE ville (elle vient
// d'être créée par `prisma db push` au boot) → .zscripts/dev.sh lance
// alors les seeds automatiquement ; code 1 + « POPULATED » sinon.
// Exécution : bun run scripts/db-is-empty.ts
// ============================================================

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main(): Promise<never> {
  try {
    // La ville est la racine du graphe FK (quartiers, agences, routes…) :
    // aucune ville = base vierge (ou seed jamais joué).
    const count = await db.city.count();
    if (count === 0) {
      console.log("EMPTY");
      process.exit(0);
    }
    console.log(`POPULATED (${count} villes)`);
    process.exit(1);
  } catch (error) {
    console.error("Erreur d'accès à la base :", error);
    process.exit(2);
  }
}

void main().finally(() => {
  void db.$disconnect();
});
