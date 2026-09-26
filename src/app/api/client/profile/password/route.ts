// PATCH /api/client/profile/password — changement de mot de passe client
// Vérifie le mot de passe courant, re-hash (cost 12), révoque TOUTES les
// AUTRES sessions (la session courante reste valide) + journalisation
// de sécurité PASSWORD_CHANGED.

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, verifyPassword, hashPassword } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { assertClient } from "@/services/client-space";
import { db } from "@/lib/db";

const schema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis."),
  newPassword: z.string().min(8, "Nouveau mot de passe : 8 caractères minimum."),
});

export async function PATCH(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = assertClient(await getAuth(req));
    enforceRateLimit(`pwdchange:${auth.userId}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

    const body = schema.parse(await req.json().catch(() => null));

    const user = await db.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw new ApiError(404, ERROR_CODES.NOT_FOUND, "Compte introuvable.");

    // Comptes gérés par Supabase : le mot de passe vit dans Supabase Auth
    if (user.supabaseId) {
      throw new ApiError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        "Votre mot de passe est géré par votre compte Supabase : utilisez « Mot de passe oublié » depuis l'écran de connexion, ou contactez le support Océan du Nord."
      );
    }

    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      await logSecurity({
        event: "LOGIN_FAILED",
        userId: user.id,
        email: user.email,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        details: { reason: "mot de passe actuel invalide (changement)" },
      });
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Mot de passe actuel incorrect.");
    }

    if (body.currentPassword === body.newPassword) {
      throw new ApiError(409, ERROR_CODES.CONFLICT, "Le nouveau mot de passe doit être différent de l'actuel.");
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });

    // Révocation des AUTRES sessions (anti-session-persistante après compromission)
    const revoked = await db.session.updateMany({
      where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await logSecurity({
      event: "PASSWORD_CHANGED",
      userId: user.id,
      email: user.email,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      details: { revokedSessions: revoked.count },
    });

    return ok(true);
  } catch (err) {
    return routeError(err, "PATCH /api/client/profile/password");
  }
}
