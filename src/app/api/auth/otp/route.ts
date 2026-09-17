// POST /api/auth/otp — connexion sans mot de passe par téléphone
// action: "request" → code 6 chiffres (hashé SHA-256, TTL 5 min)
// action: "verify"  → session PASSENGER
// Production : brancher une passerelle SMS (envoi) — le code n'est
// JAMAIS retourné sauf OTP_DEBUG=true (sandbox/ZIP sans passerelle).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost } from "@/lib/api-response";
import { createSession, setSessionCookie } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS, OTP } from "@/lib/constants";
import { normalizePhone } from "@/lib/phone";
import { sha256, generateOtpCode } from "@/lib/security";
import { db } from "@/lib/db";
import type { PermissionCode, RoleCode } from "@/lib/constants";

const baseSchema = z.object({
  action: z.enum(["request", "verify"]),
  phone: z.string().trim().min(6, "Numéro de téléphone requis."),
  code: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres requis.").optional(),
});

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
      return await handleRequest(phone);
    }
    if (!body.code) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Code à 6 chiffres requis.");
    }
    return await handleVerify(phone, body.code, ip, req);
  } catch (err) {
    return routeError(err, "POST /api/auth/otp");
  }
}

// ---------- Demande de code ----------
async function handleRequest(phone: string) {
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

  const data: { phone: string; expiresInSec: number; devCode?: string } = {
    phone,
    expiresInSec: OTP.ttlMinutes * 60,
  };
  // Uniquement en mode debug sandbox — JAMAIS en production
  if (process.env.OTP_DEBUG === "true") {
    data.devCode = code;
  }
  return ok(data);
}

// ---------- Vérification du code ----------
async function handleVerify(phone: string, code: string, ip: string, req: NextRequest) {
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
    authProvider: user.supabaseId ? ("SUPABASE" as const) : ("LOCAL" as const),
    permissions: user.role.permissions
      .map((rp) => rp.permission.code)
      .filter((c): c is PermissionCode => Boolean(c)),
  };

  const res = ok(sessionUser);
  return setSessionCookie(res, token, expiresAt);
}
