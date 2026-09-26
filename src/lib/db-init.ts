import { db } from "@/lib/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ============================================================
// OCÉAN DU NORD — Initialisation automatique de la base
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

  console.warn("🛠  [db-init] Base de données absente — initialisation automatique (≈15 s, une seule fois)…");

  const { stdout, stderr } = await execFileAsync(
    process.execPath, // node ou bun — les deux exécutent le CLI Prisma
    [prismaCliPath(), "db", "push", "--schema", path.join(process.cwd(), "prisma", "schema.prisma"), "--accept-data-loss"],
    { timeout: 120_000 }
  ).catch((err) => {
    console.error("❌ [db-init] prisma db push a échoué :", err.message);
    throw err;
  });
  if (stdout) console.warn(stdout.trim());
  if (stderr) console.error(stderr.trim());

  console.warn("🌱 [db-init] Schéma créé — chargement des données initiales (production)…");
  // prisma/seed.ts s'exécute à l'IMPORT (main() top-level, client Prisma
  // dédié) — il n'exporte pas de fonction : l'import suffit.
  await import("../../prisma/seed");
  console.warn("✅ [db-init] Base initialisée — identifiants de l'administrateur affichés ci-dessus.");
}

// ============================================================
// Synchronisation de la MATRICE DE PERMISSIONS (RBAC)
// ------------------------------------------------------------
// Les permissions effectives vivent en base (RolePermission) mais
// la source de vérité MÉTIER est la matrice ROLE_PERMISSIONS du
// code. Au démarrage, on garantit que chaque rôle possède au
// minimum ses permissions matricielles (ajout seul — JAMAIS de
// révocation automatique : un droit accordé manuellement en base
// reste). Idempotent et sans coût au runtime.
// ============================================================
export async function ensureRolePermissionMatrix(): Promise<void> {
  const { ROLE_PERMISSIONS } = await import("./constants");
  try {
    const [roles, permissions, existing] = await Promise.all([
      db.role.findMany({ select: { id: true, code: true } }),
      db.permission.findMany({ select: { id: true, code: true } }),
      db.rolePermission.findMany({ select: { roleId: true, permissionId: true } }),
    ]);
    const roleByCode = new Map(roles.map((r) => [r.code, r.id]));
    const permByCode = new Map(permissions.map((p) => [p.code, p.id]));
    const existingPairs = new Set(existing.map((rp) => `${rp.roleId}:${rp.permissionId}`));
    const rows: { roleId: string; permissionId: string }[] = [];
    for (const [roleCode, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = roleByCode.get(roleCode);
      if (!roleId) continue;
      for (const permCode of perms) {
        const permissionId = permByCode.get(permCode);
        if (!permissionId) continue;
        if (!existingPairs.has(`${roleId}:${permissionId}`)) rows.push({ roleId, permissionId });
      }
    }
    if (rows.length) {
      // NB : skipDuplicates non supporté sur SQLite — le pré-filtrage
      // `existingPairs` ci-dessus assure déjà l'idempotence.
      await db.rolePermission.createMany({ data: rows });
      // eslint-disable-next-line no-console -- journal de démarrage volontaire
      console.log(`[rbac] ${rows.length} permission(s) manquante(s) synchronisée(s) depuis la matrice.`);
    }
  } catch (err) {
    // Non bloquant : l'app démarre, les rôles conservent leurs droits actuels.
    console.warn("[rbac] synchronisation de la matrice ignorée :", err instanceof Error ? err.message : err);
  }
}
