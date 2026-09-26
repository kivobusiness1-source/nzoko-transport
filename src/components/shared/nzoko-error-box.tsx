"use client";

// ============================================================
// OCÉAN DU NORD — Bloc d'erreur API avec bouton Réessayer
// 404 → module en attente du serveur · 403 → accès refusé
// ============================================================

import { AlertTriangle, CloudOff, RotateCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ApiErrorInfo } from "@/components/shared/nzoko-use-api";

export function NzokoErrorBox({ error, onRetry }: { error: ApiErrorInfo; onRetry?: () => void }) {
  const Icon = error.status === 404 ? CloudOff : error.status === 403 ? ShieldAlert : AlertTriangle;
  const title =
    error.status === 404
      ? "Module en attente du serveur"
      : error.status === 403
        ? "Accès refusé"
        : "Erreur de chargement";

  return (
    <Card className="mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" className="h-11 gap-2" onClick={onRetry}>
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Réessayer
        </Button>
      )}
    </Card>
  );
}
