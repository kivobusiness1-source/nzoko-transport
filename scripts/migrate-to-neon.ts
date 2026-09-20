// ============================================================
// NZOKO TRANSPORT — Migration des données SQLite → PostgreSQL (Neon)
// One-shot, exécuté le 2026-09-17. Usage : bun run scripts/migrate-to-neon.ts
//
// Prérequis :
//   1. .env pointe vers Neon (DATABASE_URL pooler + DIRECT_DATABASE_URL)
//   2. `bun run db:push` a déjà créé le schéma PostgreSQL (tables vides)
//   3. L'ancienne base SQLite est intacte (db/custom.db, sauvegarde
//      db/custom.sqlite.bak-pre-neon)
//
// Stratégie :
//   - Lecture SQLite via bun:sqlite (lecture seule)
//   - Ordre d'insertion TOPOLOGIQUE (FK dépendances, graphe vérifié acyclique)
//   - Conversion de types : Boolean 0/1 → true/false, DateTime epoch-millis → Date
//     (Prisma SQLite stocke les DateTime en INTEGER millisecondes UTC — conversion exacte)
//   - Nettoyage des références orphelines (SQLite n'a pas toujours appliqué ses FK) :
//     colonne nullable → NULL, sinon la ligne est écartée (avec rapport)
//   - Insertion par lots de 50 lignes via $executeRawUnsafe, dans UNE transaction
//     (atomicité : tout ou rien)
//   - Vérification des comptes ligne par ligne + contrôles métier en fin
// ============================================================

import { Database } from "bun:sqlite";
import { PrismaClient } from "@prisma/client";

const SQLITE_PATH = "/home/z/my-project/db/custom.db";

// Ordre topologique des dépendances FK (parents avant enfants) — dérivé du DDL
// SQLite (FOREIGN KEY ... REFERENCES) et vérifié acyclique. NE PAS RÉORDONNER.
const ORDER = [
  "Role",
  "Permission",
  "City",
  "SeatLayout",
  "OtpCode",
  "PromoCode",
  "RolePermission",
  "Agency",
  "Route",
  "Seat",
  "Bus",
  "User",
  "RouteStop",
  "Session",
  "Driver",
  "Notification",
  "AuditLog",
  "SecurityLog",
  "LoyaltyAccount",
  "FavoriteRoute",
  "Complaint",
  "RedemptionRequest",
  "Passenger",
  "Trip",
  "ComplaintMessage",
  "Booking",
  "Expense",
  "TrackingSession",
  "SeatOccupancy",
  "Ticket",
  "Payment",
  "LoyaltyTransaction",
  "TripRating",
  "GpsPoint",
  "Transaction",
] as const;

type PgColumn = { column_name: string; data_type: string; is_nullable: string };

/** Dépendance FK lue depuis le DDL SQLite (source de vérité). */
type FkDep = { col: string; ref: string };

