// POST /api/auth/login — { identifier, password } → SessionUser + cookie nzoko_session
// identifier : adresse e-mail OU numéro de téléphone (E.164, national, +242…).
//
// MODE NEON (production, NEON_AUTH_MODE=neon) — PONT D'IMPORT À LA VOLÉE :
//  l'authentification elle-même vit chez Neon Auth (le client appelle
//  signIn.email via le proxy /api/auth/sign-in/email, puis échange la
//  session via /api/neon-auth/exchange). Cette route n'est plus qu'un
//  PONT DE MIGRATION : quand Neon répond « identifiants inconnus » et
//  que l'identifiant correspond à un compte interne Océan du Nord dont le mot
//  passe local bcrypt est correct, le compte est importé vers Neon
//  (même mot de passe) — migration transparente, zéro friction, zéro
//  utilisateur perdu. Aucune session locale n'est délivrée ici.
//
// MODE LOCAL (sandbox/développement, NEON_AUTH_MODE=local) : bcrypt,
// comportement historique inchangé (mode Supabase dormant conservé).
// Rate limit par ip+identifiant, messages génériques (aucune fuite).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost } from "@/lib/api-response";
import { createSession, setSessionCookie, verifyPassword, externalAuthProvider } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS, SHORT_ID_EMAILS, LEGACY_EMAIL_CHAINS, canonicalStaffEmail } from "@/lib/constants";
import { normalizePhone } from "@/lib/phone";
import { isNeonAuthEnabled, neonAuthMode } from "@/lib/neon-auth/server";
import { importNeonAccount, isNeonServiceAccount, isNeonServiceConfigured } from "@/lib/neon-auth/service-account";
import { isSupabaseEnabled, supabase, upsertClientMirror, mirrorDataFromSupabase } from "@/services/supabase-auth";
import { db } from "@/lib/db";
import type { PermissionCode, RoleCode } from "@/lib/constants";

