"use client";

// ============================================================
// NZOKO — Carte KPI espace client : icône en carré coloré,
// valeur XL semibold, libellé muted (aperçu & dépenses).
// ============================================================

import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-primary/10 text-primary",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type ClientKpiTone = keyof typeof TONES;

export function ClientKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: ClientKpiTone;
}) {
  return (
    <Card className="nzoko-fade-up gap-0 p-4 py-4">
      <span
        className={cn("flex size-10 items-center justify-center rounded-xl", TONES[tone])}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <p className="mt-3 text-xl font-semibold leading-none tabular-nums sm:text-2xl">{value}</p>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </Card>
  );
}
