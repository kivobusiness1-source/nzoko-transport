// Vérification COMPLÈTE du socle d'authentification unifiée Neon Auth.
// À lancer après : création + vérification + « Make admin » du compte de
// service, et configuration du webhook dans la console Neon.
//
//   bun scripts/neon-check-service.ts
//
// Testé de bout en bout (aucune écriture métier) :
//  1. Santé du service (/ok) ;
//  2. Connexion du compte de service (sign-in/email) ;
//  3. Droits admin (list-users) ;
//  4. Provisioning téléphone (create-user data.phoneNumber sur un numéro
//     factice +242 99 000 000 — puis nettoyage) ;
//  5. Alerte webhook (send-otp doit répondre WEBHOOK_NOT_CONFIGURED si
//     le webhook n'est pas encore configuré — info seule, pas un échec).

const BASE = (process.env.NEON_AUTH_BASE_URL ?? "").replace(/\/+$/, "");
const EMAIL = process.env.NEON_AUTH_SERVICE_EMAIL ?? "";
const PASSWORD = process.env.NEON_AUTH_SERVICE_PASSWORD ?? "";

if (!BASE.startsWith("https://") || !EMAIL || !PASSWORD) {
  console.error("Renseignez NEON_AUTH_BASE_URL, NEON_AUTH_SERVICE_EMAIL et NEON_AUTH_SERVICE_PASSWORD dans .env");
  process.exit(1);
}

async function main() {
  let failures = 0;
  const check = (ok: boolean, label: string, detail?: string) => {
    console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures += 1;
  };

  // 1. Santé
  const okRes = await fetch(`${BASE}/ok`).catch(() => null);
  check(Boolean(okRes?.ok), "Service Neon Auth joignable (/ok)");

  // 2. Connexion du compte de service
  const signIn = await fetch(`${BASE}/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const signInBody = (await signIn.json().catch(() => ({}))) as Record<string, unknown>;
  check(signIn.ok, "Connexion du compte de service", signIn.ok ? undefined : String(signInBody.message ?? signIn.status));
  if (!signIn.ok) {
    console.error("\n→ Vérifiez que l'e-mail du compte a été VÉRIFIÉ (code reçu) avant tout autre chose.");
    process.exit(1);
  }
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  // 3. Droits admin
  const list = await fetch(`${BASE}/admin/list-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ query: { limit: 1 } }),
  });
  check(list.ok, "Droits admin du compte de service (list-users)", list.ok ? undefined : `HTTP ${list.status} — « Make admin » manquant dans la console ?`);

  // 4. Provisioning téléphone (numéro factice, nettoyé ensuite)
  const testPhone = "+24299000000";
  const synthetic = `${testPhone}@phone.nzoko.cg`;
  const create = await fetch(`${BASE}/admin/create-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ email: synthetic, name: "Test provisioning", role: "user", data: { phoneNumber: testPhone } }),
  });
  const createBody = (await create.json().catch(() => ({}))) as { user?: { id?: string }; message?: string };
  check(
    create.ok,
    "Provisioning téléphone (create-user + data.phoneNumber)",
    create.ok ? `utilisateur ${createBody.user?.id?.slice(0, 8) ?? "?"}…` : String(createBody.message ?? create.status)
  );
  if (create.ok && createBody.user?.id) {
    const del = await fetch(`${BASE}/admin/remove-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ userId: createBody.user.id }),
    });
    console.log(`${del.ok ? "✓" : "ℹ"} Nettoyage du compte factice (${del.ok ? "supprimé" : `HTTP ${del.status}`})`);
  }

  // 5. État du webhook (information)
  const otp = await fetch(`${BASE}/phone-number/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: testPhone }),
  });
  const otpBody = (await otp.json().catch(() => ({}))) as Record<string, unknown>;
  if (otpBody.code === "WEBHOOK_NOT_CONFIGURED") {
    console.log("ℹ Webhook send.otp NON configuré → configurez-le dans la console Neon :");
    console.log("    URL : https://nzoko-transport-eight.vercel.app/api/webhooks/neon-auth");
    console.log("    Événements : send.otp, phone_number.verified");
  } else {
    console.log(`ℹ Réponse send-otp : HTTP ${otp.status} ${String(otpBody.message ?? "")}`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} vérification(s) en échec — corrigez puis relancez.`);
    process.exit(1);
  }
  console.log("Socle Neon Auth : OPÉRATIONNEL ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
