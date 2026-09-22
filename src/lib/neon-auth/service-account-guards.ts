import { db } from "@/lib/db";

// ============================================================
// NZOKO TRANSPORT — Garde-fou du COMPTE DE SERVICE Neon Auth
// (auto-configuration au démarrage)
// ------------------------------------------------------------
// Contexte (2026-09-22, cf. worklog Task 41) : le compte de service
// (NEON_AUTH_SERVICE_EMAIL — outil de provisioning des comptes staff
// et clients) était resté « e-mail non vérifié » et « non admin »
// chez Neon Auth :
//   - son sign-in → 403 « Email not verified » ;
//   - ses appels /admin/* (createUser…) → refusés sans rôle admin.
// Conséquence en production : AUCUN compte interne ne pouvait être
// importé vers Neon Auth (502 sur le pont /api/auth/login), donc
// aucune connexion staff possible.
//
// Les actions équivalentes existent dans la console Neon (Auth →
// Users → ⋮ → Verify email / Make admin) mais n'ont jamais pu être
// réalisées maniquement (fenêtre OTP trop courte, actions répétées
// à effectuer). Neon Auth étant MANAGÉ DANS LA MÊME BASE Postgres
// que l'application (schéma neon_auth — cf. documentation Neon :
// « users, sessions, and auth config live in the neon_auth schema
// on the branch's database »), ce garde-fou applique au démarrage
// l'équivalent SQL de ces deux actions :
//   UPDATE neon_auth.<table utilisateurs>
//      SET <vérifié> = true, role = 'admin'
//    WHERE email = <NEON_AUTH_SERVICE_EMAIL>
//      AND (<vérifié> IS NOT true OR role IS DISTINCT FROM 'admin');
//
// Sécurité :
//  - cible UNIQUEMENT l'e-mail du compte de service (variable serveur,
//    jamais d'entrée utilisateur) ;
//  - strictement additif (vérifié=true, role='admin' — jamais l'inverse),
//    idempotent, AUCUNE autre ligne n'est touchée ;
//  - le rôle « admin » Neon Auth ne confère AUCUN droit applicatif
//    NZOKO (les rôles métier vivent dans la base NZOKO — User.roleId,
//    relus côté serveur à chaque requête) et le compte de service est
//    REFUSÉ comme session utilisateur (isNeonServiceAccount — pont
//    d'import et /api/neon-auth/exchange) ;
//  - ne fait rien sur SQLite (sandbox) ni si le schéma neon_auth est
//    absent (base non concernée) ;
//  - tout échec est journalisé et NON FATAL (l'app démarre toujours).
// ============================================================

/** Garde mémoire : une vérification par instance de serveur. */
let checked = false;

/** Colonnes candidates pour l'état de vérification (casse variable). */
const VERIFIED_COLUMN_CANDIDATES = new Set(["emailverified", "email_verified"]);

/**
 * Résultat du dernier passage du garde-fou — diagnostic d'INFRASTRUCTURE
 * (aucune donnée utilisateur, aucun secret) exposé par /api/auth/providers
 * pour piloter l'exploitation (ex. savoir si le schéma neon_auth est
 * joignable depuis la base applicative).
 */
export interface NeonServiceGuardReport {
  status:
    | "disabled" // pas de base Postgres / pas de compte de service configuré
    | "schema-absent" // schéma neon_auth introuvable dans la base applicative
    | "table-not-found" // schéma présent mais table utilisateurs non identifiée
    | "update-failed" // UPDATE refusé (permissions) ou en erreur
    | "applied" // UPDATE appliqué (≥ 1 ligne) lors de CE démarrage
    | "already-ok"; // déjà vérifié + admin (aucune ligne à modifier)
  /** Tables vues dans le schéma neon_auth (noms seuls — diagnostic). */
  neonAuthTables?: string[];
}

let lastReport: NeonServiceGuardReport = { status: "disabled" };

