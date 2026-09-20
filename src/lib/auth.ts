// ============================================================
// NZOKO TRANSPORT — Authentification serveur
// bcrypt (cost 12) + sessions opaque en base + cookie HttpOnly
// Protection fixation : nouveau token à chaque connexion.
// ============================================================

import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isNeonAuthEnabled } from "@/lib/neon-auth/server";
import { SESSION_HOURS, SESSION_COOKIE, GLOBAL_ROLES } from "@/lib/auth-shared";
import { generateSessionToken, sha256 } from "@/lib/security";
import { ApiError, ERROR_CODES } from "@/lib/api-response";
import type { SessionUser } from "@/types";
import type { PermissionCode, RoleCode } from "@/lib/constants";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AuthContext {
  userId: string;
  email: string;
  role: RoleCode;
  agencyId: string | null;
  permissions: PermissionCode[];
  sessionId: string;
  sessionUser: SessionUser;
}

/** Crée une session (nouveau token à chaque login = anti-fixation). */
export async function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt,
      ip,
      userAgent,
    },
  });
  return { token, expiresAt };
}

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

/**
 * Fournisseur d'identité d'un compte : la colonne User.supabaseId porte
 * l'identifiant du fournisseur EXTERNE (historiquement Supabase Auth,
 * désormais Neon Auth). Quand Neon Auth est le fournisseur actif sur
 * l'environnement, les comptes externes sont étiquetés NEON_AUTH.
 */
export function externalAuthProvider(user: { supabaseId: string | null }): "LOCAL" | "SUPABASE" | "NEON_AUTH" {
  if (!user.supabaseId) return "LOCAL";
  return isNeonAuthEnabled ? "NEON_AUTH" : "SUPABASE";
}

/** Charge le contexte d'authentification depuis le cookie de la requête. */
export async function getAuth(req: NextRequest): Promise<AuthContext | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sessionId = sha256(token);

  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          agency: true,
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;

  const permissions = session.user.role.permissions
    .map((rp) => rp.permission.code as PermissionCode)
    .filter(Boolean);

  const sessionUser: SessionUser = {
    id: session.user.id,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    fullName: `${session.user.firstName} ${session.user.lastName}`,
    email: session.user.email,
    phone: session.user.phone,
    role: session.user.role.code as RoleCode,
    roleLabel: session.user.role.name,
    agencyId: session.user.agencyId,
    agencyName: session.user.agency?.name ?? null,
    authProvider: externalAuthProvider(session.user),
    permissions,
  };

  // lastSeenAt glissant (best effort)
  await db.session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } }).catch(() => {});

  return {
    userId: session.user.id,
    email: session.user.email,
    role: sessionUser.role,
    agencyId: sessionUser.agencyId,
    permissions,
    sessionId,
    sessionUser,
  };
}

export async function revokeSession(req: NextRequest): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await db.session
    .update({ where: { id: sha256(token) }, data: { revokedAt: new Date() } })
    .catch(() => {});
}

// ---------- Helpers d'autorisation ----------

export function assertAuthenticated(auth: AuthContext | null): AuthContext {
  if (!auth) {
    throw new ApiError(401, ERROR_CODES.UNAUTHORIZED, "Vous devez être connecté pour effectuer cette action.");
  }
  return auth;
}

export function assertPermission(auth: AuthContext, permission: PermissionCode): AuthContext {
  if (!auth.permissions.includes(permission)) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Vous n'avez pas la permission d'effectuer cette action.");
  }
  return auth;
}

/**
 * Scope multi-agences OBLIGATOIRE côté serveur :
 * les rôles globaux peuvent cibler une agence, les autres sont FORCÉS sur leur agence.
 * Ne jamais faire confiance à un agencyId fourni par le client.
 * `extraGlobalRoles` élargit la vue globale (ex: ACCOUNTATOR en lecture financière).
 */
export function resolveAgencyScope(
  auth: AuthContext,
  requestedAgencyId?: string | null,
  extraGlobalRoles: readonly string[] = []
): string | null {
  if ((GLOBAL_ROLES as readonly string[]).includes(auth.role) || extraGlobalRoles.includes(auth.role)) {
    return requestedAgencyId ?? null; // null = toutes les agences
  }
  if (!auth.agencyId) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Aucune agence n'est associée à votre compte.");
  }
  if (requestedAgencyId && requestedAgencyId !== auth.agencyId) {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Accès refusé : vous ne pouvez accéder qu'aux données de votre agence.");
  }
  return auth.agencyId;
}
