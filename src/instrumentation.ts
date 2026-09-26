// ============================================================
// OCÉAN DU NORD — Instrumentation serveur (Next.js)
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

    // 2) Compte de service Neon Auth (production uniquement) : e-mail
    //    vérifié + rôle admin dans le schéma neon_auth — sinon AUCUN
    //    import de compte staff possible (502 pont /api/auth/login).
    const { ensureNeonServiceAccountReady } = await import("./lib/neon-auth/service-account-guards");
    await ensureNeonServiceAccountReady();

    // 3) Base absente (installation fraîche) → schéma + seed automatiques.
    const { ensureDatabaseReady } = await import("./lib/db-init");
    await ensureDatabaseReady();

    // 4) Matrice de permissions (RBAC) : garantit que chaque rôle possède
    //    au minimum les droits définis dans le code (ex. bus:manage pour
    //    le chef d'agence) — ajout seul, idempotent.
    const { ensureRolePermissionMatrix } = await import("./lib/db-init");
    await ensureRolePermissionMatrix();
  } catch (err) {
    // L'app démarre quand même : les routes renverront un 503 explicite
    // (voir routeError) invitant à exécuter `npm run db:push` + seed.
    console.error(
      "⚠️  [db-init] Initialisation automatique impossible :",
      err instanceof Error ? err.message : err
    );
  }
}
