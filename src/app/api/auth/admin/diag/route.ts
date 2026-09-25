// GET /api/auth/admin/diag — DIAGNOSTIC d'infrastructure Neon Auth.
//
// Compare l'état réel des tables managées (schéma neon_auth de la base
// applicative) avec ce que le SERVICE Neon Auth renvoie — pour piloter
// la configuration (rôles admin, vérification des e-mails, synchro).
//
// Protégé par le même secret partagé que la migration (x-migration-key =
// NEON_AUTH_SERVICE_PASSWORD, comparaison en temps constant).
// ⚠️ EN-TÊTE UNIQUEMENT : le secret en paramètre d'URL est REFUSÉ — une
// URL contenant un secret fuit (journaux serveur, historique navigateur,
// Referer). (OWASP Secrets Management)
//
// Lecture seule : AUCUNE écriture. Données exposées : e-mail, rôle,
// vérification, dates des comptes du schéma managé (aucun secret, aucun
// hash, aucun mot de passe).

import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp } from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/constants";
import { logSecurity } from "@/lib/audit";
import { neonAuthBaseUrl } from "@/lib/neon-auth/server";
import { db } from "@/lib/db";

function migrationKeyOk(provided: string): boolean {
  const expected = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";
  if (!expected || !provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    enforceRateLimit(`auth-diag:${ip}`, RATE_LIMITS.public.limit, RATE_LIMITS.public.windowMs);
    const key = req.headers.get("x-migration-key") ?? "";
    if (!migrationKeyOk(key)) {
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Clé de diagnostic invalide ou absente.");
    }

    const url = process.env.DATABASE_URL ?? "";
    if (!/^postgres(ql)?:\/\//.test(url)) {
      return ok({ env: "sandbox-sqlite", note: "Diagnostic Neon Auth pertinent uniquement sur la base Postgres de production." });
    }

    // 1. Introspection du schéma neon_auth : tables + colonnes de la table user
    let columns: Array<{ table_name: string; column_name: string }> = [];
    try {
      columns = await db.$queryRawUnsafe(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'neon_auth' ORDER BY table_name, ordinal_position`
      );
    } catch (err) {
      return ok({ step: "introspection", error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    }

    const userTable = [...new Set(columns.map((c) => c.table_name))].find(
      (t) =>
        columns.some((c) => c.table_name === t && c.column_name === "email") &&
        columns.some((c) => c.table_name === t && c.column_name === "role") &&
        // différencie « user » de « invitation » (email+role aussi) : la
        // table utilisateurs possède une colonne de vérification d'e-mail.
        columns.some(
          (c) =>
            c.table_name === t &&
            (c.column_name.toLowerCase() === "emailverified" || c.column_name.toLowerCase() === "email_verified")
        )
    );

    if (!userTable) {
      return ok({ tables: [...new Set(columns.map((c) => c.table_name))], note: "Table utilisateurs non identifiée." });
    }

    const col = (name: string) =>
      columns.find((c) => c.table_name === userTable && c.column_name.toLowerCase() === name)?.column_name ?? name;

    const verifiedCol =
      columns.find((c) => c.table_name === userTable && c.column_name.toLowerCase() === "emailverified")?.column_name ??
      columns.find((c) => c.table_name === userTable && c.column_name.toLowerCase() === "email_verified")?.column_name ??
      "emailVerified";
    const updatedAtCol = col("updatedat");
    const createdAtCol = col("createdat");

    // 2. Lecture des comptes managés (e-mail, rôle, vérification, dates)
    let users: Array<Record<string, unknown>> = [];
    let usersError: string | null = null;
    try {
      users = await db.$queryRawUnsafe(
      `SELECT "${col("email")}" AS email, "${col("role")}" AS role, "${verifiedCol}" AS "emailVerified", ` +
        `"${col("id")}" AS id, "${createdAtCol}" AS "createdAt", "${updatedAtCol}" AS "updatedAt" ` +
        `FROM neon_auth."${userTable}" ORDER BY "${updatedAtCol}" DESC LIMIT 40`
      );
    } catch (err) {
      usersError = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    }

    // 3. Sonde du service Auth (même origine S2S que le compte de service)
    let serviceProbe: Record<string, unknown> = { note: "sonde désactivée" };
    try {
      const healthRes = await fetch(`${neonAuthBaseUrl}/ok`, {
        headers: { Origin: process.env.NEON_SERVICE_ORIGIN?.trim() || "http://localhost:3000" },
        cache: "no-store",
      });
      serviceProbe = { ok: healthRes.status === 200, status: healthRes.status };
    } catch (err) {
      serviceProbe = { error: err instanceof Error ? err.message.slice(0, 120) : "échec" };
    }

    logSecurity({
      event: "ADMIN_ACTION",
      ipAddress: ip,
      details: { action: "diag-neon-auth", userTable, count: users.length },
    });

    return ok({
      userTable,
      tables: [...new Set(columns.map((c) => c.table_name))],
      userColumns: columns.filter((c) => c.table_name === userTable).map((c) => c.column_name),
      users,
      usersError,
      serviceProbe,
    });
  } catch (err) {
    return routeError(err, "GET /api/auth/admin/diag");
  }
}
