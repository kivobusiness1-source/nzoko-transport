// ============================================================
// OCÉAN DU NORD — Réponses API normalisées + gestion d'erreurs
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
  SEAT_ALREADY_TAKEN: "SEAT_ALREADY_TAKEN", // contrat §8 — place prise concurrentiellement
  TRIP_UNAVAILABLE: "TRIP_UNAVAILABLE",
  AGENCY_UNAVAILABLE: "AGENCY_UNAVAILABLE", // contrat §7.4 — agence inactive/inconnue
  PAYMENT_ERROR: "PAYMENT_ERROR",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED", // contrat §12 — confirm sans paiement confirmé
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
  // 500 générique — le message ne divulgue AUCUN détail interne, mais la
  // RÉFÉRENCE du code d'erreur (P2022 « colonne absente », P1001 connexion…)
  // est communiquée : codes standards non sensibles, indispensables au
  // diagnostic (support/monitoring) sans exposer le schéma ni les données.
  const ref = typeof prismaErr?.code === "string" && prismaErr.code ? ` (réf. ${prismaErr.code})` : "";
  return fail(500, ERROR_CODES.INTERNAL, `Une erreur interne est survenue.${ref} Veuillez réessayer.`);
}

/**
 * IP client pour les limites de débit et l'audit.
 *
 * ⚠️ Le PREMIER élément de X-Forwarded-For est contrôlé par le client :
 * lui faire confiance permet la ROTATION d'adresses et contourne toutes
 * les limites « par IP ». On retient la valeur la PLUS À DROITE (celle
 * ajoutée par NOTRE infrastructure) ; sur Vercel, le header est écrasé
 * par la plateforme avec l'IP réelle — comportement identique.
 * (OWASP REST Security / Denial of Service : ne jamais faire confiance
 * à un en-tête fourni par le client pour une décision de sécurité.)
 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const entries = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    const candidate = entries[entries.length - 1] ?? "";
    // Dégarnit un port IPv4 éventuel (« 1.2.3.4:5678 » → « 1.2.3.4 »)
    const ip = candidate.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
    if (ip) return ip;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function getUserAgent(req: Request): string {
  return (req.headers.get("user-agent") ?? "unknown").slice(0, 250);
}

/**
 * Authentification service-à-service (SITE AGENCES ↔ API centrale).
 * Un Bearer CENTRAL_API_SECRET valide (≥ 32 caractères, comparaison à
 * temps constant) identifie une APPLICATION SERVEUR : pas de cookies,
 * donc pas de surface CSRF — les gardes same-origin sont levées.
 * Le secret ne vit QUE côté serveur (jamais NEXT_PUBLIC_*).
 */
export function isServiceAuth(req: Request): boolean {
  const secret = process.env.CENTRAL_API_SECRET ?? "";
  if (secret.length < 32) return false; // secret absent/faible → service auth désactivé
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return timingSafeEqualStr(match[1], secret);
}

/** Comparaison à temps constant pour strings (évite timing attacks). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Refuse les requêtes mutantes sans l'en-tête anti-CSRF maison.
 *  Exception : appel serveur-à-serveur authentifié (Bearer CENTRAL_API_SECRET). */
export function assertSameOriginPost(req: Request): void {
  if (req.method === "GET") return;
  if (isServiceAuth(req)) return;
  const h = req.headers.get("x-requested-with");
  if (h !== "nzoko") {
    throw new ApiError(403, ERROR_CODES.FORBIDDEN, "Requête non autorisée (origine invalide).");
  }
}
