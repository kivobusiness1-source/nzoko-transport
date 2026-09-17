"use client";

// ============================================================
// NZOKO TRANSPORT — KPI card réutilisable (dashboards)
// ============================================================

import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONES = {
  green: "bg-primary/10 text-primary",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
} as const;

export type NzokoKpiTone = keyof typeof TONES;

export function NzokoKpiCard({
  label,
  value,
  icon: Icon,
  tone = "green",
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: NzokoKpiTone;
  hint?: string;
}) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-3">
        <span
          className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", TONES[tone])}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-bold leading-tight tabular-nums">{value}</p>
        </div>
      </div>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </Card>
  );
}
