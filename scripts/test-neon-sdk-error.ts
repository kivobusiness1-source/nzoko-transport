// ============================================================
// NZOKO — Test empirique : forme de l'erreur retournée par le SDK
// @neondatabase/auth (client navigateur) sur un signIn.email invalide.
// Objectif : comprendre pourquoi neonAuthErrorMessage() ne traduit
// pas « Invalid email or password » en production (le pont d'import
// /api/auth/login n'est jamais appelé par auth-screen.tsx).
// Exécution : bun scripts/test-neon-sdk-error.ts (dans le projet).
// ============================================================

import { createAuthClient } from "@neondatabase/auth/next";

const ORIGIN = "https://nzoko-transport-eight.vercel.app";

// Shim navigateur : le SDK résout son baseURL depuis window.location.origin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = {
  location: { origin: ORIGIN, href: `${ORIGIN}/`, protocol: "https:", host: "nzoko-transport-eight.vercel.app" },
  fetch: globalThis.fetch.bind(globalThis),
};

async function main() {
  const client = createAuthClient();

  console.log("— signIn.email avec identifiants inconnus —");
  const { data, error } = await client.signIn.email({
    email: "inconnu-test@nzoko.cg",
    password: "MotDePasseFaux123",
  });

  console.log("data:", data);
  if (!error) {
    console.log("!! pas d'erreur retournée");
    return;
  }
  console.log("— ERREUR —");
  console.log("typeof:", typeof error, "| ctor:", error.constructor?.name);
  console.log("message:", JSON.stringify((error as { message?: string }).message));
  console.log("code:", JSON.stringify((error as { code?: string }).code));
  console.log("status:", (error as { status?: number }).status);
  console.log("clés propres:", Object.keys(error));
  console.log("JSON complet:", JSON.stringify(error, Object.getOwnPropertyNames(error)));

  // Réplique exacte de neonAuthErrorMessage (src/lib/neon-auth/client.ts)
  const message = ((error as { message?: string }).message ?? "").toLowerCase();
  const code = ((error as { code?: string }).code ?? "").toUpperCase();
  const match =
    code === "INVALID_CREDENTIALS" || /invalid email or password|invalid password|invalid_credentials/.test(message);
  console.log("— réplique traduction —");
  console.log("message lower:", JSON.stringify(message));
  console.log("code upper:", JSON.stringify(code));
  console.log("branche credentials matchée ?", match);
}

main().catch((err) => {
  console.error("Échec du script:", err);
  process.exit(1);
});
