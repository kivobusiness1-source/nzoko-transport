// POST /api/account/email — changement de l'adresse e-mail de connexion
// (Paramètres du compte).
//
// Contexte produit (2026-09) : les comptes internes Océan du Nord sont créés avec
// des adresses techniques kivobusiness1+<rôle>@gmail.com (toutes livrées
// dans la boîte unique kivobusiness1@gmail.com). Chaque membre de
// l'administration peut remplacer la sienne par son adresse personnelle —
// l'identité change CHEZ NEON AUTH (source de vérité de la connexion) et
// dans le miroir applicatif (adoption par e-mail du pont d'échange).
//
// Sécurité :
//  - session Océan du Nord obligatoire (cookie applicatif) ;
//  - MOT DE PASSE ACTUEL exigé (vérifié côté Neon Auth en mode neon —
//    sign-in serveur→serveur, la vérification n'est JAMAIS locale pour un
//    mot de passe qui vit chez Neon ; bcrypt local en mode sandbox) ;
//  - unicité vérifiée des DEUX côtés (miroir applicatif + table managée
//    neon_auth."user") ;
//  - le nouveau compte est marqué e-mail vérifié (le membre est déjà
//    authentifié par son mot de passe actuel — sinon la connexion
//    suivante serait bloquée « Email not verified ») ;
//  - TOUTES les sessions de l'utilisateur sont révoquées (local) : la
//    reconnexion se fait avec la nouvelle adresse — le cookie Neon du
//    navigateur référence l'ancienne identité ;
//  - journal d'audit (aucun mot de passe n'y figure).

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  ok, routeError, ApiError, ERROR_CODES, getClientIp, getUserAgent, assertSameOriginPost,
} from "@/lib/api-response";
import { getAuth, verifyPassword } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { logSecurity } from "@/lib/audit";
import { RATE_LIMITS } from "@/lib/constants";
import { neonAuthBaseUrl, neonAuthMode, isNeonAuthEnabled } from "@/lib/neon-auth/server";
import { neonManagedUserId } from "@/lib/neon-auth/service-account";
import { db } from "@/lib/db";

const bodySchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Adresse e-mail invalide."),
  currentPassword: z.string().min(1, "Mot de passe requis."),
});

/** Sign-in serveur→serveur chez Neon Auth : valide le mot de passe ACTUEL. */
async function neonPasswordOk(email: string, password: string): Promise<boolean> {
  const res = await fetch(`${neonAuthBaseUrl}/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.NEON_SERVICE_ORIGIN?.trim() || "http://localhost:3000",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  return res.ok;
}

/** Appel admin authentifié (session du compte de service). */
async function neonAdminCall(path: string, payload: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const serviceEmail = (process.env.NEON_AUTH_SERVICE_EMAIL ?? "").trim().toLowerCase();
  const servicePassword = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";
  const origin = process.env.NEON_SERVICE_ORIGIN?.trim() || "http://localhost:3000";

  const signIn = await fetch(`${neonAuthBaseUrl}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: serviceEmail, password: servicePassword }),
    cache: "no-store",
  });
  if (!signIn.ok) {
    throw new Error(`Session du compte de service impossible (${signIn.status}).`);
  }
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${neonAuthBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginPost(req);
    const auth = await getAuth(req);
    if (!auth) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Connectez-vous pour modifier votre compte.");
    }
    const ip = getClientIp(req);

    const body = bodySchema.parse(await req.json().catch(() => null));
    const newEmail = body.newEmail;

    // Anti-abus (action sensible sur l'identité)
    enforceRateLimit(`change-email:${auth.userId}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowMs);

    const user = await db.user.findUnique({ where: { id: auth.userId } });
    if (!user || !user.isActive) {
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Compte indisponible.");
    }
    if (user.email.toLowerCase() === newEmail) {
      throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Cette adresse est déjà celle de votre compte.");
    }

    // ---------- 1. Mot de passe actuel ----------
    const passwordOk =
      neonAuthMode === "neon" && isNeonAuthEnabled
        ? await neonPasswordOk(user.email, body.currentPassword)
        : await verifyPassword(body.currentPassword, user.passwordHash);
    if (!passwordOk) {
      await logSecurity({
        event: "LOGIN_FAILED",
        userId: user.id,
        email: user.email,
        ipAddress: ip,
        userAgent: getUserAgent(req),
        details: { reason: "mot de passe invalide (changement d'e-mail)", method: "change-email" },
      });
      throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Mot de passe incorrect.");
    }

    // ---------- 2. Unicités (miroir + table managée) ----------
    const localTaken = await db.user.findFirst({
      where: { email: newEmail, id: { not: user.id } },
      select: { id: true },
    });
    if (localTaken) {
      throw new ApiError(409, ERROR_CODES.VALIDATION_ERROR, "Cette adresse e-mail est déjà utilisée par un autre compte.");
    }
    if (neonAuthMode === "neon" && isNeonAuthEnabled) {
      const neonTaken = await neonManagedUserId(newEmail);
      if (neonTaken) {
        throw new ApiError(409, ERROR_CODES.VALIDATION_ERROR, "Cette adresse e-mail est déjà utilisée par un autre compte.");
      }
    }

    // ---------- 3. Mise à jour ----------
    if (neonAuthMode === "neon" && isNeonAuthEnabled) {
      // Identifiant Neon : lien local (supabaseId) sinon lecture de la table managée.
      let neonUserId = user.supabaseId;
      if (!neonUserId) {
        neonUserId = await neonManagedUserId(user.email);
      }
      if (!neonUserId) {
        throw new ApiError(
          409,
          ERROR_CODES.VALIDATION_ERROR,
          "Votre compte n'est pas encore relié au service de connexion. Connectez-vous une fois, puis réessayez."
        );
      }
      const updated = await neonAdminCall("/admin/update-user", {
        userId: neonUserId,
        data: { email: newEmail, emailVerified: true },
      });
      if (!updated.ok) {
        throw new ApiError(502, "BAD_GATEWAY", "Le service d'authentification a refusé le changement. Réessayez.");
      }
    }

    // Miroir applicatif
    await db.user.update({ where: { id: user.id }, data: { email: newEmail } });

    // ---------- 4. Révocation de toutes les sessions locales ----------
    await db.session.deleteMany({ where: { userId: user.id } });

    await logSecurity({
      event: "ADMIN_ACTION",
      userId: user.id,
      email: newEmail,
      ipAddress: ip,
      userAgent: getUserAgent(req),
      details: { action: "change-email", previousEmailDomain: user.email.split("@")[1] ?? "", method: neonAuthMode },
    });

    return ok({ email: newEmail, signedOut: true });
  } catch (err) {
    return routeError(err, "POST /api/account/email");
  }
}
