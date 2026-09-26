// ============================================================
// Océan du Nord — Utilitaires espace client (fidélité, dates, formats)
// Pur et typé — aucun accès API.
// ============================================================

import { APP_TIMEZONE, LOYALTY } from "@/lib/constants";
import type { LoyaltyTier } from "@/lib/constants";
import type { LoyaltyRewardDTO } from "@/types";

export interface TierInfo {
  key: LoyaltyTier;
  label: string;
  icon: string;
  min: number;
  max: number;
}

/** Définition du palier (🥉🥈🥇💎) — repli Bronze si inconnu. */
export function tierDef(tier: LoyaltyTier): TierInfo {
  const found = LOYALTY.tiers.find((t) => t.key === tier);
  return found ?? { key: "BRONZE", label: "ONC Bronze", icon: "🥉", min: 0, max: 999 };
}

/** Progression vers le palier suivant (0-100) + palier cible (null au sommet). */
export function tierProgress(
  lifetimePoints: number,
  tier: LoyaltyTier,
): { percent: number; current: TierInfo; next: TierInfo | null } {
  const tiers = [...LOYALTY.tiers];
  const idx = tiers.findIndex((t) => t.key === tier);
  const safeIdx = idx >= 0 ? idx : 0;
  const current = tierDef(tier);
  const next = safeIdx < tiers.length - 1 ? tierDef(tiers[safeIdx + 1].key) : null;
  if (!next) return { percent: 100, current, next: null };
  const span = next.min - current.min;
  const percent = span > 0 ? Math.min(100, Math.max(0, Math.round(((lifetimePoints - current.min) / span) * 100))) : 100;
  return { percent, current, next };
}

/** Prochaine récompense à atteindre (première non encore abordable). */
export function nextRewardTarget(
  balance: number,
  rewards: readonly LoyaltyRewardDTO[],
): { reward: LoyaltyRewardDTO; remaining: number } | null {
  const sorted = [...rewards].sort((a, b) => a.points - b.points);
  for (const reward of sorted) {
    if (reward.points > balance) return { reward, remaining: reward.points - balance };
  }
  return null;
}

/** Date ISO → « YYYY-MM-DD » au fuseau Congo (UTC+1) — recherche de voyages. */
export function congoDateStr(iso: string): string {
  return new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(0, 10);
}

/** 1250 → « 1 250 » (points). */
export function formatPoints(points: number): string {
  return new Intl.NumberFormat("fr-FR").format(points);
}

/** Libellés courts des mois (barres de dépenses). */
export const MONTH_SHORT_LABELS = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
] as const;

/** "2026-01" → "janv." (clé mensuelle des dépenses). */
export function monthLabel(month: string): string {
  const idx = Number.parseInt(month.slice(5, 7), 10) - 1;
  return MONTH_SHORT_LABELS[idx] ?? month;
}

/** Date ISO → clé "YYYY-MM" au fuseau Congo (groupement mensuel des voyages). */
export function monthKey(iso: string): string {
  return congoDateStr(iso).slice(0, 7);
}

/** Date ISO → « Septembre 2026 » (en-tête de groupe des voyages). */
export function monthGroupLabel(iso: string): string {
  const label = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: APP_TIMEZONE,
  }).format(new Date(iso));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Date ISO → libellé compte à rebours (« aujourd'hui », « demain », « dans X j »). */
export function countdownLabel(iso: string): string {
  const days = Math.ceil(
    (new Date(iso).getTime() - new Date().getTime()) / 86_400_000,
  );
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "demain";
  return `dans ${days} j`;
}

/** Initiales colorées — ton déterministe (vert / orange / ambre) selon le nom. */
export function avatarToneClass(fullName: string): string {
  const hash = fullName.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const tones = [
    "bg-primary/15 text-primary",
    "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ] as const;
  return tones[hash % tones.length];
}
