// ============================================================
// NZOKO TRANSPORT — Réponses API normalisées + gestion d'erreurs
// Ne JAMAIS exposer stack traces / détails internes au client.
// ============================================================

import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  SEAT_UNAVAILABLE: "SEAT_UNAVAILABLE",
  TRIP_UNAVAILABLE: "TRIP_UNAVAILABLE",
  PAYMENT_ERROR: "PAYMENT_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL_ERROR",
  BAD_REQUEST: "BAD_REQUEST",
} as const;

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status }
  );
}

/**
 * Convertit n'importe quelle exception en réponse API sûre.
 * - ApiError → réponse fidèle
 * - ZodError → 400 VALIDATION_ERROR (premier message lisible)
 * - Prisma P2002 (unique) → 409 CONFLICT
 * - Autre → 500 générique (détails en console serveur uniquement)
 */
export function routeError(err: unknown, context = "Erreur"): NextResponse {
  if (err instanceof ApiError) {
    return fail(err.status, err.code, err.message);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.join(".");
    const msg = first?.message ?? "Données invalides";
    return fail(400, ERROR_CODES.VALIDATION_ERROR, field ? `${msg} (${field})` : msg);
  }
  // Prisma unique constraint violation
  const prismaErr = err as { code?: string; meta?: { target?: string[] } };
  if (prismaErr?.code === "P2002") {
    const target = prismaErr?.meta?.target?.join(", ") ?? "champ";
    return fail(409, ERROR_CODES.CONFLICT, `Cette valeur existe déjà (${target}).`);
  }
  if (prismaErr?.code === "P2025") {
    return fail(404, ERROR_CODES.NOT_FOUND, "Ressource introuvable.");
  }
  console.error(`[${context}]`, err);
  return fail(500, ERROR_CODES.INTERNAL, "Une erreur interne est survenue. Veuillez réessayer.");
}

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function getUserAgent(req: Request): string {
  return (req.headers.get("user-agent") ?? "unknown").slice(0, 250);
}

/** Refuse les requêtes mutantes sans l'en-tête anti-CSRF maison. */
export function assertSameOriginPost(req: Request): void {
  if (req.method === "GET") return;
  const h = req.headers.get("x-requested-with");
  if (h !== "nzoko") {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Requête non autorisée (origine invalide).");
  }
}
