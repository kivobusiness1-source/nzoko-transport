// ============================================================
// OCÉAN DU NORD — Livraison des codes OTP (SMS + e-mail)
// ============================================================
// Neon Auth ne livre NI les SMS NI les e-mails lui-même dès que le
// webhook « send.otp » est configuré : NOTRE application devient
// responsable de la livraison du code, selon le canal demandé par
// l'événement (delivery_preference "sms" → téléphone, sinon e-mail).
//
// Adaptateurs (choisis par variables d'environnement, JAMAIS de secret
// côté client) :
//  - SMS    : SMS_PROVIDER = esms | africastalking | twilio | log
//    (« esms » = eSMS Africa, esmsafrica.io — Congo-Brazzaville : MTN ·
//    Airtel, routes opérateur directes ; recommandé par l'exploitant)
//  - E-mail : EMAIL_PROVIDER = smtp | resend | log
//
// « log » (défaut sandbox) journalise la livraison sans l'effectuer —
// en production, configurez un vrai fournisseur, sinon les codes ne
// partiront pas (erreur explicite renvoyée au service Neon).
// ============================================================

import { randomUUID } from "crypto";

export interface DeliveryResult {
  delivered: boolean;
  provider: string;
  error?: string;
}

// ------------------------------------------------------------
// SMS
// ------------------------------------------------------------

function franceToE164(phone: string): string {
  return phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim().replace(/^0+/, "")}`;
}

// ------------------------------------------------------------
// eSMS Africa (esmsafrica.io) — contrat API confirmé via le SDK
// officiel `esms-sms` v1.0.0 (source dist/index.js) + exemples du site :
//   POST {base}/messages/send
//   Authorization: Bearer esms_live_… (prod) | esms_test_… (sandbox)
//   { "to": "+24206…", "text": "…", "sender_id": "…" (optionnel) }
//   → 200 { "id": "…", "status": "submitted", "route": "ESMS_CG", … }
// Couverture Congo-Brazzaville : MTN · Airtel (API « Production »).
// ------------------------------------------------------------

async function sendSmsEsms(to: string, message: string): Promise<DeliveryResult> {
  const apiKey = process.env.ESMS_API_KEY ?? "";
  if (!apiKey) {
    return { delivered: false, provider: "esms", error: "ESMS_API_KEY manquante (clé esms_live_… du dashboard eSMS Africa, menu Développeurs → API Keys)." };
  }
  const baseUrl = (process.env.ESMS_BASE_URL ?? "https://sms.esmsafrica.io/api").replace(/\/+$/, "");
  const senderId = process.env.ESMS_SENDER_ID ?? "";
  const res = await fetch(`${baseUrl}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      to: franceToE164(to),
      text: message,
      ...(senderId ? { sender_id: senderId } : {}),
    }),
    // Le webhook Neon attend une réponse rapide (les relances côté Neon
    // sont limitées) : timeout court, pas de reprise automatique.
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    message?: string;
    error?: { message?: string };
  };
  if (res.ok) {
    const status = (json.status ?? "").toLowerCase();
    // Accepté par la passerelle dès « submitted »/« queued » (la remise
    // finale est suivie côté eSMS, cf. delivery reports).
    if (!status || /submitted|queued|sent|accepted|delivered/.test(status)) {
      return { delivered: true, provider: "esms" };
    }
    return { delivered: false, provider: "esms", error: `statut eSMS inattendu : « ${status} »`.slice(0, 180) };
  }
  if (res.status === 401 || res.status === 403) {
    return { delivered: false, provider: "esms", error: `clé API refusée (HTTP ${res.status}) — vérifier ESMS_API_KEY.` };
  }
  if (res.status === 422) {
    // 422 = requête invalide OU solde insuffisant (InsufficientBalanceError
    // du SDK : .balance / .cost / .currency).
    return {
      delivered: false,
      provider: "esms",
      error: `requête refusée (HTTP 422) — solde insuffisant ou paramètre invalide : ${json.message ?? json.error?.message ?? "?"}`.slice(0, 180),
    };
  }
  if (res.status === 429) {
    return { delivered: false, provider: "esms", error: "limite de débit eSMS (HTTP 429) — réessayer plus tard." };
  }
  return { delivered: false, provider: "esms", error: `HTTP ${res.status} ${json.message ?? json.error?.message ?? ""}`.slice(0, 180) };
}

