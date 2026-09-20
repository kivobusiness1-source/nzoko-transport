// POST /api/neon-auth/exchange — pont Neon Auth → session applicative NZOKO.
//
// Pré-requis : le navigateur s'est authentifié via le proxy /api/auth/*
// (SDK @neondatabase/auth) → un cookie de session Neon (signé par
// NEON_AUTH_COOKIE_SECRET) est présent.
//
// La route :
//  1. lit la session Neon (auth.getSession()),
//  2. retrouve/provisionne le miroir User (rôle PASSENGER, colonne
//     supabaseId = identifiant Neon),
//  3. délivre le cookie nzoko_session opaque habituel — tout le reste
//     de l'app (réservations, fidélité, profil) fonctionne sans
//     modification.
//
// Garde-fous : comptes internes (staff) JAMAIS pontables via Neon Auth
// (403 + journalisation), compte inactif refusé, rate limit par IP.

import { NextRequest } from "next/server";
import {
  ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost,
} from "@/lib/api-response";
import { createSession, setSessionCookie } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { isNeonAuthEnabled, neonAuth } from "@/lib/neon-auth/server";
import { upsertNeonClientMirror } from "@/services/neon-auth-mirror";
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

    // 2. Miroir local : re-trouvé par identifiant Neon / e-mail, sinon créé
    const mirror = await upsertNeonClientMirror({
      neonUserId: nu.id,
      email: nu.email,
      name: typeof nu.name === "string" ? nu.name : null,
    });

    // 3. Garde-fous (identiques au mode Supabase historique)
    if (mirror.roleCode !== "PASSENGER") {
      await logSecurity({
        event: "ACCESS_DENIED",
        userId: mirror.id,
        email: nu.email,
        ipAddress: ip,
        userAgent: getUserAgent(req),
        details: { reason: "compte interne via Neon Auth", method: "neon-auth" },
      });
      throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Ce compte doit utiliser la connexion interne (mot de passe NZOKO).");
    }
    if (!mirror.isActive) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Compte indisponible.");
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
