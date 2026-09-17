"use client";

// ============================================================
// NZOKO TRANSPORT — Onglets horizontaux scrollables (chips)
// Sticky sous le header global (h-14) — mobile & desktop.
// ============================================================

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NzokoTabDef {
  key: string;
  label: string;
  icon?: LucideIcon;
}

export function NzokoTabs({
  tabs,
  active,
  onChange,
  ariaLabel = "Sections",
}: {
  tabs: NzokoTabDef[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="sticky top-14 z-30 -mx-4 mb-4 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div role="tablist" aria-label={ariaLabel} className="nzoko-scroll flex gap-2 overflow-x-auto py-2.5">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.key)}
              className={cn(
                "flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.icon && <t.icon className="h-4 w-4" aria-hidden="true" />}
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Sous-onglets compacts (sections internes : parc, journaux…). */
export function NzokoSubTabs({
  tabs,
  active,
  onChange,
  ariaLabel = "Sous-sections",
}: {
  tabs: NzokoTabDef[];
  active: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="nzoko-scroll flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              "flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors",
              isActive
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.icon && <t.icon className="h-3.5 w-3.5" aria-hidden="true" />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
