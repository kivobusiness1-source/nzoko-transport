// ============================================================
// NZOKO TRANSPORT — Logs structurés du module tracking GPS
// Évite de stocker des informations sensibles (jamais de session
// token, ni secrets, ni coordonnées en échec massif).
// ============================================================

type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, message: string, context?: Record<string, unknown>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    scope: `tracking:${scope}`,
    message,
    ...context,
  };
  // Console serveur uniquement — jamais exposé au client.
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  info: (scope: string, message: string, context?: Record<string, unknown>) => emit("info", scope, message, context),
  warn: (scope: string, message: string, context?: Record<string, unknown>) => emit("warn", scope, message, context),
  error: (scope: string, message: string, context?: Record<string, unknown>) => emit("error", scope, message, context),
};
