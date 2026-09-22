import { db } from "@/lib/db";

// ============================================================
// NZOKO TRANSPORT — Garde-fou de schéma GPS V4 (auto-réparation)
// ------------------------------------------------------------
// Contexte (2026-09-22, cf. worklog Task 40) : la base de
// PRODUCTION (Neon PostgreSQL) n'avait pas encore reçu les
// 2 colonnes ADDITIVES du GPS V4 ajoutées après la migration
// d'authentification :
//   "Route"."geometryJson"    TEXT              — tracés GeoJSON
//   "GpsPoint"."batteryLevel" DOUBLE PRECISION  — batterie chauffeur
// Tant qu'elles manquent, TOUTE requête incluant `route` échoue
// (recherche de voyages, carte publique, dashboards admin/agence…)
// avec une erreur P2022 « column does not exist ».
//
// Ce module s'exécute au démarrage du serveur (instrumentation) :
//   1. détecte via information_schema si une colonne manque ;
//   2. la crée (ADD COLUMN IF NOT EXISTS — strictement additif,
//      idempotent, AUCUNE perte de données, aucune table ni colonne
//      n'est jamais supprimée ou modifiée) ;
//   3. ne fait RIEN sur SQLite (la sandbox est gérée par `bun run
//      db:push`, déjà synchrone avec les deux schémas Prisma).
//
// Tolérance aux pannes : tout échec est journalisé et NON FATAL —
// l'application démarre toujours ; les routes concernées gardent
// leur comportement d'erreur habituel tant que le schéma n'est pas
// à jour. Les identifiants ci-dessous sont des constantes internes
// (aucune entrée utilisateur n'atteint ces requêtes).
// ============================================================

interface MissingColumn {
  table: string;
  column: string;
  ddl: string;
}

/** Colonnes GPS V4 attendues par le client Prisma déployé. */
const V4_COLUMNS: MissingColumn[] = [
  {
    table: "Route",
    column: "geometryJson",
    ddl: `ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "geometryJson" TEXT`,
  },
  {
    table: "GpsPoint",
    column: "batteryLevel",
    ddl: `ALTER TABLE "GpsPoint" ADD COLUMN IF NOT EXISTS "batteryLevel" DOUBLE PRECISION`,
  },
];

/** Garde mémoire : une vérification par instance de serveur. */
let checked = false;

/**
 * Crée les colonnes GPS V4 manquantes (production Neon uniquement).
 * Ne fait rien si la base est SQLite ou déjà à jour.
 */
export async function ensureGpsV4Columns(): Promise<void> {
  if (checked) return;
  checked = true;

  // SQLite (sandbox) : le schéma local est géré par `bun run db:push`
  // (double schéma prisma/schema.prisma ↔ schema.postgres.prisma).
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) return;

  try {
    for (const { table, column, ddl } of V4_COLUMNS) {
      // Identifiants constants (aucun risque d'injection) — SQL inliné
      // volontairement : compatible pooler PgBouncer (Neon) sans
      // recours aux requêtes préparées.
      const present: Array<unknown> = await db.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.columns ` +
          `WHERE table_schema = CURRENT_SCHEMA() AND table_name = '${table}' AND column_name = '${column}' ` +
          `LIMIT 1`
      );
      if (present.length > 0) continue; // déjà présente → rien à faire

      console.warn(`🛠  [db-schema] Colonne absente détectée : ${table}.${column} — création (additif, sans perte)…`);
      await db.$executeRawUnsafe(ddl);
      console.warn(`✅ [db-schema] ${table}.${column} créée.`);
    }
  } catch (err) {
    // Non fatal : l'app démarre quand même (cf. en-tête).
    console.warn(
      "⚠️  [db-schema] Auto-réparation du schéma impossible (non fatal) :",
      err instanceof Error ? err.message : err
    );
  }
}