/** Dernier résultat connu du garde-fou (pour /api/auth/providers). */
export function neonServiceGuardReport(): NeonServiceGuardReport {
  return lastReport;
}

interface ColumnRow {
  table_name: string;
  column_name: string;
}

export async function ensureNeonServiceAccountReady(): Promise<void> {
  if (checked) return;
  checked = true;

  // Sandbox (SQLite) : rien à faire — l'authentification locale n'utilise
  // pas Neon Auth (double schéma prisma/schema.prisma ↔ schema.postgres.prisma).
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) return;

  const serviceEmail = (process.env.NEON_AUTH_SERVICE_EMAIL ?? "").trim().toLowerCase();
  if (!serviceEmail.includes("@") || !serviceEmail.includes(".")) return;

  try {
    // 1. Découverte du schéma neon_auth et de sa table utilisateurs.
    //    (L'intitulé exact varie selon l'installation managée — « user »,
    //    « users », … — de même que la casse des colonnes camelCase.)
    const columns: ColumnRow[] = await db.$queryRawUnsafe(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'neon_auth'`
    );
    if (columns.length === 0) {
      lastReport = { status: "schema-absent", neonAuthTables: [] };
      return; // schéma absent → base non concernée
    }

    const columnsByTable = new Map<string, Set<string>>();
    for (const { table_name, column_name } of columns) {
      let set = columnsByTable.get(table_name);
      if (!set) {
        set = new Set();
        columnsByTable.set(table_name, set);
      }
      set.add(column_name.toLowerCase());
    }
    const tableNames = [...columnsByTable.keys()].sort();

    // Table utilisateurs = possède « email », une colonne de vérification
    // ET une colonne de rôle (les tables session/verification n'ont pas
    // cette combinaison).
    let target: { table: string; verifiedColumn: string; roleColumn: string } | null = null;
    for (const [table, set] of columnsByTable) {
      if (!set.has("email") || !set.has("role")) continue;
      const verified = [...set].find((c) => VERIFIED_COLUMN_CANDIDATES.has(c));
      if (!verified) continue;
      target = { table, verifiedColumn: verified, roleColumn: "role" };
      break;
    }
    if (!target) {
      lastReport = { status: "table-not-found", neonAuthTables: tableNames };
      return; // schéma neon_auth inattendu → no-op documenté
    }

    // 2. Application ciblée. Les identifiants (table, colonnes) proviennent
    //    de l'introspection et l'e-mail d'une variable serveur de confiance
    //    — l'échappement ci-dessous reste une ceinture de sécurité.
    const safeEmail = serviceEmail.replace(/'/g, "''");
    const updated: number = await db.$executeRawUnsafe(
      `UPDATE neon_auth."${target.table}" ` +
        `SET "${target.verifiedColumn}" = true, "${target.roleColumn}" = 'admin' ` +
        `WHERE lower("email") = '${safeEmail}' ` +
        `AND ("${target.verifiedColumn}" IS NOT true OR "${target.roleColumn}" IS DISTINCT FROM 'admin')`
    );

    lastReport = {
      status: updated > 0 ? "applied" : "already-ok",
      neonAuthTables: tableNames,
    };

    if (updated > 0) {
      console.warn(
        `🔧 [neon-auth] Compte de service ${serviceEmail} auto-configuré dans neon_auth ` +
          `(e-mail vérifié + rôle admin) — équivalent console « Verify email » + « Make admin ».`
      );
    }
  } catch (err) {
    // Non fatal : l'app démarre quand même ; le pont d'import continuera
    // de renvoyer son 502 explicite tant que la configuration n'est pas
    // effective (action manuelle console toujours possible).
    lastReport = { status: "update-failed", neonAuthTables: [] };
    console.warn(
      "⚠️  [neon-auth] Auto-configuration du compte de service impossible (non fatal) :",
      err instanceof Error ? err.message : err
    );
  }
}
