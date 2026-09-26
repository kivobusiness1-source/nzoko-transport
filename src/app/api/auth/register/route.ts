// POST /api/auth/register — inscription client (rôle PASSENGER)
// { firstName, lastName, phone, email, password } → SessionUser + cookie
//
// Deux modes :
//  - SUPABASE (SUPABASE_URL + SUPABASE_ANON_KEY définis) : le compte est
//    créé dans Supabase Auth (email + mot de passe + metadata), puis un
//    miroir local est provisionné. Si la confirmation d'e-mail est activée
//    côté Supabase, la réponse est { requiresEmailConfirmation: true } et
//    la session locale n'est délivrée qu'après confirmation + connexion.
//  - LOCAL (défaut) : bcrypt cost 12 en base — identique à l'existant.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost } from "@/lib/api-response";
import { createSession, setSessionCookie, hashPassword, externalAuthProvider } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { isNeonAuthEnabled, neonAuthMode } from "@/lib/neon-auth/server";
import { normalizePhone } from "@/lib/phone";
import { ensureLoyaltyAccount } from "@/services/loyalty";
import {
  isSupabaseEnabled, supabase, supabaseAuthMessage, upsertClientMirror, ensurePassengerRoleId,
} from "@/services/supabase-auth";
import { db } from "@/lib/db";
import type { PermissionCode, RoleCode } from "@/lib/constants";

const registerSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis.").max(60, "Prénom trop long (60 caractères max)."),
  lastName: z.string().trim().min(1, "Nom requis.").max(60, "Nom trop long (60 caractères max)."),
  phone: z.string().trim().min(6, "Numéro de téléphone requis."),
  email: z.email("Adresse e-mail invalide.").transform((v) => v.trim().toLowerCase()).optional(),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum."),
});

/** Email synthétique dérivé du téléphone (mode local uniquement). */
export function syntheticEmail(phone: string): string {
  return `${phone}@phone.nzoko.cg`;
}

