// ============================================================
// NZOKO TRANSPORT — Instrumentation serveur (Next.js)
// S'exécute UNE fois au démarrage du serveur (dev ET production).
// Ici : initialisation automatique de la base SQLite si absente,
// pour que le projet fonctionne immédiatement après installation,
// sans commande manuelle (db:push + seed).
// ============================================================

export async function register() {
  // Uniquement le runtime Node (pas edge), pas pendant le build statique.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    // 1) Colonnes GPS V4 éventuellement manquantes en production (Neon) :
    //    AVANT db-init/seed — Prisma échoue (P2022) sur toute requête
    //    incluant `route` si "Route"."geometryJson" est absente.
    const { ensureGpsV4Columns } = await import("./lib/db-schema-guards");
    await ensureGpsV4Columns();

    // 2) Base absente (installation fraîche) → schéma + seed automatiques.
    const { ensureDatabaseReady } = await import("./lib/db-init");
    await ensureDatabaseReady();
  } catch (err) {
    // L'app démarre quand même : les routes renverront un 503 explicite
    // (voir routeError) invitant à exécuter `npm run db:push` + seed.
    console.error(
      "⚠️  [db-init] Initialisation automatique impossible :",
      err instanceof Error ? err.message : err
    );
  }
}