async function sendSmsAfricaTalking(to: string, message: string): Promise<DeliveryResult> {
  const apiKey = process.env.AFRICASTALKING_API_KEY ?? "";
  const username = process.env.AFRICASTALKING_USERNAME ?? "";
  const senderId = process.env.AFRICASTALKING_SENDER_ID ?? ""; // optionnel (Congo)
  if (!apiKey || !username) {
    return { delivered: false, provider: "africastalking", error: "AFRICASTALKING_API_KEY / AFRICASTALKING_USERNAME manquants." };
  }
  const body = new URLSearchParams({
    username,
    to: franceToE164(to),
    message,
    ...(senderId ? { from: senderId } : {}),
  });
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: { apiKey, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: Array<{ status?: string }> } };
  const recipientStatus = json.SMSMessageData?.Recipients?.[0]?.status ?? "";
  if (res.ok && /success/i.test(recipientStatus)) return { delivered: true, provider: "africastalking" };
  return { delivered: false, provider: "africastalking", error: `HTTP ${res.status} ${recipientStatus}`.slice(0, 180) };
}

async function sendSmsTwilio(to: string, message: string): Promise<DeliveryResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_FROM_NUMBER ?? "";
  if (!sid || !token || !from) {
    return { delivered: false, provider: "twilio", error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER manquants." };
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: franceToE164(to), From: from, Body: message }),
  });
  if (res.ok) return { delivered: true, provider: "twilio" };
  const text = (await res.text().catch(() => "")).slice(0, 160);
  return { delivered: false, provider: "twilio", error: `HTTP ${res.status} ${text}` };
}

/** Envoie un SMS via le fournisseur configuré (SMS_PROVIDER). */
export async function sendSms(to: string, message: string): Promise<DeliveryResult> {
  const provider = (process.env.SMS_PROVIDER ?? "log").trim().toLowerCase();
  try {
    if (provider === "esms") return await sendSmsEsms(to, message);
    if (provider === "africastalking") return await sendSmsAfricaTalking(to, message);
    if (provider === "twilio") return await sendSmsTwilio(to, message);
  } catch (err) {
    return { delivered: false, provider, error: err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180) };
  }
  if (provider === "log" && process.env.OTP_DEBUG !== "true") {
    // PRODUCTION sans fournisseur configuré : échec EXPLICITE. Renvoyer
    // « delivered: true » masquerait une livraison impossible (l'attente
    // d'un SMS qui ne partira jamais) — le webhook informe Neon via 502.
    return {
      delivered: false,
      provider: "log",
      error: "Aucun fournisseur SMS configuré (SMS_PROVIDER) — envoi impossible.",
    };
  }
  // Mode « log » : sandbox/développement (OTP_DEBUG) — aucune livraison réelle
  // eslint-disable-next-line no-console -- journal serveur volontaire (traçabilité livraison)
  console.log(`[sms:${provider}] (non livré — SMS_PROVIDER=log) → ${to} : « ${message} »`);
  return { delivered: true, provider: "log" };
}

// ------------------------------------------------------------
// E-mail (SMTP / Resend)
// ------------------------------------------------------------

async function sendEmailSmtp(to: string, subject: string, text: string, html?: string): Promise<DeliveryResult> {
  const host = process.env.SMTP_HOST ?? "";
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASSWORD ?? "";
  const from = process.env.SMTP_FROM ?? user;
  if (!host || !user || !pass) {
    return { delivered: false, provider: "smtp", error: "SMTP_HOST / SMTP_USER / SMTP_PASSWORD manquants." };
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  await transport.sendMail({ from, to, subject, text, html: html ?? text });
  return { delivered: true, provider: "smtp" };
}

async function sendEmailResend(to: string, subject: string, text: string, html?: string): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.RESEND_FROM ?? "Océan du Nord <onboarding@resend.dev>";
  if (!apiKey) {
    return { delivered: false, provider: "resend", error: "RESEND_API_KEY manquante." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html: html ?? text }),
  });
  if (res.ok) return { delivered: true, provider: "resend" };
  const body = (await res.text().catch(() => "")).slice(0, 160);
  return { delivered: false, provider: "resend", error: `HTTP ${res.status} ${body}` };
}

