// POST /api/auth/password-reset — réinitialisation « mot de passe oublié ».
//
// UN SEUL pipeline d'interface (mêmes écrans, même contrat), deux moteurs —
// exactement comme /api/auth/otp :
//  - mode NEON (production, NEON_AUTH_MODE=neon) : le plugin Email OTP du
//    service managé délivre le code (webhook send.otp → livraison e-mail
//    NZOKO) ; la demande et la réinitialisation sont effectuées ICI côté
//    serveur (aucun endpoint public supplémentaire : canonisation,
//    rate limit et audit centralisés) :
//      action "request" → POST {Neon}/email-otp/send-verification-otp
//        { email, type: "forget-password" }
//      action "verify"  → POST {Neon}/email-otp/reset-password
//        { email, otp, password }
//  - mode LOCAL (sandbox/dev, NEON_AUTH_MODE=local — le webhook Neon
//    exige une URL HTTPS publique inaccessible depuis la sandbox) :
//      code 6 chiffres local (hashé SHA-256, TTL 15 min aligné sur la
//      durée des liens Neon, 5 tentatives, usage unique) → table
//      PasswordResetCode, puis bcrypt + révocation de TOUTES les sessions
//      du compte (reconnexion imposée partout).
//
// Canonisation des identifiants : « superadmin » → e-mail réel du compte,
// anciennes conventions (geormakoma1+…, <rôle>@nzoko.cg) → adresse actuelle
// (mêmes chaînes que le pont d'import /api/auth/login).
//
// Anti-énumération : la demande répond toujours un succès générique, que
// l'adresse soit connue ou non (en mode Neon, le service managé ignore
// silencieusement les e-mails inconnus — comportement Better Auth).
// Les comptes créés par téléphone (sans boîte mail réelle) se connectent
// par SMS : aucun mot de passe à réinitialiser.

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ok,
  routeError,
  ApiError,
  ERROR_CODES,
  getClientIp,
  getUserAgent,
  assertSameOriginPost,
} from "@/lib/api-response";
import { hashPassword } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS, PASSWORD_RESET, SHORT_ID_EMAILS, canonicalStaffEmail } from "@/lib/constants";
import { sha256, generateOtpCode } from "@/lib/security";
import { neonAuthMode, isNeonAuthEnabled, neonAuthBaseUrl } from "@/lib/neon-auth/server";
import { sendEmail, passwordResetEmailContent } from "@/lib/neon-auth/delivery";
import { db } from "@/lib/db";

const baseSchema = z.object({
  action: z.enum(["request", "verify"]),
  email: z.string().trim().min(3, "Adresse e-mail ou identifiant requis."),
  code: z.string().trim().regex(/^\d{6}$/, "Code à 6 chiffres requis.").optional(),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum.").optional(),
});

/** E-mail valide (suffisant ici — le reste est géré par les services d'identité). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Canonise la saisie : identifiant court interne (« superadmin »…) → e-mail
 * réel, ancienne convention d'adresse → adresse actuelle, toujours lowercase.
 */
function canonizeIdentifier(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  const shortEmail = SHORT_ID_EMAILS[normalized];
  if (shortEmail) return shortEmail;
  return canonicalStaffEmail(normalized) ?? normalized;
}

/** Origine déclarée aux appels serveur → Neon (cohérente avec le compte de service). */
function serviceOrigin(): string {
  return process.env.NEON_SERVICE_ORIGIN?.trim() || "http://localhost:3000";
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    const body = baseSchema.parse(await req.json().catch(() => null));

    const email = canonizeIdentifier(body.email);
    if (!EMAIL_RE.test(email)) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Adresse e-mail invalide (ex : vous@exemple.cg).");
    }

    if (body.action === "request") {
      if (neonAuthMode === "neon" && isNeonAuthEnabled) {
        return await handleRequestNeon(email, ip, req);
      }
      return await handleRequestLocal(email, ip, req);
    }

    if (!body.code || !body.password) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Code à 6 chiffres et nouveau mot de passe requis.");
    }
    if (neonAuthMode === "neon" && isNeonAuthEnabled) {
      return await handleVerifyNeon(email, body.code, body.password, ip, req);
    }
    return await handleVerifyLocal(email, body.code, body.password, ip, req);
  } catch (err) {
    return routeError(err, "POST /api/auth/password-reset");
  }
}

// ---------- Mode NEON : délégation au plugin Email OTP ----------

