// ============================================================
// OCÉAN DU NORD — Formatage (client) : argent, dates, fuseau Congo
// ============================================================

import { APP_TIMEZONE } from "@/lib/constants";

export function formatMoney(amount: number, currency = "FCFA"): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} ${currency}`;
}

export function formatMoneyShort(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace(".0", "")} M`;
  if (amount >= 1000) return `${Math.round(amount / 1000)} k`;
  return String(amount);
}

function fmt(iso: string | Date, opts: Intl.DateTimeFormatOptions): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("fr-FR", { ...opts, timeZone: APP_TIMEZONE }).format(d);
}

export function formatDate(iso: string | Date): string {
  return fmt(iso, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateShort(iso: string | Date): string {
  return fmt(iso, { day: "2-digit", month: "2-digit" });
}

export function formatTime(iso: string | Date): string {
  return fmt(iso, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso: string | Date): string {
  return fmt(iso, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(iso: string | Date): string {
  return fmt(iso, { weekday: "long", day: "numeric", month: "long" });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
}

export function relativeTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

export function minutesToCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expiré";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}
