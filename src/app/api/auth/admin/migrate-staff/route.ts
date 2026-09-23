// POST /api/auth/admin/migrate-staff — MIGRATION PROACTIVE des comptes
// internes NZOKO vers Neon Auth.
//
// Jusqu'ici les comptes staff étaient importés « à la volée » : à la
// PREMIÈRE connexion de chacun (pont /api/auth/login : bcrypt local →
// compte Neon). Cette route exécute la migration pour TOUS les comptes
// internes d'un coup, afin que la connexion soit DIRECTE (signIn.email
// Neon → exchange) sans jamais passer par le pont :
//
//  pour chaque compte interne (superadmin, admin, manager, agent,
//  checker, comptable, chauffeur, support) :
//   1. MODERNISATION de l'e-mail local : la base de production migrée
//      porte les ANCIENS e-mails @nzoko.cg — ils sont renommés vers la
//      convention actuelle (geormakoma1+<role>@gmail.com) pour que le
//      miroir d'échange (/api/neon-auth/exchange) adopte le bon compte
//      staff (rôle + permissions conservés) dès la première connexion ;
//   2. ALIGNEMENT du mot de passe : le mot de passe officiel (identique
//      aux seeds prisma/seed.ts) est imposé côté local (bcrypt) ;
//   3. IMPORT côté Neon Auth : admin/create-user (e-mail + mot de passe
//      + emailVerified:true) ou, si le compte existe déjà, alignement
//      du mot de passe + état vérifié (idempotent, ré-exécutable).
//
// Sécurité :
//  - secret partagé obligatoire : en-tête « x-migration-key » strictement
//    égal à NEON_AUTH_SERVICE_PASSWORD (comparaison en temps constant) ;
//  - x-requested-with: nzoko (assertSameOriginPost) comme toutes les
//    routes POST mutantes ;
//  - rate limit dédié + journal d'audit ADMIN_ACTION (aucun mot de passe
//    n'y figure — transmis au service Neon puis oublié) ;
//  - dry-run (charge { "dryRun": true }) : lecture seule TOTALE (aucune
//    écriture base locale, aucun appel Neon) pour auditer avant d'agir.
//
// Ré-exécution sûre : chaque étape est idempotente (e-mail déjà moderne →
// no-op, bcrypt déjà aligné → no-op, compte Neon existant → alignement).

import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import {
  ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost,
} from "@/lib/api-response";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS, SHORT_ID_EMAILS, LEGACY_EMAIL_ALIASES } from "@/lib/constants";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { neonAuthMode, isNeonAuthEnabled } from "@/lib/neon-auth/server";
import { importNeonAccount, isNeonServiceAccount, isNeonServiceConfigured } from "@/lib/neon-auth/service-account";
import { db } from "@/lib/db";

// Mots de passe officiels des comptes internes — IDENTIQUES aux seeds
// (prisma/seed.ts, dépôt privé) et à la liste validée par le propriétaire.
// La migration impose CES identifiants : après exécution, la connexion est
// identifiant court (ex. « superadmin ») + ce mot de passe, côté Neon Auth.
const STAFF_MIGRATION_PASSWORDS: Record<string, string> = {
  superadmin: "Nzoko@2026!",
  admin: "Admin@2026!",
  manager: "Manager@2026!",
  agent: "Agent@2026!",
  checker: "Checker@2026!",
  comptable: "Compta@2026!",
  chauffeur: "Chauffeur@2026!",
  support: "Support@2026!",
};

const bodySchema = z
  .object({ dryRun: z.boolean().optional() })
  .default({});