const loginSchema = z
  .object({
    identifier: z.string().trim().max(120).optional(),
    email: z.string().trim().max(120).optional(), // rétro-compatibilité { email, password }
    password: z.string().min(1, "Mot de passe requis."),
  })
  .refine((v) => Boolean(v.identifier && v.identifier.length >= 3) || Boolean(v.email && v.email.length >= 3), {
    message: "Identifiant requis.",
  });

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    const body = loginSchema.parse(await req.json().catch(() => null));

    // Identifiant de travail : nouveau champ `identifier`, sinon `email` (ancien)
    const rawIdentifier = (body.identifier ?? body.email ?? "").trim();

    // Adresse e-mail, téléphone normalisé E.164, OU identifiant court interne
    // (ex. « superadmin ») complété automatiquement vers l'e-mail réel du
    // compte (ex. geormakoma1+superadmin@gmail.com).
    // La complétion ne crée rien : elle ne fait que résoudre un alias vers un
    // compte déjà existant — aucun risque d'énumération (message générique).
    const isEmail = rawIdentifier.includes("@");
    const phone = isEmail ? null : normalizePhone(rawIdentifier);
    const completedEmail = !isEmail && !phone && /^[a-z0-9._-]{3,}$/i.test(rawIdentifier)
      ? SHORT_ID_EMAILS[rawIdentifier.toLowerCase()] ?? null
      : null;
    const lookupEmail = isEmail
      ? rawIdentifier.toLowerCase()
      : completedEmail;
    const lookupPhone = phone;

    if (!lookupEmail && !lookupPhone) {
      throw new ApiError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Identifiant non reconnu. Utilisez votre adresse e-mail (ex. geormakoma1+superadmin@gmail.com), votre identifiant court (ex. superadmin) ou votre numéro de téléphone (ex. 06 123 45 67)."
      );
    }

    // Rate limit anti brute-force, clé ip + identifiant canonique
    const rateKey = `login:${ip}:${lookupEmail ?? lookupPhone}`;
    enforceRateLimit(rateKey, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

    // ============================================================
    // 1. MODE NEON — pont d'import (bcrypt local → compte Neon)
    // ============================================================
    if (neonAuthMode === "neon" && isNeonAuthEnabled) {
      return await handleMigrationBridge({ lookupEmail, lookupPhone, password: body.password, ip, req });
    }

    // ============================================================
    // 2. MODE SUPABASE (dormant) — comptes clients historiques
    // ============================================================
    if (isSupabaseEnabled) {
      const { data, error } = await supabase().auth.signInWithPassword(
        lookupEmail ? { email: lookupEmail, password: body.password } : { phone: lookupPhone ?? "", password: body.password }
      );

      if (!error && data.user) {
        const su = data.user;
        const email = (su.email ?? lookupEmail ?? `${su.id}@supabase.nzoko.cg`).toLowerCase();
        const { firstName, lastName, phone: metaPhone } = mirrorDataFromSupabase(su);

        if (!metaPhone) {
          throw new ApiError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            "Votre compte Supabase n'a pas de téléphone Océan du Nord associé. Contactez le support pour finaliser votre compte client."
          );
        }

        // Miroir local : trouvé par supabaseId/email, sinon provisionné
        const mirror = await upsertClientMirror({
          supabaseId: su.id,
          email,
          phone: metaPhone,
          firstName,
          lastName,
        });

        const user = await db.user.findUnique({
          where: { id: mirror.id },
          include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
        });
        if (!user || !user.isActive) {
          throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Compte indisponible.");
        }
        if (user.role.code !== "PASSENGER") {
          // Un miroir interne (staff) ne doit jamais passer par Supabase
          await logSecurity({
            event: "ACCESS_DENIED",
            userId: user.id,
            email: user.email,
            ipAddress: ip,
            userAgent: getUserAgent(req),
            details: { reason: "compte interne via Supabase", method: "supabase" },
          });
          throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce compte doit utiliser la connexion interne (mot de passe Océan du Nord).");
        }

        const { token, expiresAt } = await createSession(user.id, ip, getUserAgent(req));
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        await logSecurity({
          event: "LOGIN_SUCCESS",
          userId: user.id,
          email: user.email,
          ipAddress: ip,
          userAgent: getUserAgent(req),
          details: { method: "supabase", mirrorCreated: mirror.created },
        });

        const sessionUser = {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          email: user.email,
          phone: user.phone,
          role: user.role.code as RoleCode,
          roleLabel: user.role.name,
          agencyId: user.agencyId,
          agencyName: user.agency?.name ?? null,
          authProvider: "SUPABASE" as const,
          permissions: user.role.permissions
            .map((rp) => rp.permission.code)
            .filter((c): c is PermissionCode => Boolean(c)),
        };

        const res = ok(sessionUser);
        return setSessionCookie(res, token, expiresAt);
      }
      // Identifiants Supabase invalides → on continue vers le login local
      // (comptes internes Océan du Nord : admin, guichet, agence…).
    }

    // ============================================================
    // 3. LOGIN LOCAL — bcrypt (mode sandbox/développement)
    // ============================================================
    const user = lookupEmail
      ? await db.user.findUnique({
          where: { email: lookupEmail },
          include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
        })
      : await db.user.findFirst({
          where: { phone: lookupPhone ?? undefined },
          include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
        });

    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;

    if (!user || !user.isActive || !valid) {
      await logSecurity({
        event: "LOGIN_FAILED",
        email: lookupEmail ?? undefined,
        userId: user?.id ?? null,
        ipAddress: ip,
        userAgent: getUserAgent(req),
        details: {
          reason: !user ? "compte inconnu" : user.isActive ? "mot de passe invalide" : "compte désactivé",
          method: lookupEmail ? "email" : "phone",
        },
      });
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Identifiants incorrects.");
    }

    const { token, expiresAt } = await createSession(user.id, ip, getUserAgent(req));
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await logSecurity({
      event: "LOGIN_SUCCESS",
      userId: user.id,
      email: user.email,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: { method: lookupEmail ? "email" : "phone" },
    });

    const sessionUser = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      phone: user.phone,
      role: user.role.code as RoleCode,
      roleLabel: user.role.name,
      agencyId: user.agencyId,
      agencyName: user.agency?.name ?? null,
      authProvider: externalAuthProvider(user),
      permissions: user.role.permissions
        .map((rp) => rp.permission.code)
        .filter((c): c is PermissionCode => Boolean(c)),
    };

    const res = ok(sessionUser);
    return setSessionCookie(res, token, expiresAt);
  } catch (err) {
    return routeError(err, "POST /api/auth/login");
  }
}

