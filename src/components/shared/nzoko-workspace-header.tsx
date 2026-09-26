"use client";

// ============================================================
// OCÉAN DU NORD — En-tête d'espace (titre + utilisateur)
// ============================================================

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionUser } from "@/types";

export function NzokoWorkspaceHeader({
  title,
  icon: Icon,
  session,
  onRefresh,
  extra,
}: {
  title: string;
  icon: LucideIcon;
  session: SessionUser;
  onRefresh?: () => void;
  extra?: ReactNode;
}) {
  return (
    <header className="pt-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm"
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">{session.fullName}</p>
          </div>
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={onRefresh}
            aria-label="Rafraîchir les données"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{session.roleLabel}</Badge>
        {session.agencyName ? (
          <Badge variant="outline">{session.agencyName}</Badge>
        ) : (
          <Badge variant="outline">Toutes agences</Badge>
        )}
        {extra}
      </div>
    </header>
  );
}
