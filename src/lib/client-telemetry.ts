"use client";

// ============================================================
// OCÉAN DU NORD — Télémétrie des erreurs navigateur
//
// Fire-and-forget vers POST /api/client-errors (journal serveur :
// dev.log en développement, stdout Vercel en production). Jamais
// bloquant, jamais remonté à l'utilisateur, aucune boucle possible
// (les échecs d'émission sont ignorés silencieusement).
//
// Deux sources :
//  1. ChunkErrorBoundary (rendu React) — context = vue courante ;
//  2. installGlobalErrorReporting() — erreurs non capturées
//     (window.onerror) et promesses rejetées (unhandledrejection),
//     posées une seule fois par le shell de l'application.
// ============================================================

export interface ClientErrorPayload {
  kind: "render" | "chunk" | "uncaught" | "rejection";
  context: string;
  message: string;
  stack?: string;
  componentStack?: string;
  attempts?: number;
  extra?: string;
}

/** Émet un rapport d'erreur — best effort, aucune exception possible. */
export function reportClientError(payload: ClientErrorPayload): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // En-tête anti-CSRF maison (assertSameOriginPost côté serveur).
        "x-requested-with": "nzoko",
      },
      body: JSON.stringify({
        kind: payload.kind,
        context: payload.context.slice(0, 100),
        message: payload.message.slice(0, 600),
        stack: payload.stack?.slice(0, 2000),
        componentStack: payload.componentStack?.slice(0, 2000),
        attempts: payload.attempts ?? 0,
        extra: payload.extra?.slice(0, 400),
      }),
      // Survit au rechargement de la page (auto-reload des chunks).
      keepalive: true,
    }).catch(() => {
      // Réseau indisponible / route absente : on ignore.
    });
  } catch {
    // JSON.stringify sur un cycle ? fetch indisponible ? On ignore.
  }
}

/**
 * Pose les écouteurs globaux (une seule fois par fenêtre).
 * Retourne la fonction de nettoyage (tests / démontage HMR).
 */
export function installGlobalErrorReporting(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent): void => {
    reportClientError({
      kind: "uncaught",
      context: "window",
      message: event.message || "Erreur non capturée (sans message)",
      stack: event.error instanceof Error ? event.error.stack : undefined,
      extra: `${event.filename}:${event.lineno}:${event.colno}`,
    });
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;
    reportClientError({
      kind: "rejection",
      context: "promise",
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : `Promesse rejetée : ${Object.prototype.toString.call(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
