// POST /api/neon-auth/exchange — pont universel session Neon → NZOKO.
//
// Pré-requis : le navigateur s'est authentifié via le proxy /api/auth/*
// (SDK @neondatabase/auth) → un cookie de session Neon (signé par
// NEON_AUTH_COOKIE_SECRET) est présent. Valable pour TOUS les rôles :
// clients (téléphone + OTP ou e-mail) comme équipes NZOKO (pont
// d'import /api/auth/login).
//
// La route :
//  1. lit la session Neon (auth.getSession()),
//  2. REFUSE le compte de service (outil de provisioning, pas un
//     utilisateur) et les comptes locaux inactifs,
//  3. retrouve/provisionne le miroir User (le rôle NZOKO — relu en
//     base, JAMAIS depuis le navigateur — est conservé : PASSENGER,
//     AGENT, ADMIN…),
//  4. délivre le cookie applicatif nzoko_session opaque — tout le
//     reste de l'app (réservations, guichets, QR, GPS, rapports)
//     fonctionne sans modification, avec vérification serveur des
//     permissions et de l'isolation par agence.

import { NextRequest } from "next/server";
import {
  ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost,
} from "@/lib/api-response";
import { createSession, setSessionCookie } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { isNeonAuthEnabled, neonAuth } from "@/lib/neon-auth/server";
import { isNeonServiceAccount } from "@/lib/neon-auth/service-account";
import { normalizePhone } from "@/lib/phone";
import { upsertNeonUserMirror } from "@/services/neon-auth-mirror";
import { db } from "@/lib/db";
import type { PermissionCode, RoleCode } from "@/lib/constants";

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);

    if (!isNeonAuthEnabled) {
      throw new ApiError(503, "SERVICE_UNAVAILABLE", "Neon Auth n'est pas configuré sur cet environnement.");
    }

    // Anti-abus : l'appel exige un cookie Neon valide, on garde une
    // garde simple par IP (l'amont est le service managé Neon).
    enforceRateLimit(`neon-exchange:${ip}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

    // Corps facultatif : { phone } — téléphone saisi à l'inscription e-mail.
    // Normalisé E.164 local (242…) ; un format invalide est refusé tôt,
    // un corps absent/illéisible est simplement ignoré (aucun téléphone).
    let requestedPhone: string | null = null;
    try {
      const body: unknown = await req.json();
      const raw =
        body && typeof body === "object" && typeof (body as { phone?: unknown }).phone === "string"
          ? ((body as { phone: string }).phone ?? "").trim()
          : "";
      if (raw) {
        requestedPhone = normalizePhone(raw);
        if (!requestedPhone) {
          throw new ApiError(
            400,
            ERROR_CODES.VALIDATION_ERROR,
            "Numéro de téléphone invalide (format attendu : 06 123 45 67)."
          );
        }
      }
    } catch (err) {
      // JSON absent/malformé → pas de téléphone demandé ; les ApiError
      // (validation) restent propagées.
      if (err instanceof ApiError) throw err;
    }

    // 1. Session Neon Auth (lecture du cookie signé, rafraîchie au besoin)
    const { data: neonSession } = await neonAuth().getSession();
    const nu = neonSession?.user;
    if (!nu || !nu.id || !nu.email) {
      throw new ApiError(
        401,
        ERROR_CODES.UNAUTHORIZED,
        "Aucune session Neon Auth active. Connectez-vous d'abord avec vos identifiants Neon."
      );
    }

    // 2. Garde-fous : le compte de service n'est PAS un utilisateur ;
    //    les comptes inactifs restent bloqués.
    if (isNeonServiceAccount(nu.email)) {
      await logSecurity({
        event: "ACCESS_DENIED",
        email: nu.email,
        ipAddress: ip,
        userAgent: getUserAgent(req),
        details: { reason: "tentative de pont avec le compte de service", method: "neon-auth" },
      });
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce compte est réservé au fonctionnement du service.");
    }

    // 3. Miroir universel : re-lien par identifiant Neon / adoption par
    //    e-mail (staff importé conservé avec son rôle) / création client.
    const neonPhone =
      typeof (nu as unknown as Record<string, unknown>).phoneNumber === "string"
        ? ((nu as unknown as Record<string, unknown>).phoneNumber as string)
        : null;
    const mirror = await upsertNeonUserMirror({
      neonUserId: nu.id,
      email: nu.email,
      name: typeof nu.name === "string" ? nu.name : null,
      phoneNumber: neonPhone,
    });

    if (!mirror.isActive) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Compte indisponible.");
    }

    // 3-bis. Liaison du téléphone demandé à l'inscription e-mail —
    // unicité garantie : un numéro déjà pris par un AUTRE compte actif
    // refuse l'échange avec une erreur claire (jamais de vol de numéro,
    // jamais de mélange de comptes). Même compte → no-op.
    if (requestedPhone) {
      const owner = await db.user.findFirst({
        where: { phone: requestedPhone },
        select: { id: true },
      });
      if (owner && owner.id !== mirror.id) {
        throw new ApiError(
          409,
          ERROR_CODES.VALIDATION_ERROR,
          "Ce numéro de téléphone est déjà lié à un autre compte NZOKO. Connectez-vous avec ce numéro ou choisissez-en un autre."
        );
      }
      if (!owner) {
        await db.user.update({ where: { id: mirror.id }, data: { phone: requestedPhone } });
      }
    }

    // 4. Session applicative NZOKO (cookie opaque HttpOnly habituel)
    const { token, expiresAt } = await createSession(mirror.id, ip, getUserAgent(req));
    await db.user.update({ where: { id: mirror.id }, data: { lastLoginAt: new Date() } });

    await logSecurity({
      event: "LOGIN_SUCCESS",
      userId: mirror.id,
      email: nu.email,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: {
        method: "neon-auth",
        role: mirror.roleCode,
        mirrorCreated: mirror.created,
        neonEmailVerified: typeof nu.emailVerified === "boolean" ? nu.emailVerified : null,
      },
    });

    const user = await db.user.findUnique({
      where: { id: mirror.id },
      include: { role: { include: { permissions: { include: { permission: true } } } }, agency: true },
    });
    if (!user) {
      throw new ApiError(500, ERROR_CODES.INTERNAL, "Impossible de finaliser la connexion. Réessayez.");
    }

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
      authProvider: "NEON_AUTH" as const,
      permissions: user.role.permissions
        .map((rp) => rp.permission.code)
        .filter((c): c is PermissionCode => Boolean(c)),
    };

    return setSessionCookie(ok(sessionUser), token, expiresAt);
  } catch (err) {
    return routeError(err, "POST /api/neon-auth/exchange");
  }
}
