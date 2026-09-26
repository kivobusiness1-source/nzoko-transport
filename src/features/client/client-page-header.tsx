"use client";

// ============================================================
// Océan du Nord — En-tête de page de l'espace client (titre H2 + actions)
// Composant partagé par les 6 sections du shell.
// ============================================================

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ClientPageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-5", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Icon className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight lg:text-2xl">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