// ============================================================
// Pont d'import : compte interne existant → compte Neon Auth
// ============================================================
// Pré-conditions (vérifiées APRÈS validation bcrypt locale) :
//  - le compte local existe et est actif ;
//  - ce n'est pas le compte de service ;
//  - le compte de service Neon est configuré.
// Le mot de passe validé est transmis au service Neon (admin.createUser
// ou alignement) puis OUBLIÉ — jamais journalisé, jamais stocké.
// Aucune session n'est délivrée ici : le client enchaîne signIn.email
// (SDK, session Neon) puis /api/neon-auth/exchange.

async function handleMigrationBridge(input: {
  lookupEmail: string | null;
  lookupPhone: string | null;
  password: string;
  ip: string;
  req: NextRequest;
}) {
  const { lookupEmail, lookupPhone, password, ip, req } = input;

  if (!isNeonServiceConfigured) {
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "Pont de migration indisponible : le compte de service Neon Auth n'est pas configuré (NEON_AUTH_SERVICE_EMAIL / NEON_AUTH_SERVICE_PASSWORD)."
    );
  }

  // Compte local visé : e-mail direct (CANONISÉ — une ancienne adresse
  // saisie est traduite vers la convention actuelle), ou téléphone.
  // La chaîne d'alias couvre toutes les GÉNÉRATIONS d'adresses du compte
  // (kivobusiness1+<rôle> → geormakoma1+<rôle> → <rôle>@nzoko.cg).
  const canonical = lookupEmail ? canonicalStaffEmail(lookupEmail) : null;
  const effectiveEmail = canonical ?? lookupEmail;
  let localUser = effectiveEmail
    ? await db.user.findUnique({ where: { email: effectiveEmail } })
    : await db.user.findFirst({ where: { phone: lookupPhone ?? undefined } });
  let legacyAliasEmail: string | null = null; // ancien e-mail réellement trouvé
  if (!localUser && effectiveEmail) {
    for (const legacyEmail of LEGACY_EMAIL_CHAINS[effectiveEmail] ?? []) {
      const aliased = await db.user.findUnique({ where: { email: legacyEmail } });
      if (aliased) {
        localUser = aliased;
        legacyAliasEmail = legacyEmail;
        break;
      }
    }
  }

  const valid = localUser ? await verifyPassword(password, localUser.passwordHash) : false;

  if (!localUser || !localUser.isActive || !valid || isNeonServiceAccount(localUser.email)) {
    await logSecurity({
      event: "LOGIN_FAILED",
      email: lookupEmail ?? undefined,
      userId: localUser?.id ?? null,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: {
        reason: !localUser ? "compte inconnu (pont)" : localUser.isActive ? "mot de passe invalide (pont)" : "compte désactivé",
        method: "neon-bridge",
      },
    });
    // Message générique identique au refus Neon — aucune fuite d'information
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Identifiants incorrects.");
  }

  // E-mail d'import : l'e-mail SAISI canonisé (convention actuelle). Si le
  // compte local portait une ancienne adresse, elle est modernisée ICI —
  // aucune autre ligne User ne porte l'e-mail canonique (vérifié ci-dessus :
  // findUnique(effectiveEmail) = null, sinon la chaîne n'aurait pas servi) —
  // pour que le miroir d'échange (/api/neon-auth/exchange) adopte le bon
  // compte staff par e-mail, avec son rôle et ses permissions.
  const email = (effectiveEmail ?? localUser.email).toLowerCase();
  if (legacyAliasEmail && email !== localUser.email.toLowerCase()) {
    await db.user.update({ where: { id: localUser.id }, data: { email } });
  }
  try {
    await importNeonAccount({
      email,
      password,
      name: `${localUser.firstName} ${localUser.lastName}`.trim(),
      phone: localUser.phone,
    });
  } catch (err) {
    await logSecurity({
      event: "SUSPICIOUS",
      userId: localUser.id,
      email,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: {
        reason: "échec de l'import vers Neon Auth",
        error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      },
    });
    throw new ApiError(502, "BAD_GATEWAY", "Le service d'authentification est momentanément indisponible. Réessayez.");
  }

  await logSecurity({
    event: "LOGIN_SUCCESS",
    userId: localUser.id,
    email,
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { method: "neon-bridge", reason: "compte interne importé vers Neon Auth" },
  });

  // Le client enchaîne : signIn.email (SDK) → session Neon → exchange.
  return ok({ migrated: true, email });
}
