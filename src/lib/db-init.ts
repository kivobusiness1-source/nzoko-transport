import { db } from "@/lib/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ============================================================
// NZOKO TRANSPORT — Initialisation automatique de la base
// ------------------------------------------------------------
// Objectif : dézipper → installer → `npm run dev` (ou bun) → ça marche.
// Sans ces commandes manuelles (db:push + seed) oubliées, l'app
// démarrait avec une base vide : connexion impossible, villes absentes.
//
// Appelé une fois au démarrage du serveur (src/instrumentation.ts).
//  1. Sonde rapide : la table User répond-elle ? → rien à faire.
//  2. Sinon : `prisma db push` (création du schéma) puis seed de
//     production (référentiel minimal + compte admin aléatoire).
// ============================================================

function isPrismaTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return (
    e?.code === "P2021" || // table does not exist
    e?.code === "P2022" || // column does not exist
    Boolean(e?.message?.includes("does not exist")) ||
    Boolean(e?.message?.includes("no such table"))
  );
}

/** Chemin du CLI Prisma dans node_modules (dev et démarrage standard). */
function prismaCliPath(): string {
  return path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
}

/** Vérifie que la base est initialisée (schéma + données). */
export async function isDatabaseReady(): Promise<boolean> {
  try {
    const count = await db.user.count();
    return count > 0;
  } catch (err) {
    if (isPrismaTableError(err)) return false;
    throw err; // autre problème (fichier verrouillé, corrompu…) : laisser remonter
  }
}

/**
 * Crée le schéma puis charge les données initiales de production.
 * Ne fait RIEN si la base est déjà prête (chemin rapide, ~5 ms).
 */
export async function ensureDatabaseReady(): Promise<void> {
  try {
    if (await isDatabaseReady()) return; // base déjà prête
  } catch {
    /* sonde infructueuse → tenter l'initialisation */
  }

  console.log("🛠  [db-init] Base de données absente — initialisation automatique (≈15 s, une seule fois)…");

  const { stdout, stderr } = await execFileAsync(
    process.execPath, // node ou bun — les deux exécutent le CLI Prisma
    [prismaCliPath(), "db", "push", "--schema", path.join(process.cwd(), "prisma", "schema.prisma"), "--accept-data-loss"],
    { timeout: 120_000 }
  ).catch((err) => {
    console.error("❌ [db-init] prisma db push a échoué :", err.message);
    throw err;
  });
  if (stdout) console.log(stdout.trim());
  if (stderr) console.error(stderr.trim());

  console.log("🌱 [db-init] Schéma créé — chargement des données initiales (production)…");
  // prisma/seed.ts s'exécute à l'IMPORT (main() top-level, client Prisma
  // dédié) — il n'exporte pas de fonction : l'import suffit.
  await import("../../prisma/seed");
  console.log("✅ [db-init] Base initialisée — identifiants de l'administrateur affichés ci-dessus.");
}