/** Convertit une valeur SQLite vers le type PostgreSQL cible. */
function convert(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") value = Number(value); // sécurité bun:sqlite
  if (dataType === "boolean") return value === 1 || value === true;
  if (dataType === "timestamp with time zone" || dataType === "timestamp without time zone") {
    // Prisma SQLite = epoch millisecondes (UTC) → Date JS (exact, sans fuseau)
    return new Date(Number(value));
  }
  return value; // text / integer / double precision : identiques
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const pg = new PrismaClient({ log: ["warn", "error"] });
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  try {
    console.log("═".repeat(64));
    console.log("MIGRATION SQLITE → NEON POSTGRESQL");
    console.log("═".repeat(64));

    // ── 0. Colonnes et types PostgreSQL (source de vérité de la conversion) ──
    const pgColumns: Record<string, PgColumn[]> = {};
    for (const table of ORDER) {
      const cols = (await pg.$queryRawUnsafe(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        table,
      )) as PgColumn[];
      if (cols.length === 0) {
        throw new Error(`Table PostgreSQL manquante : ${table} (lancer bun run db:push)`);
      }
      pgColumns[table] = cols;
    }

    // ── 0bis. Dépendances FK depuis le DDL SQLite + ids parents ──
    const fkDeps: Record<string, FkDep[]> = {};
    const sqliteTables = sqlite
      .query(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string; sql: string }[];
    const ddl = new Map(sqliteTables.map((t) => [t.name, t.sql]));
    for (const table of ORDER) {
      const sqlText = ddl.get(table) ?? "";
      fkDeps[table] = [...sqlText.matchAll(/FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)"/g)].map(
        (m) => ({ col: m[1] as string, ref: m[2] as string }),
      );
    }
    const parentIds: Record<string, Set<string>> = {};
    const referencedTables = new Set(
      Object.values(fkDeps).flatMap((deps) => deps.map((d) => d.ref)),
    );
    for (const table of referencedTables) {
      if (parentIds[table]) continue;
      const ids = sqlite.query(`SELECT id FROM "${table}"`).all() as { id: string }[];
      parentIds[table] = new Set(ids.map((r) => r.id));
    }

    // ── 1. Sécurité : la base Neon doit être vide (sauf --force) ──
    if (force) {
      console.log("→ --force : vidage des tables Neon…");
      await pg.$executeRawUnsafe(
        `TRUNCATE TABLE ${ORDER.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
      );
    } else {
      for (const table of ORDER) {
        const [{ n }] = (await pg.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS n FROM "${table}"`,
        )) as { n: number }[];
        if (n > 0) {
          throw new Error(
            `Table ${table} contient déjà ${n} ligne(s) sur Neon. ` +
              `Base non vide — utiliser --force pour écraser.`,
          );
        }
      }
    }

    // ── 2. Copie dans une transaction unique (tout ou rien) ──
    const report: { table: string; sqlite: number; copied: number; cleaned: number }[] = [];
    let totalCopied = 0;
    let totalCleaned = 0;

    await pg.$transaction(
      async (tx) => {
        for (const table of ORDER) {
          const allRows = sqlite.query(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
          const cols = pgColumns[table];
          const colNames = cols.map((c) => c.column_name);
          const colInfo = new Map(cols.map((c) => [c.column_name, c]));

          // Nettoyage des références orphelines (historique SQLite sans FK strict)
          let cleaned = 0;
          const rows: Record<string, unknown>[] = [];
          for (const row of allRows) {
            let keep = true;
            const fixed = { ...row };
            for (const dep of fkDeps[table] ?? []) {
              const value = fixed[dep.col];
              if (value === null || value === undefined) continue;
              if (parentIds[dep.ref]?.has(String(value))) continue; // référence valide
              const nullable = colInfo.get(dep.col)?.is_nullable === "YES";
              if (nullable) {
                fixed[dep.col] = null;
                cleaned++;
                console.warn(
                  `  ⚠ ${table}.${dep.col} : référence orpheline « ${value} » → NULL`,
                );
              } else {
                keep = false;
                console.warn(
                  `  ⚠ ${table} : ligne écartée (référence orpheline ${dep.col} → ${value}, colonne NOT NULL)`,
                );
              }
            }
            if (keep) rows.push(fixed);
          }

          if (rows.length > 0) {
            // Construction par lots de 50 lignes : INSERT ... VALUES (...),(...),...
            const BATCH = 50;
            for (let i = 0; i < rows.length; i += BATCH) {
              const slice = rows.slice(i, i + BATCH);
              const tuples: string[] = [];
              const params: unknown[] = [];
              slice.forEach((row) => {
                const placeholders = colNames.map((col) => {
                  const info = cols.find((c) => c.column_name === col)!;
                  const raw = row[col] ?? null;
                  params.push(convert(raw, info.data_type));
                  return `$${params.length}`;
                });
                tuples.push(`(${placeholders.join(", ")})`);
              });
              const sql =
                `INSERT INTO "${table}" (${colNames.map((c) => `"${c}"`).join(", ")}) VALUES ` +
                tuples.join(", ");
              await tx.$executeRawUnsafe(sql, ...params);
            }
          }

          const [{ n }] = (await tx.$queryRawUnsafe(
            `SELECT COUNT(*)::int AS n FROM "${table}"`,
          )) as { n: number }[];
          if (n !== rows.length) {
            throw new Error(
              `Incohérence ${table} : ${rows.length} lignes SQLite → ${n} sur Neon`,
            );
          }
          report.push({ table, sqlite: allRows.length, copied: n, cleaned });
          totalCopied += n;
          totalCleaned += cleaned;
          const note = cleaned > 0 ? ` (+${cleaned} réf. orpheline(s) nettoyée(s))` : "";
          console.log(
            `  ✓ ${table.padEnd(20)} ${String(allRows.length).padStart(4)} ligne(s)${note}`,
          );
        }
      },
      { timeout: 120_000 },
    );

    // ── 3. Contrôles métier post-migration (hors transaction, lecture seule) ──
    const checks: { label: string; sql: string; expected: (n: number) => boolean }[] = [
      {
        label: "Comptes clés (admin, superadmin, client démo, chauffeur)",
        sql: `SELECT COUNT(*)::int AS n FROM "User" WHERE email IN
                ('geormakoma1+admin@gmail.com','geormakoma1+superadmin@gmail.com','geormakoma1+demo-client@gmail.com','geormakoma1+chauffeur@gmail.com')`,
        expected: (n) => n === 4,
      },
      {
        label: "Réservations avec référence (NZK-…)",
        sql: `SELECT COUNT(*)::int AS n FROM "Booking" WHERE "bookingReference" LIKE 'NZK-%'`,
        expected: (n) => n >= 5,
      },
      {
        label: "Sessions de suivi GPS conservées",
        sql: `SELECT COUNT(*)::int AS n FROM "TrackingSession"`,
        expected: (n) => n >= 1,
      },
      {
        label: "Comptes fidélité liés à un utilisateur",
        sql: `SELECT COUNT(*)::int AS n FROM "LoyaltyAccount" WHERE "userId" IS NOT NULL`,
        expected: (n) => n >= 1,
      },
    ];

    console.log("─".repeat(64));
    let checksOk = true;
    for (const check of checks) {
      const [{ n }] = (await pg.$queryRawUnsafe(check.sql)) as { n: number }[];
      const ok = check.expected(n);
      checksOk = checksOk && ok;
      console.log(`  ${ok ? "✓" : "✗"} ${check.label} : ${n}`);
    }

    console.log("═".repeat(64));
    console.log(
      `${checksOk ? "✅ MIGRATION RÉUSSIE" : "⚠️  MIGRATION TERMINÉE AVEC ANOMALIES"} — ` +
        `${totalCopied} lignes copiées sur ${ORDER.length} tables` +
        `${totalCleaned > 0 ? `, ${totalCleaned} référence(s) orpheline(s) nettoyée(s)` : ""}.`,
    );
    if (!checksOk) process.exitCode = 1;
  } finally {
    sqlite.close();
    await pg.$disconnect();
  }
}

main().catch((error) => {
  console.error("❌ ÉCHEC DE LA MIGRATION :", error);
  process.exit(1);
});
