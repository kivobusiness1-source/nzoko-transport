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

// ============================================================
// V5 GPS MULTI-BUS (2026-09-24) — colonnes additives + table
// TrackingEvent + index d'idempotence. STRICTEMENT additif :
// aucune colonne/table n'est jamais supprimée ni modifiée.
// ============================================================
const V5_COLUMNS: MissingColumn[] = [
  { table: "RouteStop", column: "radiusM", ddl: `ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "radiusM" INTEGER` },
  { table: "TrackingSession", column: "deviceId", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "deviceId" TEXT` },
  { table: "TrackingSession", column: "lastPositionAt", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastPositionAt" TIMESTAMP(3)` },
  { table: "TrackingSession", column: "lastLatitude", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastLatitude" DOUBLE PRECISION` },
  { table: "TrackingSession", column: "lastLongitude", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastLongitude" DOUBLE PRECISION` },
  { table: "TrackingSession", column: "lastSpeed", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastSpeed" DOUBLE PRECISION` },
  { table: "TrackingSession", column: "lastHeading", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastHeading" DOUBLE PRECISION` },
  { table: "TrackingSession", column: "lastAccuracy", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastAccuracy" DOUBLE PRECISION` },
  { table: "TrackingSession", column: "lastBatteryLevel", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastBatteryLevel" DOUBLE PRECISION` },
  { table: "TrackingSession", column: "lastHeartbeatAt", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3)` },
  { table: "TrackingSession", column: "geofenceStopId", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "geofenceStopId" TEXT` },
  { table: "TrackingSession", column: "geofenceEnteredAt", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "geofenceEnteredAt" TIMESTAMP(3)` },
  { table: "TrackingSession", column: "tripPhase", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "tripPhase" TEXT` },
  { table: "TrackingSession", column: "endReason", ddl: `ALTER TABLE "TrackingSession" ADD COLUMN IF NOT EXISTS "endReason" TEXT` },
  { table: "GpsPoint", column: "positionId", ddl: `ALTER TABLE "GpsPoint" ADD COLUMN IF NOT EXISTS "positionId" TEXT` },
];

/** Création idempotente de la table TrackingEvent (miroir exact du
 *  modèle Prisma — casse camelCase quotée, types PostgreSQL). */
const V5_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "TrackingEvent" (` +
    `"id" TEXT NOT NULL, "sessionId" TEXT, "tripId" TEXT, "busId" TEXT, "driverId" TEXT, "agencyId" TEXT, ` +
    `"type" TEXT NOT NULL, "severity" TEXT NOT NULL DEFAULT 'INFO', "message" TEXT, "payloadJson" TEXT, ` +
    `"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, ` +
    `CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id"))`,
];

/** Index V5 (idempotents) — unicité d'idempotence des positions +
 *  index de performance flotte/événements. */
const V5_INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "GpsPoint_sessionId_positionId_key" ON "GpsPoint"("sessionId", "positionId")`,
  `CREATE INDEX IF NOT EXISTS "TrackingSession_busId_status_idx" ON "TrackingSession"("busId", "status")`,
  `CREATE INDEX IF NOT EXISTS "TrackingSession_driverId_status_idx" ON "TrackingSession"("driverId", "status")`,
  `CREATE INDEX IF NOT EXISTS "TrackingSession_status_lastPositionAt_idx" ON "TrackingSession"("status", "lastPositionAt")`,
  `CREATE INDEX IF NOT EXISTS "TrackingEvent_sessionId_createdAt_idx" ON "TrackingEvent"("sessionId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "TrackingEvent_type_createdAt_idx" ON "TrackingEvent"("type", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "TrackingEvent_severity_createdAt_idx" ON "TrackingEvent"("severity", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "TrackingEvent_agencyId_createdAt_idx" ON "TrackingEvent"("agencyId", "createdAt")`,
];

// ============================================================
// V6 ACHAT BILLET (2026-09-24) — quartier d'arrêt à la destination
// choisi par le passager (configuré dans l'admin Parc → Quartiers).
// Colonne additive + FK + index (idempotents).
// ============================================================
const V6_COLUMNS: MissingColumn[] = [
  { table: "Booking", column: "dropOffNeighborhoodId", ddl: `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "dropOffNeighborhoodId" TEXT` },
];

const V6_STATEMENTS: string[] = [
  `CREATE INDEX IF NOT EXISTS "Booking_dropOffNeighborhoodId_idx" ON "Booking"("dropOffNeighborhoodId")`,
  // FK idempotente : PostgreSQL n'accepte pas ADD CONSTRAINT IF NOT EXISTS,
  // on avale l'erreur duplicate_object (contrainte déjà présente).
  `DO $$ BEGIN ` +
    `ALTER TABLE "Booking" ADD CONSTRAINT "Booking_dropOffNeighborhoodId_fkey" ` +
    `FOREIGN KEY ("dropOffNeighborhoodId") REFERENCES "Neighborhood"("id"); ` +
    `EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
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
    for (const { table, column, ddl } of [...V4_COLUMNS, ...V5_COLUMNS, ...V6_COLUMNS]) {
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

    // V5 — table d'événements + index (idempotents, toujours exécutés :
    // CREATE ... IF NOT EXISTS est un no-op quand tout existe déjà).
    for (const ddl of [...V5_TABLES, ...V5_INDEXES, ...V6_STATEMENTS]) {
      await db.$executeRawUnsafe(ddl);
    }
  } catch (err) {
    // Non fatal : l'app démarre quand même (cf. en-tête).
    console.warn(
      "⚠️  [db-schema] Auto-réparation du schéma impossible (non fatal) :",
      err instanceof Error ? err.message : err
    );
  }
}
