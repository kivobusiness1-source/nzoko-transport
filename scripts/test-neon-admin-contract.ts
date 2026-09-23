// ============================================================
// Test du CONTRAT admin du service Neon Auth (S2S, depuis le serveur).
// Documente les endpoints disponibles après la mise à jour du service
// managé (2026-09-23) : create-user, update-user (avec CHANGEMENT
// d'e-mail + emailVerified), set-user-password, remove-user.
// ⚠️ /admin/list-users et /admin/get-user N'EXISTENT PLUS (404).
// Exécution : bun scripts/test-neon-admin-contract.ts
// ============================================================
import "dotenv/config";

const BASE = process.env.NEON_AUTH_BASE_URL ?? "";
const SERVICE_EMAIL = (process.env.NEON_AUTH_SERVICE_EMAIL ?? "").trim().toLowerCase();
const SERVICE_PASSWORD = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";
const ORIGIN = process.env.NEON_SERVICE_ORIGIN?.trim() || "http://localhost:3000";

if (!BASE || !SERVICE_EMAIL || !SERVICE_PASSWORD) {
  console.error("Variables NEON_AUTH_* manquantes.");
  process.exit(1);
}

async function call(path: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown>; setCookies: string[] }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body, setCookies: res.headers.getSetCookie?.() ?? [] };
}

async function main() {
  // 1. Session du compte de service (exige rôle admin — sinon tous les
  //    appels admin répondent 401/403 « not allowed »)
  const signIn = await call("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: SERVICE_EMAIL, password: SERVICE_PASSWORD }),
  });
  if (!signIn.setCookies.length) {
    console.error("✗ Sign-in service impossible :", signIn.status, JSON.stringify(signIn.body).slice(0, 200));
    process.exit(1);
  }
  const user = (signIn.body.user ?? {}) as Record<string, unknown>;
  console.log(`✓ Session service OK (role=${String(user.role)})`);
  if (user.role !== "admin") {
    console.error("✗ Le compte de service n'est PAS admin — les appels admin seront refusés.");
  }

  const cookie = signIn.setCookies.map((c) => c.split(";")[0]).join("; ");
  const authCall = (path: string, payload: unknown) =>
    call(path, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify(payload) });

  // 2. create-user
  const stamp = Date.now();
  const email1 = `nzoko-contract-${stamp}@example.com`;
  const email2 = `nzoko-contract-b-${stamp}@example.com`;
  const created = await authCall("/admin/create-user", {
    email: email1,
    password: "Test@2026!X",
    name: "Contract Test",
    role: "user",
    data: { emailVerified: true },
  });
  const ok1 = created.status === 200;
  console.log(ok1 ? `✓ create-user (${email1})` : `✗ create-user : ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  const userId = ((created.body.user as Record<string, unknown> | undefined)?.id as string | undefined) ?? null;

  if (ok1 && userId) {
    // 3. update-user avec CHANGEMENT d'e-mail (pivot des Paramètres du compte)
    const updated = await authCall("/admin/update-user", {
      userId,
      data: { email: email2, emailVerified: true },
    });
    console.log(updated.status === 200 ? `✓ update-user email → ${email2}` : `✗ update-user : ${updated.status} ${JSON.stringify(updated.body).slice(0, 200)}`);

    // 4. sign-in avec le NOUVEL e-mail + l'ancien mot de passe
    const reSignIn = await call("/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: email2, password: "Test@2026!X" }),
    });
    console.log(reSignIn.status === 200 ? "✓ sign-in avec le nouvel e-mail" : `✗ sign-in : ${reSignIn.status}`);

    // 5. remove-user (nettoyage)
    const removed = await authCall("/admin/remove-user", { userId });
    console.log(removed.status === 200 ? "✓ remove-user (nettoyage)" : `✗ remove-user : ${removed.status}`);
  }
}

main().catch((err) => {
  console.error("Erreur :", err);
  process.exit(1);
});