/** Construit le SessionUser (rôle + permissions + fournisseur d'authentification). */
function sessionUserOf(u: {
  id: string; firstName: string; lastName: string; email: string; phone: string | null;
  supabaseId: string | null; agencyId: string | null;
  role: { code: string; name: string; permissions: { permission: { code: string } }[] };
  agency: { name: string } | null;
}) {
  const perms = u.role.permissions.map((rp) => rp.permission.code).filter((c): c is PermissionCode => Boolean(c));
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: `${u.firstName} ${u.lastName}`,
    email: u.email,
    phone: u.phone,
    role: u.role.code as RoleCode,
    roleLabel: u.role.name,
    agencyId: u.agencyId,
    agencyName: u.agency?.name ?? null,
    authProvider: externalAuthProvider(u),
    permissions: perms,
  };
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);

    // MODE NEON : l'inscription est gérée par Neon Auth (SDK signUp.email
    // via le proxy /api/auth/sign-up/email, code de vérification e-mail,
    // miroir Océan du Nord créé par /api/neon-auth/exchange). Une seule identité :
    // cette route locale ne doit plus créer de comptes en production.
    if (neonAuthMode === "neon" && isNeonAuthEnabled) {
      throw new ApiError(
        503,
        "SERVICE_UNAVAILABLE",
        "L'inscription est gérée par le service d'identité centralisé : utilisez l'onglet E-mail de l'écran de connexion."
      );
    }

    const body = registerSchema.parse(await req.json().catch(() => null));

    // Rate limit anti-abus (créations de comptes en rafale)
    enforceRateLimit(`register:${ip}`, RATE_LIMITS.register.limit, RATE_LIMITS.register.windowMs);

    const phone = normalizePhone(body.phone);
    if (!phone) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro de téléphone invalide (format attendu : 06 123 45 67).");
    }

    // Unicité du téléphone (clé du compte client — rétro-liage des billets)
    const phoneTaken = await db.user.findUnique({ where: { phone }, select: { id: true } });
    if (phoneTaken) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Ce numéro est déjà utilisé.");
    }

    // ============================================================
    // MODE SUPABASE — comptes clients gérés par Supabase Auth
    // ============================================================
    if (isSupabaseEnabled) {
      if (!body.email) {
        throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Adresse e-mail requise : les comptes clients sont gérés par Supabase (connexion e-mail + mot de passe).");
      }
      const emailTaken = await db.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (emailTaken) {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette adresse e-mail est déjà utilisée.");
      }

      const { data, error } = await supabase().auth.signUp({
        email: body.email,
        password: body.password,
        options: { data: { first_name: body.firstName, last_name: body.lastName, phone } },
      });
      if (error || !data.user) {
        throw new ApiError(
          error?.code === "user_already_exists" || error?.code === "email_exists" ? 409 : 400,
          ERROR_CODES.VALIDATION_ERROR,
          supabaseAuthMessage(error?.code, error?.message ?? "")
        );
      }

      // Confirmation d'e-mail activée côté Supabase → pas de session tout de suite
      if (!data.session) {
        await logSecurity({
          event: "REGISTER_SUCCESS",
          email: body.email,
          ipAddress: ip,
          userAgent: getUserAgent(req),
          details: { phone, supabaseId: data.user.id, emailConfirmation: "pending" },
        });
        return ok({ requiresEmailConfirmation: true, email: body.email });
      }

      // Session immédiate (confirmation désactivée) → miroir + session locale
      const { id: userId } = await upsertClientMirror({
        supabaseId: data.user.id,
        email: body.email,
        phone,
        firstName: body.firstName,
        lastName: body.lastName,
      });
      const { token, expiresAt } = await createSession(userId, ip, getUserAgent(req));
      await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
      await logSecurity({
        event: "REGISTER_SUCCESS",
        userId,
        email: body.email,
        ipAddress: ip,
        userAgent: getUserAgent(req),
        details: { phone, supabaseId: data.user.id, provider: "supabase" },
      });

      const fresh = await db.user.findUnique({
        where: { id: userId },
        include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
      });
      if (!fresh) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de finaliser votre inscription. Veuillez réessayer.");

      const res = ok(sessionUserOf(fresh));
      return setSessionCookie(res, token, expiresAt);
    }

    // ============================================================
    // MODE LOCAL — bcrypt (sandbox / démarrage sans Supabase)
    // ============================================================
    let email = body.email ?? syntheticEmail(phone);
    if (body.email) {
      const emailTaken = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (emailTaken) {
        throw new ApiError(409, ERROR_CODES.CONFLICT, "Cette adresse e-mail est déjà utilisée.");
      }
    } else {
      const emailTaken = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (emailTaken) {
        email = `${phone}.${Date.now()}@phone.nzoko.cg`;
      }
    }

    const roleId = await ensurePassengerRoleId();

    const user = await db.user.create({
      data: {
        email,
        phone,
        firstName: body.firstName,
        lastName: body.lastName,
        passwordHash: await hashPassword(body.password),
        roleId,
        isActive: true,
      },
    });

    // Compte fidélité créé d'office (BRONZE, 0 point)
    await ensureLoyaltyAccount(user.id);

    // Rétro-liage : les billets achetés SANS compte avec ce numéro
    // remontent dans l'espace client.
    const linked = await db.passenger.updateMany({
      where: { phone },
      data: { userId: user.id },
    });

    // Notification de bienvenue
    await db.notification.create({
      data: {
        userId: user.id,
        title: "Bienvenue chez OCÉAN DU NORD 👋",
        message: "Votre espace client est prêt : billets, points fidélité et réclamations.",
        type: "SUCCESS",
      },
    });

    const { token, expiresAt } = await createSession(user.id, ip, getUserAgent(req));
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    await logSecurity({
      event: "REGISTER_SUCCESS",
      userId: user.id,
      email: user.email,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: { phone, linkedPassengers: linked.count },
    });

    const fresh = await db.user.findUnique({
      where: { id: user.id },
      include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
    });
    if (!fresh) throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de finaliser votre inscription. Veuillez réessayer.");

    const res = ok(sessionUserOf(fresh));
    return setSessionCookie(res, token, expiresAt);
  } catch (err) {
    return routeError(err, "POST /api/auth/register");
  }
}
