// POST /api/auth/password — changement de son propre mot de passe
// Body : { currentPassword, newPassword (≥ 8) }
// Auth obligatoire. Vérifie le mot de passe actuel, applique le nouveau
// (bcrypt cost 12) et RÉVOQUE toutes les autres sessions du compte
// (les autres appareils restés connectés sont déconnectés).

import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, routeError, ApiError, ERROR_CODES, getClientIp, assertSameOriginPost } from "@/lib/api-response";
import { getAuth, assertAuthenticated, hashPassword, verifyPassword } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logAudit, logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { db } from "@/lib/db";
import { withWriteLock } from "@/lib/write-mutex";

const changeSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis."),
  newPassword: z
    .string()
    .min(8, "Le nouveau mot de passe doit contenir au moins 8 caractères.")
    .max(128, "Mot de passe trop long."),
});

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const ip = getClientIp(req);
    const auth = assertAuthenticated(await getAuth(req));
    const body = changeSchema.parse(await req.json().catch(() => null));

    // Anti brute-force sur le mot de passe actuel (5 tentatives / 15 min)
    enforceRateLimit(`pwchange:${auth.userId}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId } });
    if (!user || !user.isActive) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Compte introuvable ou désactivé.");
    }

    const valid = await verifyPassword(body.currentPassword, user.passwordHash);
    if (!valid) {
      await logSecurity({
        event: "PASSWORD_CHANGE_FAILED",
        userId: user.id,
        ipAddress: ip,
        details: { reason: "mot de passe actuel invalide" },
      });
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Mot de passe actuel incorrect.");
    }

    if (body.currentPassword === body.newPassword) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Le nouveau mot de passe doit être différent de l'actuel.");
    }

    const passwordHash = await hashPassword(body.newPassword);
    await withWriteLock(() =>
      db.user.update({ where: { id: user.id }, data: { passwordHash } })
    );

    // Sécurité : révoque toutes les AUTRES sessions (autres appareils).
    await withWriteLock(() =>
      db.session.updateMany({
        where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    );

    await logAudit({
      userId: user.id,
      action: "PASSWORD_CHANGED",
      entity: "User",
      entityId: user.id,
      ipAddress: ip,
    });

    return ok(true, 200);
  } catch (err) {
    return routeError(err, "POST /api/auth/password");
  }
}
