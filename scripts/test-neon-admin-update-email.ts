// Test direct S2S contre Neon Auth : valide les endpoints admin pour le
// changement d'e-mail (update-user avec data.email) — pivot de la
// fonctionnalité « Paramètres du compte ».
// Exécution : bun scripts/test-neon-admin-update-email.ts
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
  // 1. Session du compte de service
  const signIn = await call("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: SERVICE_EMAIL, password: SERVICE_PASSWORD }),
  });
  if (!signIn.setCookies.length) {
    console.error("✗ Sign-in service impossible :", signIn.status, JSON.stringify(signIn.body).slice(0, 200));
    process.exit(1);
  }
  const cookie = signIn.setCookies.map((c) => c.split(";")[0]).join("; ");
  console.log("✓ Session service OK");

  const authCall = (path: string, payload: unknown) =>
    call(path, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify(payload) });

  // 2. Création d'un compte test
  const testEmail = `nzoko-test-update-${Date.now()}@example.com`;
  const testEmail2 = `nzoko-test-update2-${Date.now()}@example.com`;
  const created = await authCall("/admin/create-user", {
    email: testEmail,
    password: "Test@2026!X",
    name: "Test Update",
    role: "user",
    data: { emailVerified: true },
  });
  console.log(created.status === 200 ? `✓ create-user OK (${testEmail})` : `✗ create-user : ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
  const userId = ((created.body.user as Record<string, unknown> | undefined)?.id as string | undefined) ?? null;

  // 3. update-user avec CHANGEMENT d'email
  if (userId) {
    const updated = await authCall("/admin/update-user", {
      userId,
      data: { email: testEmail2, emailVerified: true },
    });
    console.log(updated.status === 200 ? `✓ update-user email OK → ${testEmail2}` : `✗ update-user email : ${updated.status} ${JSON.stringify(updated.body).slice(0, 300)}`);

    // 4. Vérification : list-users sur le NOUVEL email
    const listed = await authCall("/admin/list-users", {
      query: { searchField: "email", searchValue: testEmail2, searchOperator: "eq", limit: 5 },
    });
    const users = (listed.body.users as Array<{ id?: string; email?: string }> | undefined) ?? [];
    const found = users.some((u) => u.email === testEmail2);
    console.log(found ? "✓ list-users confirme le NOUVEL email" : `? list-users : ${listed.status} users=${JSON.stringify(users).slice(0, 200)}`);

    // 5. sign-in avec le NOUVEL email + mot de passe (l'email change bien d'identité ?)
    const reSignIn = await call("/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: testEmail2, password: "Test@2026!X" }),
    });
    console.log(reSignIn.status === 200 ? "✓ sign-in avec le NOUVEL email OK" : `✗ sign-in nouvel email : ${reSignIn.status} ${JSON.stringify(reSignIn.body).slice(0, 200)}`);

    // 6. Nettoyage : remove-user ?
    const removed = await authCall("/admin/remove-user", { userId });
    console.log(removed.status === 200 ? "✓ remove-user OK (nettoyage)" : `✗ remove-user : ${removed.status} ${JSON.stringify(removed.body).slice(0, 200)}`);
  }
}

main().catch((err) => {
  console.error("Erreur :", err);
  process.exit(1);
});
