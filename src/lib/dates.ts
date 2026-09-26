// ============================================================
// OCÉAN DU NORD — Utilitaires date (fuseau Congo UTC+1 fixe)
// Partagé client/serveur (aucune dépendance Node)
// ============================================================

export const TZ_OFFSET = "+01:00"; // Africa/Brazzaville — pas de DST
export const TZ_LABEL = "UTC+1 (Congo)";

/** Plage [début, fin) d'un jour YYYY-MM-DD interprété au fuseau Congo. */
export function dayRange(dateStr: string): { start: Date; end: Date } {
  // ⚠️ Correction bug : `new Date(`${dateStr}T00:00:00+01:00+1day`)` est une
  // date INVALIDE (NaN) dans V8/JSC — le suffixe "+1day" n'est pas supporté.
  // La fin est désormais calculée depuis le début + 24h.
  const start = new Date(`${dateStr}T00:00:00${TZ_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** Date du jour au fuseau Congo au format YYYY-MM-DD. */
export function todayStr(): string {
  return new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00${TZ_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

/** Minutes → "8h30" / "45 min" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}
