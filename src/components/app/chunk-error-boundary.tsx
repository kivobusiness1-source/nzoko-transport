"use client";

// ============================================================
// OCÉAN DU NORD — ErrorBoundary de récupération des modules
// asynchrones (React.lazy / code-splitting Turbopack).
//
// Contexte (incident récurrent) : après un redémarrage du serveur
// de développement ou de la machine (ou une corruption du cache
// .next), le navigateur peut conserver des références vers des
// chunks obsolètes (« ChunkLoadError », « Failed to fetch
// dynamically imported module »…). Le module ne peut alors plus
// être résolu et l'espace concerné ne s'affiche plus.
//
// Stratégie de récupération :
//   1. Auto-rechargement de la page UNE SEULE fois (garde
//      sessionStorage de 30 s — évite la boucle infinie si le
//      serveur est réellement indisponible).
//   2. Si le rechargement a déjà été tenté récemment : écran de
//      secours français avec « Réessayer » (re-déclenche l'import
//      lazy — fonctionne dès que le chunk est régénéré) et
//      « Recharger la page » (rechargement complet).
// ============================================================

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/client-telemetry";

/** Signatures des erreurs de chargement de modules/chunks.
 *  ⚠️ Turbopack ≠ webpack : le TYPE est dans error.name
 *  ("ChunkLoadError") et le message est « Failed to load chunk X from
 *  module Y (ecmascript, async loader) » — aucun des motifs historiques
 *  (format webpack) ne matchait → l'erreur était classée « rendu » et
 *  affichait l'écran générique au lieu de l'auto-rechargement
 *  (incident panel admin du 2026-09-19, cf. /api/client-errors). */
const CHUNK_ERROR_PATTERNS: readonly string[] = [
  "ChunkLoadError", // nom d'erreur (Turbopack) + message historique
  "Failed to load chunk", // Turbopack (async loader)
  "Failed to load module", // Turbopack (variante module)
  "Failed to fetch dynamically imported module", // webpack/Vite
  "Importing a module script failed",
  "error loading dynamically imported module",
  "Loading chunk",
  "Loading CSS chunk",
  "Unable to preload CSS",
  "Network error when loading chunk",
  "module script failed",
];

/** Clé sessionStorage de la garde anti-boucle (dernier auto-rechargement). */
const RELOAD_GUARD_KEY = "nzoko:chunk-auto-reload";
/** Fenêtre (ms) pendant laquelle on ne ré-auto-recharge pas une seconde fois. */
const RELOAD_GUARD_WINDOW_MS = 30_000;

function isChunkLoadError(message: string): boolean {
  return CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

interface ChunkErrorBoundaryProps {
  children: ReactNode;
  /** Vue/section concernée (télémétrie : « workspace », « booking »…). */
  context?: string;
}

interface ChunkErrorBoundaryState {
  error: Error | null;
  attempts: number;
}

export class ChunkErrorBoundary extends Component<ChunkErrorBoundaryProps, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = { error: null, attempts: 0 };

  static getDerivedStateFromError(error: Error): Partial<ChunkErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Turbopack met le type dans error.NAME ("ChunkLoadError") — il faut
    // tester nom + message + tête de pile, pas le message seul.
    const haystack = `${error.name}: ${error.message} ${error.stack?.slice(0, 400) ?? ""}`;
    const chunkRelated = isChunkLoadError(haystack);
    console.error(
      `[Océan du Nord] ${chunkRelated ? "Chunk/module introuvable (serveur redémarré ?)" : "Erreur d'affichage de la vue"} :`,
      error.message,
      info.componentStack ?? ""
    );

    // Télémétrie serveur (dev.log / stdout Vercel) — sans elle, un
    // plantage d'affichage ne laisse AUCUNE trace côté serveur alors
    // que toutes les API répondent 200 (incident panel admin 2026-09-19).
    reportClientError({
      kind: chunkRelated ? "chunk" : "render",
      context: this.props.context ?? "unknown",
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      attempts: this.state.attempts,
    });

    if (chunkRelated && typeof window !== "undefined") {
      try {
        const lastRaw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
        const last = lastRaw ? Number(lastRaw) : 0;
        const now = Date.now();
        // Auto-rechargement une seule fois par fenêtre de 30 s :
        // le rechargement force le navigateur à récupérer le
        // manifeste des chunks à jour depuis le serveur.
        if (!Number.isFinite(last) || now - last > RELOAD_GUARD_WINDOW_MS) {
          window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
          window.location.reload();
        }
      } catch {
        // sessionStorage indisponible (navigation privée, quota) :
        // on reste sur l'écran de secours avec actions manuelles.
      }
    }
  }

  /** « Réessayer » : relance l'import lazy (le chunk est régénéré côté serveur). */
  private handleRetry = (): void => {
    this.setState((previous) => ({ error: null, attempts: previous.attempts + 1 }));
  };

  /** « Recharger la page » : rechargement complet (lève aussi la garde). */
  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch {
        // Ignorer (navigation privée) — le rechargement reste pertinent.
      }
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error, attempts } = this.state;
    if (!error) return this.props.children;

    const haystack = `${error.name}: ${error.message} ${error.stack?.slice(0, 400) ?? ""}`;
    const chunkRelated = isChunkLoadError(haystack);

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4" role="alert" aria-live="assertive">
        <div className="w-full max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
          <span
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            aria-hidden="true"
          >
            <AlertTriangle className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-bold text-foreground">
            {chunkRelated ? "Module indisponible" : "Une erreur est survenue"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {chunkRelated
              ? "Un composant de l'application n'a pas pu être chargé (mise à jour du serveur en cours ou connexion instable). Votre session est conservée — réessayez ou rechargez la page."
              : "L'affichage de cette section a échoué. Vos données sont intactes — vous pouvez réessayer."}
          </p>
          {attempts > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Tentative de rechargement n°{attempts}.</p>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={this.handleRetry} variant="outline" className="min-h-[44px]">
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Réessayer
            </Button>
            <Button onClick={this.handleReload} className="min-h-[44px]">
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              Recharger la page
            </Button>
          </div>
          <p className="mt-4 text-[11px] text-muted-foreground/70">
            Si le problème persiste, vérifiez votre connexion internet puis reconnectez-vous.
          </p>
        </div>
      </div>
    );
  }
}
