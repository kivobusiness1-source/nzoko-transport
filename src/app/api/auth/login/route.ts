// POST /api/auth/login — { identifier, password } → SessionUser + cookie nzoko_session
// identifier : adresse e-mail OU numéro de téléphone (E.164, national, +242…).
//
// Mode SUPABASE actif (SUPABASE_URL + SUPABASE_ANON_KEY) :
//  1. tentative supabase.auth.signInWithPassword (email ou téléphone) —
//     comptes CLIENTS gérés par Supabase ;
//  2. si les identifiants Supabase sont invalides → repli sur le login
//     local bcrypt (comptes internes : admin, guichets, équipes).
// Mode LOCAL (défaut) : bcrypt, comportement inchangé.
// Rate limit par ip+identifiant, messages génériques (aucune fuite d'information).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost } from "@/lib/api-response";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { normalizePhone } from "@/lib/phone";
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
    const identifier = (body.identifier ?? body.email ?? "").trim();

    // Adresse e-mail OU téléphone normalisé E.164 digits
    const isEmail = identifier.includes("@");
    const phone = isEmail ? null : normalizePhone(identifier);
    const lookupEmail = isEmail ? identifier.toLowerCase() : null;
    const lookupPhone = phone;

    if (!lookupEmail && !lookupPhone) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro de téléphone invalide (format attendu : 06 123 45 67).");
    }

    // Rate limit anti brute-force, clé ip + identifiant canonique
    const rateKey = `login:${ip}:${lookupEmail ?? lookupPhone}`;
    enforceRateLimit(rateKey, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

    // ============================================================
    // 1. MODE SUPABASE — comptes clients
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
            "Votre compte Supabase n'a pas de téléphone NZOKO associé. Contactez le support pour finaliser votre compte client."
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
          throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce compte doit utiliser la connexion interne (mot de passe NZOKO).");
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
      // (comptes internes NZOKO : admin, guichet, agence…).
    }

    // ============================================================
    // 2. LOGIN LOCAL — bcrypt (staff + mode sans Supabase)
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
      authProvider: user.supabaseId ? ("SUPABASE" as const) : ("LOCAL" as const),
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