/** Envoie un e-mail via le fournisseur configuré (EMAIL_PROVIDER). */
export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<DeliveryResult> {
  const provider = (process.env.EMAIL_PROVIDER ?? "log").trim().toLowerCase();
  try {
    if (provider === "smtp") return await sendEmailSmtp(to, subject, text, html);
    if (provider === "resend") return await sendEmailResend(to, subject, text, html);
  } catch (err) {
    return { delivered: false, provider, error: err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180) };
  }
  if (provider === "log" && process.env.OTP_DEBUG !== "true") {
    // PRODUCTION sans fournisseur configuré : échec EXPLICITE (fin du
    // « code jamais reçu » silencieux — cf. signalement utilisateur). Le
    // webhook renvoie 502 au service Neon, qui journalise l'échec ; le
    // sandbox (OTP_DEBUG) conserve le mode log pour les flux de démo.
    return {
      delivered: false,
      provider: "log",
      error: "Aucun fournisseur d'e-mail configuré (EMAIL_PROVIDER) — envoi impossible.",
    };
  }
  // eslint-disable-next-line no-console -- journal serveur volontaire (traçabilité livraison)
  console.log(`[email:${provider}] (non livré — EMAIL_PROVIDER=log) → ${to} : « ${subject} »`);
  return { delivered: true, provider: "log" };
}

// ------------------------------------------------------------
// Messages Océan du Nord (français, marché congolais)
// ------------------------------------------------------------

export function otpSmsMessage(code: string, expiresInMinutes: number): string {
  return `Océan du Nord : votre code de connexion est ${code}. Il expire dans ${expiresInMinutes} minutes. Ne le partagez jamais.`;
}

export function otpEmailContent(input: { code: string; otpType: string; expiresInMinutes: number }): { subject: string; text: string; html: string } {
  const action =
    input.otpType === "forget-password"
      ? "réinitialisation de votre mot de passe"
      : input.otpType === "email-verification"
        ? "vérification de votre adresse e-mail"
        : "connexion à votre espace";
  const subject = `Océan du Nord — code ${input.code}`;
  const text = `Votre code de ${action} est ${input.code}. Il expire dans ${input.expiresInMinutes} minutes. Ne le partagez jamais avec qui que ce soit.`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:#16a34a;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">OCÉAN DU NORD</div>
    <div style="padding:24px">
      <p style="margin:0 0 12px">Votre code de <strong>${action}</strong> :</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:0 0 12px;color:#16a34a">${input.code}</p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px">Ce code expire dans ${input.expiresInMinutes} minutes.</p>
      <p style="color:#6b7280;font-size:12px;margin:0">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.</p>
    </div>
  </div>`;
  return { subject, text, html };
}

/** Identifiant d'événement court pour les journaux. */
export function shortEventId(): string {
  return randomUUID().slice(0, 8);
}

// ------------------------------------------------------------
// Réinitialisation de mot de passe oublié (e-mail)
// ------------------------------------------------------------

/** Contenu de l'e-mail « mot de passe oublié » : code de réinitialisation à 6 chiffres. */
export function passwordResetEmailContent(input: { code: string; expiresInMinutes: number }): { subject: string; text: string; html: string } {
  const subject = `Océan du Nord — réinitialisation de votre mot de passe (code ${input.code})`;
  const text =
    `Vous avez demandé la réinitialisation du mot de passe de votre compte Océan du Nord. ` +
    `Votre code de vérification est ${input.code}. Il expire dans ${input.expiresInMinutes} minutes. ` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail : votre mot de passe actuel reste valable.`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    <div style="background:#16a34a;color:#fff;padding:20px 24px;font-size:18px;font-weight:bold">OCÉAN DU NORD</div>
    <div style="padding:24px">
      <p style="margin:0 0 12px">Vous avez demandé la <strong>réinitialisation de votre mot de passe</strong>. Voici votre code de vérification :</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:0 0 12px;color:#16a34a">${input.code}</p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px">Ce code expire dans ${input.expiresInMinutes} minutes. Il n'est valable que pour une seule utilisation.</p>
      <p style="color:#6b7280;font-size:12px;margin:0">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable. Ne partagez jamais ce code.</p>
    </div>
  </div>`;
  return { subject, text, html };
}
