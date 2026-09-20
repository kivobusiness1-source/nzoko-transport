// POST /api/auth/otp — connexion sans mot de passe par téléphone.
//
// UN SEUL pipeline d'interface (mêmes écrans, même contrat), deux moteurs :
//  - mode NEON (production, NEON_AUTH_MODE=neon) : Neon Auth est le
//    système d'identité et de session centralisé.
//      action "request" → provisioning silencieux du compte Neon pour
//      ce numéro (admin.createUser via compte de service — première
//      connexion client), puis le client appelle le SDK
//      phoneNumber.sendOtp (proxy /api/auth/phone-number/send-otp) →
//      webhook send.otp → SMS. La vérification se fait par le client
//      via phoneNumber.verify (session Neon) puis /api/neon-auth/exchange.
//  - mode LOCAL (sandbox/dev, NEON_AUTH_MODE=local — le webhook Neon
//    exige une URL HTTPS publique inaccessible depuis la sandbox) :
//      code 6 chiffres local (hashé SHA-256, TTL 5 min), session locale.
//      Le code n'est JAMAIS retourné sauf OTP_DEBUG=true.
//
// Aucune seconde identité : en mode Neon, le numéro est TOUJOURS porté
// par le compte Neon (provisioning avant l'envoi du code).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost } from "@/lib/api-response";
import { createSession, setSessionCookie, externalAuthProvider } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS, OTP } from "@/lib/constants";
import { normalizePhone } from "@/lib/phone";
import { sha256, generateOtpCode } from "@/lib/security";
import { isNeonAuthEnabled, neonAuthMode } from "@/lib/neon-auth/server";
import { ensureNeonPhoneUser, isNeonServiceConfigured } from "@/lib/neon-auth/service-account";
import { db } from "@/lib/db";
import type { PermissionCode, RoleCode } from "@/lib/constants";

const baseSchema = z.object({
  action: z.enum(["request", "verify"]),
  phone: z.string().trim().min(6, "Numéro de téléphone requis."),
  code: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres requis.").optional(),
});

/** E.164 avec « + » (exigé par le plugin Phone Number de Neon Auth). */
function toNeonE164(phoneDigits: string): string {
  return `+${phoneDigits}`;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    const body = baseSchema.parse(await req.json().catch(() => null));

    const phone = normalizePhone(body.phone);
    if (!phone) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro de téléphone invalide (format attendu : 06 123 45 67).");
    }

    if (body.action === "request") {
      if (neonAuthMode === "neon" && isNeonAuthEnabled) {
        return await handleRequestNeon(phone, ip, req);
      }
      return await handleRequestLocal(phone);
    }
    if (!body.code) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Code à 6 chiffres requis.");
    }
    if (neonAuthMode === "neon" && isNeonAuthEnabled) {
      // En mode Neon, la vérification passe par le SDK (session Neon)
      // puis /api/neon-auth/exchange — jamais par cette route.
      throw new ApiError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "En mode Neon Auth, le code se vérifie via l'interface (session Neon Auth)."
      );
    }
    return await handleVerifyLocal(phone, body.code, ip, req);
  } catch (err) {
    return routeError(err, "POST /api/auth/otp");
  }
}

// ---------- Mode NEON : provisioning + délégation ----------

async function handleRequestNeon(phone: string, ip: string, req: NextRequest) {
  // Rate limit par téléphone (coût d'envoi SMS) + par IP
  enforceRateLimit(`otp:${phone}`, RATE_LIMITS.otpRequest.limit, RATE_LIMITS.otpRequest.windowMs);
  enforceRateLimit(`otp-ip:${ip}`, 10, RATE_LIMITS.otpRequest.windowMs);

  if (!isNeonServiceConfigured) {
    // Compte de service absent : le client NEUVEAU ne peut pas être
    // provisionné — message actionnable pour l'exploitant.
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "Le compte de service Neon Auth n'est pas configuré (NEON_AUTH_SERVICE_EMAIL / NEON_AUTH_SERVICE_PASSWORD). Les nouveaux numéros ne peuvent pas encore recevoir de code."
    );
  }

  const e164 = toNeonE164(phone);
  let provisioned = false;
  try {
    const result = await ensureNeonPhoneUser(e164);
    provisioned = result.provisioned;
  } catch (err) {
    await logSecurity({
      event: "SUSPICIOUS",
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: {
        reason: "échec du provisioning téléphone Neon",
        error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      },
    });
    throw new ApiError(502, "BAD_GATEWAY", "Le service d'authentification est momentanément indisponible. Réessayez.");
  }

  await logSecurity({
    event: "LOGIN_SUCCESS_OTP",
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { reason: "OTP demandé (Neon Auth)", phone, provisioned },
  });

  // Le client enchaîne : SDK phoneNumber.sendOtp (proxy /api/auth/*) →
  // webhook send.otp → SMS → phoneNumber.verify → exchange.
  return ok({ mode: "neon", phone: e164, provisioned });
}

// ---------- Mode LOCAL (sandbox/développement) ----------

async function handleRequestLocal(phone: string) {
  // Rate limit par téléphone (coût d'envoi SMS en production)
  enforceRateLimit(`otp:${phone}`, RATE_LIMITS.otpRequest.limit, RATE_LIMITS.otpRequest.windowMs);

  // Invalide les codes précédents (un seul code actif par téléphone)
  await db.otpCode.updateMany({
    where: { phone, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateOtpCode(OTP.codeLength);
  const expiresAt = new Date(Date.now() + OTP.ttlMinutes * 60 * 1000);

  await db.otpCode.create({
    data: {
      phone,
      codeHash: sha256(code),
      expiresAt,
    },
  });

  const data: { mode: "local"; phone: string; expiresInSec: number; devCode?: string } = {
    mode: "local",
    phone,
    expiresInSec: OTP.ttlMinutes * 60,
  };
  // Uniquement en mode debug sandbox — JAMAIS en production
  if (process.env.OTP_DEBUG === "true") {
    data.devCode = code;
  }
  return ok(data);
}

async function handleVerifyLocal(phone: string, code: string, ip: string, req: NextRequest) {
  // Rate limit anti brute-force par téléphone
  enforceRateLimit(`otpverify:${phone}`, RATE_LIMITS.otpVerify.limit, RATE_LIMITS.otpVerify.windowMs);

  const otp = await db.otpCode.findFirst({
    where: {
      phone,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  // Générique : aucun code actif, expiré, ou trop de tentatives
  if (!otp || otp.attempts >= OTP.maxAttempts) {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Code incorrect ou expiré.");
  }

  if (otp.codeHash !== sha256(code)) {
    await db.otpCode
      .update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } })
      .catch(() => {});
    await logSecurity({
      event: "LOGIN_FAILED",
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: { reason: "code OTP invalide", phone },
    });
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Code incorrect ou expiré.");
  }

  // Code valide → consommé (usage unique)
  await db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  const user = await db.user.findFirst({
    where: { phone, role: { code: "PASSENGER" }, isActive: true },
    include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
  });
  if (!user) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun compte n'est associé à ce numéro. Créez d'abord un compte.");
  }

  const { token, expiresAt } = await createSession(user.id, ip, getUserAgent(req));
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await logSecurity({
    event: "LOGIN_SUCCESS_OTP",
    userId: user.id,
    email: user.email,
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { phone },
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
}