async function handleRequestNeon(email: string, ip: string, req: NextRequest) {
  // Rate limit par adresse (coût d'envoi e-mail) + par IP
  enforceRateLimit(`pwreset:${email}`, RATE_LIMITS.otpRequest.limit, RATE_LIMITS.otpRequest.windowMs);
  enforceRateLimit(`pwreset-ip:${ip}`, 10, RATE_LIMITS.otpRequest.windowMs);

  const res = await fetch(`${neonAuthBaseUrl}/email-otp/send-verification-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: serviceOrigin() },
    body: JSON.stringify({ email, type: "forget-password" }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    await logSecurity({
      event: "SUSPICIOUS",
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: {
        reason: "échec envoi code réinitialisation (Neon Auth)",
        status: res.status,
        code: String(json.code ?? json.message ?? "").slice(0, 120),
      },
    });
    throw new ApiError(502, "BAD_GATEWAY", "Le service d'authentification est momentanément indisponible. Réessayez.");
  }

  await logSecurity({
    event: "PASSWORD_CHANGED",
    email,
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { reason: "mot de passe oublié — code de réinitialisation demandé (Neon Auth)" },
  });

  return ok({ mode: "neon", email, expiresInSec: PASSWORD_RESET.ttlMinutes * 60 });
}

async function handleVerifyNeon(email: string, code: string, password: string, ip: string, req: NextRequest) {
  // Anti brute-force du code
  enforceRateLimit(`pwreset-verify:${email}`, RATE_LIMITS.otpVerify.limit, RATE_LIMITS.otpVerify.windowMs);

  const res = await fetch(`${neonAuthBaseUrl}/email-otp/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: serviceOrigin() },
    body: JSON.stringify({ email, otp: code, password }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = String(json.message ?? json.code ?? "").toLowerCase();
    if (/otp|code|invalid|expired/.test(message)) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Code incorrect ou expiré. Demandez un nouveau code.");
    }
    if (/password.*(short|weak|least)|too short/.test(message)) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Mot de passe trop faible : 8 caractères minimum.");
    }
    throw new ApiError(502, "BAD_GATEWAY", "Le service d'authentification est momentanément indisponible. Réessayez.");
  }

  // Révocation des sessions applicatives NZOKO du compte (reconnexion propre)
  await db.session.deleteMany({ where: { user: { email } } }).catch(() => {});

  await logSecurity({
    event: "PASSWORD_CHANGED",
    email,
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { reason: "mot de passe oublié — réinitialisation terminée (Neon Auth)" },
  });
  return ok({ mode: "neon", ok: true });
}

// ---------- Mode LOCAL (sandbox/développement) ----------

async function handleRequestLocal(email: string, ip: string, req: NextRequest) {
  enforceRateLimit(`pwreset:${email}`, RATE_LIMITS.otpRequest.limit, RATE_LIMITS.otpRequest.windowMs);
  enforceRateLimit(`pwreset-ip:${ip}`, 10, RATE_LIMITS.otpRequest.windowMs);

  const user = await db.user.findFirst({
    where: { email },
    select: { id: true, isActive: true },
  });

  // Anti-énumération : réponse identique que le compte existe ou non.
  if (!user || !user.isActive) {
    await logSecurity({
      event: "PASSWORD_CHANGED",
      email,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: { reason: "mot de passe oublié — demande pour une adresse inconnue (ignorée)" },
    });
    return ok({ mode: "local", email, expiresInSec: PASSWORD_RESET.ttlMinutes * 60 });
  }

  // Invalide les codes précédents (un seul code actif par adresse)
  await db.passwordResetCode.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = generateOtpCode(PASSWORD_RESET.codeLength);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET.ttlMinutes * 60 * 1000);
  await db.passwordResetCode.create({
    data: { email, codeHash: sha256(code), expiresAt },
  });

  const content = passwordResetEmailContent({ code, expiresInMinutes: PASSWORD_RESET.ttlMinutes });
  const result = await sendEmail(email, content.subject, content.text, content.html);
  if (!result.delivered) {
    throw new ApiError(
      502,
      "BAD_GATEWAY",
      `L'envoi de l'e-mail de réinitialisation a échoué (${result.provider}). Contactez le support NZOKO.`
    );
  }

  await logSecurity({
    event: "PASSWORD_CHANGED",
    userId: user.id,
    email,
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { reason: "mot de passe oublié — code envoyé", provider: result.provider },
  });

  const data: { mode: "local"; email: string; expiresInSec: number; devCode?: string } = {
    mode: "local",
    email,
    expiresInSec: PASSWORD_RESET.ttlMinutes * 60,
  };
  // Uniquement en mode debug sandbox — JAMAIS en production
  if (process.env.OTP_DEBUG === "true") {
    data.devCode = code;
  }
  return ok(data);
}

async function handleVerifyLocal(email: string, code: string, password: string, ip: string, req: NextRequest) {
  // Anti brute-force du code
  enforceRateLimit(`pwreset-verify:${email}`, RATE_LIMITS.otpVerify.limit, RATE_LIMITS.otpVerify.windowMs);

  const reset = await db.passwordResetCode.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  // Générique : aucun code actif, expiré, ou trop de tentatives
  if (!reset || reset.attempts >= PASSWORD_RESET.maxAttempts) {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Code incorrect ou expiré. Demandez un nouveau code.");
  }

  if (reset.codeHash !== sha256(code)) {
    await db.passwordResetCode
      .update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } })
      .catch(() => {});
    await logSecurity({
      event: "LOGIN_FAILED",
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: { reason: "code de réinitialisation invalide", email },
    });
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Code incorrect ou expiré.");
  }

  const user = await db.user.findFirst({ where: { email, isActive: true } });
  if (!user) {
    throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Aucun compte actif n'est associé à cette adresse.");
  }

  // Usage unique + nouveau mot de passe (bcrypt cost 12) + révocation de
  // toutes les sessions (l'ancien mot de passe ne protège plus rien).
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.passwordResetCode.update({ where: { id: reset.id }, data: { consumedAt: new Date() } }),
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);

  await logSecurity({
    event: "PASSWORD_CHANGED",
    userId: user.id,
    email,
    ipAddress: ip,
    userAgent: getUserAgent(req),
    details: { reason: "mot de passe oublié — réinitialisation terminée (local)" },
  });
  return ok({ mode: "local", ok: true });
}
