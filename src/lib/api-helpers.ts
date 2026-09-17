// ============================================================
// NZOKO TRANSPORT — Helpers partagés des Route Handlers API
// (pagination, clés de jour au fuseau Congo, lectures de query)
// ============================================================

import { addDaysStr, todayStr } from "@/lib/dates";
import type { Paginated } from "@/types";

/** Page clampée ≥ 1 (pageSize fixe par endpoint). */
export function parsePagination(url: URL, defaultPageSize = 20): { page: number; pageSize: number } {
  const raw = Number(url.searchParams.get("page"));
  const page = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return { page, pageSize: defaultPageSize };
}

/** Enveloppe Paginated<T> du contrat. */
export function buildPaginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Clé de jour YYYY-MM-DD au fuseau Congo (UTC+1) pour regrouper des Dates. */
export function congoDayKey(d: Date): string {
  return new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
}

/** Clé de mois YYYY-MM au fuseau Congo. */
export function congoMonthKey(d: Date): string {
  return new Date(d.getTime() + 3600_000).toISOString().slice(0, 7);
}

/** Les N derniers jours (incluant aujourd'hui) au fuseau Congo, du plus ancien au plus récent. */
export function lastDaysStr(days: number): string[] {
  const today = todayStr();
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDaysStr(today, -i));
  return out;
}

/** Mois YYYY-MM en libellé lisible FR (ex : « 2026-02 » → « 02/2026 »). */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${m}/${y}`;
}

/** Détails JSON d'un SecurityLog → chaîne « clé: valeur, … » lisible. */
export function detailsToReadableString(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null) return null;
    if (typeof parsed !== "object") return String(parsed);
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(", ");
  } catch {
    return raw;
  }
}

/** Query string non vide (trim), sinon undefined. */
export function queryString(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  if (v === null) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Scope agence pour les endpoints de lecture agrégée :
 * - rôle global → paramètre agencyId optionnel (null = toutes les agences)
 * - rôle non-global AVEC agence → forcé sur son agence
 * - rôle non-global SANS agence mais permission globale (comptable) → vue consolidée
 * - sinon → 403 (via callback)
 */
export function resolveStatsScope(
  auth: { role: string; agencyId: string | null; permissions: string[] },
  requestedAgencyId: string | null,
  onForbidden: () => never
): string | null {
  if (auth.role === "SUPER_ADMIN" || auth.role === "ADMIN") {
    return requestedAgencyId ?? null;
  }
  if (auth.agencyId) return auth.agencyId;
  if (auth.permissions.includes("stats:global")) return null;
  return onForbidden();
}
