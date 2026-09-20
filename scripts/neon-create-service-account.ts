// Création du COMPTE DE SERVICE NZOKO chez Neon Auth (une seule fois).
//
// Le compte de service permet au serveur NZOKO de :
//  - provisionner les comptes clients qui se connectent pour la
//    première fois par téléphone + OTP (plugin Admin createUser) ;
//  - importer à la volée les comptes internes existants (pont
//    /api/auth/login : bcrypt vérifié → compte Neon même mot de passe).
//
// ÉTAPES (2 minutes) :
//  1. bun scripts/neon-create-service-account.ts
//     → crée le compte (e-mail + mot de passe générés/affichés) ;
//  2. Un code de vérification arrive dans la boîte du propriétaire
//     (geormakoma1@gmail.com) : lancez
//     bun scripts/neon-create-service-account.ts --verify <code>
//  3. Console Neon → Auth → Users → (compte de service) → ⋮ → Make admin ;
//  4. Copiez NEON_AUTH_SERVICE_EMAIL / NEON_AUTH_SERVICE_PASSWORD dans
//     .env (sandbox) ET les variables d'environnement Vercel (production),
//     puis redéployez.
//
// Sécurité : ce compte ne donne AUCUN droit NZOKO (les rôles métier
// vivent dans la base NZOKO). Il est refusé par /api/neon-auth/exchange.

import { randomBytes } from "crypto";

const BASE = (process.env.NEON_AUTH_BASE_URL ?? "").replace(/\/+$/, "");
if (!BASE.startsWith("https://")) {
  console.error("NEON_AUTH_BASE_URL manquante dans .env");
  process.exit(1);
}

const SERVICE_EMAIL = process.env.NEON_AUTH_SERVICE_EMAIL ?? "geormakoma1+service@gmail.com";

// Neon Auth exige un en-tête Origin même en appel serveur-à-serveur.
const ORIGIN = process.env.NEON_SERVICE_ORIGIN ?? "https://nzoko-transport-eight.vercel.app";
const HEADERS = { "Content-Type": "application/json", Origin: ORIGIN };
const verifyCode = process.argv.includes("--verify")
  ? process.argv[process.argv.indexOf("--verify") + 1]
  : null;

async function main() {
  if (verifyCode) {
    // Étape 2 : vérification de l'adresse e-mail avec le code reçu
    const res = await fetch(`${BASE}/email-otp/verify-email`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ email: SERVICE_EMAIL, otp: verifyCode }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      console.error(`Échec de vérification (${res.status}) :`, body);
      process.exit(1);
    }
    console.log("✓ Adresse e-mail du compte de service VÉRIFIÉE.");
    console.log("Dernière étape : console Neon → Auth → Users → ⋮ → Make admin sur ce compte.");
    return;
  }

  // Étape 1 : création (mot de passe aléatoire fort, affiché une fois)
  const password = `Nzoko!Svc-${randomBytes(9).toString("base64url")}`;
  const res = await fetch(`${BASE}/sign-up/email`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      email: SERVICE_EMAIL,
      password,
      name: "NZOKO Service (provisioning)",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.ok || /already exists|user already/i.test(String(body.message ?? ""))) {
    if (res.ok) {
      console.log("✓ Compte de service créé chez Neon Auth :");
    } else {
      console.log("ℹ Le compte existe déjà chez Neon Auth. Réutilisez son mot de passe initial,");
      console.log("  ou supprimez-le depuis la console Neon puis relancez ce script.");
    }
    console.log("");
    console.log(`  NEON_AUTH_SERVICE_EMAIL=${SERVICE_EMAIL}`);
    if (res.ok) {
      console.log(`  NEON_AUTH_SERVICE_PASSWORD=${password}`);
    }
    console.log("");
    console.log("Étape suivante : un code de vérification arrive dans la boîte geormakoma1@gmail.com.");
    console.log(`Lancez : bun scripts/neon-create-service-account.ts --verify <code>`);
    return;
  }

  console.error(`Échec de création (${res.status}) :`, body);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