/** Comparaison en temps constant du secret de migration fourni. */
function migrationKeyOk(provided: string): boolean {
  const expected = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";
  if (!expected || !provided || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

interface MigrationEntry {
  shortId: string;
  email: string;
  status: "migrated" | "already-ok" | "error";
  localSource: "modern" | "legacy-modernized" | "parasite-cleaned" | "not-found";
  emailModernized: boolean;
  bcryptAligned: "ok" | "aligned" | "n/a";
  neon: "imported" | "aligned" | "pending" | "failed" | "skipped";
  neonUserId: string | null;
  role: string | null;
  isActive: boolean | null;
  error?: string;
}

/**
 * Supprime un miroir parasite (compte PASSENGER créé par erreur sous
 * l'e-mail moderne alors que le vrai staff existe sous l'alias legacy).
 * Best-effort : si des dépendances métier inattendues existent, la
 * suppression échoue proprement et le compte est signalé au rapport.
 */
async function removeParasiteMirror(userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
  await db.notification.deleteMany({ where: { userId } });
  const loyalty = await db.loyaltyAccount.findUnique({ where: { userId } });
  if (loyalty) {
    await db.loyaltyTransaction.deleteMany({ where: { accountId: loyalty.id } });
    await db.loyaltyAccount.delete({ where: { id: loyalty.id } });
  }
  await db.favoriteRoute.deleteMany({ where: { userId } });
  // Échoue (FK) si des données métier réelles sont rattachées → signalé.
  await db.user.delete({ where: { id: userId } });
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);

    if (!migrationKeyOk(req.headers.get("x-migration-key") ?? "")) {
      await logSecurity({
        event: "ACCESS_DENIED",
        ipAddress: ip,
        userAgent: getUserAgent(req),
        details: { reason: "clé de migration invalide/absente", route: "migrate-staff" },
      });
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Clé de migration invalide ou absente.");
    }

    enforceRateLimit(`staff-migration:${ip}`, RATE_LIMITS.staffMigration.limit, RATE_LIMITS.staffMigration.windowMs);

    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const dryRun = body.dryRun === true;

    if (!dryRun && (neonAuthMode !== "neon" || !isNeonAuthEnabled || !isNeonServiceConfigured)) {
      throw new ApiError(
        503,
        "SERVICE_UNAVAILABLE",
        "La migration ne peut s'exécuter qu'en mode Neon Auth configuré (NEON_AUTH_MODE=neon + compte de service). Utilisez dryRun pour un audit en lecture seule."
      );
    }

    const results: MigrationEntry[] = [];

    for (const [shortId, password] of Object.entries(STAFF_MIGRATION_PASSWORDS)) {
      const email = SHORT_ID_EMAILS[shortId] ?? `${shortId}@nzoko.invalid`;
      const entry: MigrationEntry = {
        shortId,
        email,
        status: "error",
        localSource: "not-found",
        emailModernized: false,
        bcryptAligned: "n/a",
        neon: "skipped",
        neonUserId: null,
        role: null,
        isActive: null,
      };

      try {
        if (isNeonServiceAccount(email)) {
          entry.status = "already-ok";
          entry.localSource = "modern";
          entry.error = "compte de service — jamais migré";
          results.push(entry);
          continue;
        }

        // ---------- 1. Compte local (e-mail moderne OU alias legacy) ----------
        const legacyEmail = LEGACY_EMAIL_ALIASES[email] ?? null;
        const modern = await db.user.findUnique({ where: { email }, include: { role: true } });
        const legacy = legacyEmail
          ? await db.user.findUnique({ where: { email: legacyEmail }, include: { role: true } })
          : null;

        let localUser = modern;

        if (modern && legacy) {
          // Cas pathologique : un miroir parasite (client) occupe l'e-mail
          // moderne alors que le vrai staff est encore sous l'alias legacy.
          if (modern.role.code !== "PASSENGER") {
            throw new Error(
              `conflit : deux comptes non-passagers portent les e-mails moderne (${email}) et legacy (${legacyEmail}) — résolution manuelle requise`
            );
          }
          if (dryRun) {
            entry.localSource = "parasite-cleaned";
            entry.emailModernized = true;
            entry.role = legacy.role.code;
            entry.isActive = legacy.isActive;
            entry.neon = "pending";
            entry.status = "migrated";
            entry.error = `dry-run : parasite ${email} à nettoyer puis modernisation de ${legacyEmail}`;
            results.push(entry);
            continue;
          }
          await removeParasiteMirror(modern.id);
          const renamed = await db.user.update({
            where: { id: legacy.id },
            data: { email },
            include: { role: true },
          });
          localUser = renamed;
          entry.localSource = "parasite-cleaned";
          entry.emailModernized = true;
        } else if (modern) {
          entry.localSource = "modern";
        } else if (legacy) {
          if (!dryRun) {
            await db.user.update({ where: { id: legacy.id }, data: { email } });
          }
          localUser = legacy;
          entry.localSource = "legacy-modernized";
          entry.emailModernized = true;
        } else {
          throw new Error(`compte local introuvable (ni ${email} ni ${legacyEmail ?? "aucun alias"})`);
        }

        const user = localUser as NonNullable<typeof localUser>;
        entry.role = user.role.code;
        entry.isActive = user.isActive;

        // ---------- 2. Alignement bcrypt local (mot de passe officiel) ----------
        const bcryptOk = await verifyPassword(password, user.passwordHash);
        if (bcryptOk) {
          entry.bcryptAligned = "ok";
        } else if (dryRun) {
          entry.bcryptAligned = "aligned"; // serait aligné
          entry.error = (entry.error ? `${entry.error} ; ` : "") + "dry-run : bcrypt divergent, serait réaligné";
        } else {
          await db.user.update({
            where: { id: user.id },
            data: { passwordHash: await hashPassword(password) },
          });
          entry.bcryptAligned = "aligned";
        }

        // ---------- 3. Import / alignement Neon Auth ----------
        if (dryRun) {
          entry.neon = "pending";
          entry.status = "migrated";
        } else {
          const imported = await importNeonAccount({
            email,
            password,
            name: `${user.firstName} ${user.lastName}`.trim(),
            phone: user.phone,
          });
          entry.neon = imported.imported ? "imported" : "aligned";
          entry.neonUserId = imported.neonUserId;
          entry.status = imported.imported ? "migrated" : "already-ok";
        }
      } catch (err) {
        entry.status = "error";
        entry.neon = entry.neon === "skipped" ? "skipped" : "failed";
        entry.error = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      }

      results.push(entry);
    }

    const success = results.filter((r) => r.status !== "error").length;
    await logSecurity({
      event: "ADMIN_ACTION",
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: {
        action: "migrate-staff",
        dryRun,
        total: results.length,
        success,
        failed: results.length - success,
        accounts: results.map((r) => ({ shortId: r.shortId, status: r.status, localSource: r.localSource, neon: r.neon })),
      },
    });

    return ok({
      dryRun,
      mode: neonAuthMode,
      summary: { total: results.length, success, failed: results.length - success },
      results,
    });
  } catch (err) {
    return routeError(err, "POST /api/auth/admin/migrate-staff");
  }
}
