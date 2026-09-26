"use client";

// ============================================================
// OCÉAN DU NORD — Helpers de formatage locaux (fuseau Congo)
// (src/lib/format.ts est figé : helpers additionnels ici)
// ============================================================

/** 215 → "3 h 35" · 45 → "45 min" */
export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Date du jour (heure Congo, UTC+1) au format YYYY-MM-DD. */
export function todayCongoISO(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

/** Date décalée de n jours (format YYYY-MM-DD, base heure Congo). */
export function addDaysCongoISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
}

/** Premier jour du mois courant (YYYY-MM-01, heure Congo). */
export function firstOfMonthCongoISO(): string {
  const d = new Date(Date.now() + 3_600_000);
  return `${d.toISOString().slice(0, 7)}-01`;
}

/** "2026-02" → "févr. 26" (label court de mois pour graphiques). */
export function monthShortLabel(month: string): string {
  if (/^\d{4}-\d{2}$/.test(month)) {
    const d = new Date(`${month}-01T00:00:00Z`);
    const name = d.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" });
    return `${name} ${month.slice(2, 4)}`;
  }
  return month;
}

/** Valeur datetime-local (saisie en heure Congo) → ISO UTC. */
export function congoLocalToIso(value: string): string {
  if (!value) return "";
  return new Date(`${value}:00+01:00`).toISOString();
}
