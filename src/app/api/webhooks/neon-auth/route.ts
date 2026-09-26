// ============================================================
// NZOKO TRANSPORT — Webhook Neon Auth (Managed Better Auth)
// ============================================================
// Dès que ce webhook est configuré dans la console Neon (URL HTTPS
// publique + événements send.otp / phone_number.verified), le service
// managé nous délègue LA LIVRAISON DES CODES :
//  - send.otp + delivery_preference "sms"  → fournisseur SMS
//    (SMS_PROVIDER : esms | africastalking | twilio | log) ;
//  - send.otp + e-mail (vérification d'adresse, mot de passe oublié)
//    → fournisseur e-mail (EMAIL_PROVIDER : smtp | resend | log) ;
//  - phone_number.verified (non bloquant) → journal d'audit.
//
// ⚠️ Tant que le webhook est actif, Neon NE REMPLIT PLUS lui-même
// l'envoi des e-mails OTP : c'est cette route qui livre tout.
//
// Sécurité (guide officiel Neon) :
//  - signature EdDSA Ed25519 détachée (X-Neon-Signature), clé publique
//    du JWKS du projet, horodatage lié à la signature (anti-rejeu) ;
//  - rejet des requêtes de plus de 5 minutes ;
//  - idempotence par X-Neon-Event-Id (les tentatives rejouées
//    renvoient la même réponse sans redélivrer de code) ;
//  - code OTP JAMAIS journalisé (seuls le canal et le statut le sont).
// ============================================================

import { createPublicKey, verify as edVerify, type KeyObject } from "crypto";
import { db } from "@/lib/db";
import { neonAuthBaseUrl, isNeonAuthEnabled } from "@/lib/neon-auth/server";
import { sendSms, sendEmail, otpSmsMessage, otpEmailContent } from "@/lib/neon-auth/delivery";

export const dynamic = "force-dynamic";

// ---------- JWKS (cache mémoire 1 h) ----------

interface JwkKey {
  kid: string;
  kty: string;
  crv: string;
  x: string;
}

let jwksCache: { keys: Map<string, KeyObject>; fetchedAt: number } | null = null;

async function getNeonJwks(): Promise<Map<string, KeyObject>> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 60 * 60 * 1000) {
    return jwksCache.keys;
  }
  const res = await fetch(`${neonAuthBaseUrl}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`JWKS indisponible (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { keys?: JwkKey[] };
  const keys = new Map<string, KeyObject>();
  for (const jwk of data.keys ?? []) {
    if (jwk.kty === "OKP" && jwk.crv === "Ed25519") {
      keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    }
  }
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

// ---------- Vérification de signature (EdDSA Ed25519 détachée) ----------

function b64urlToBuffer(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function verifyNeonSignature(rawBody: string, headers: Headers): Promise<{ valid: boolean; reason?: string }> {
  const signature = headers.get("x-neon-signature");
  const kid = headers.get("x-neon-signature-kid");
  const timestamp = headers.get("x-neon-timestamp");
  if (!signature || !kid || !timestamp) {
    return { valid: false, reason: "en-têtes de signature absents" };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { valid: false, reason: "horodatage trop ancien ou invalide" };
  }

  const [headerB64, , signatureB64] = signature.split("..");
  if (!headerB64 || !signatureB64) {
    return { valid: false, reason: "signature détachée malformée" };
  }

  let key: KeyObject | undefined;
  try {
    const keys = await getNeonJwks();
    key = keys.get(kid);
  } catch (err) {
    return { valid: false, reason: `JWKS : ${err instanceof Error ? err.message : "erreur"}` };
  }
  if (!key) {
    return { valid: false, reason: `clé inconnue (kid ${kid})` };
  }

  // Reconstruit l'entrée de signature (double base64url, cf. doc Neon) :
  // payloadB64 = base64url(rawBody) ; signaturePayload = timestamp + "." + payloadB64 ;
  // signaturePayloadB64 = base64url(signaturePayload) ; signingInput = header + "." + signaturePayloadB64
  const payloadB64 = Buffer.from(rawBody, "utf8").toString("base64url");
  const signaturePayload = `${timestamp}.${payloadB64}`;
  const signaturePayloadB64 = Buffer.from(signaturePayload, "utf8").toString("base64url");
  const signingInput = `${headerB64}.${signaturePayloadB64}`;

  const ok = edVerify(null, Buffer.from(signingInput, "utf8"), key, b64urlToBuffer(signatureB64));
  return ok ? { valid: true } : { valid: false, reason: "signature invalide" };
}

// ---------- Idempotence (X-Neon-Event-Id) ----------

const recentEventIds = new Map<string, number>();
const IDEMPOTENCE_TTL = 15 * 60 * 1000;

function isDuplicate(eventId: string): boolean {
  const now = Date.now();
  for (const [id, at] of recentEventIds) {
    if (now - at > IDEMPOTENCE_TTL) recentEventIds.delete(id);
  }
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.set(eventId, now);
  return false;
}

// ---------- Payload ----------

interface NeonWebhookUser {
  id?: string;
  email?: string;
  name?: string;
  phone_number?: string;
  phone_number_verified?: boolean;
}

interface NeonWebhookPayload {
  event_id?: string;
  event_type?: string;
  user?: NeonWebhookUser;
  event_data?: {
    otp_code?: string;
    otp_type?: string;
    delivery_preference?: string;
    expires_at?: string;
    phone_number?: string;
    ip_address?: string;
  };
}

export async function POST(req: Request) {
  if (!isNeonAuthEnabled) {
    return Response.json({ error: "Neon Auth non configuré." }, { status: 503 });
  }

  const rawBody = await req.text();

  // 1. Signature — rejet immédiat si invalide (jamais de traitement avant)
  const check = await verifyNeonSignature(rawBody, req.headers);
  if (!check.valid) {
    console.warn(`[neon-webhook] SIGNATURE REJETÉE : ${check.reason}`);
    return Response.json({ error: "Signature invalide." }, { status: 401 });
  }

  let payload: NeonWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as NeonWebhookPayload;
  } catch {
    return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const eventType = payload.event_type ?? "";
  const eventId = payload.event_id ?? req.headers.get("x-neon-event-id") ?? "";

  // 2. Idempotence (relances Neon = même event_id)
  if (eventId && isDuplicate(eventId)) {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    // 3. Routage par événement
    if (eventType === "send.otp") {
      const data = payload.event_data;
      const code = data?.otp_code;
      if (!data || !code) {
        return Response.json({ ok: true, ignored: "send.otp sans code" });
      }
      const expiresInMinutes = data.expires_at
        ? Math.max(1, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 60000))
        : 5;

      if (data.delivery_preference === "sms") {
        // OTP téléphone (plugin Phone Number) → SMS
        const to = payload.user?.phone_number;
        if (!to) {
          return Response.json({ error: "Numéro de téléphone absent." }, { status: 400 });
        }
        const result = await sendSms(to, otpSmsMessage(code, expiresInMinutes));
        if (!result.delivered) {
              console.error(`[neon-webhook] SMS NON DÉLIVRÉ (${result.provider}) : ${result.error ?? "?"}`);
          return Response.json({ error: "Échec de la livraison SMS." }, { status: 502 });
        }
        // eslint-disable-next-line no-console -- journal serveur volontaire (aucun code journalisé)
        console.log(`[neon-webhook] OTP SMS délivré (${result.provider}) → ${to.replace(/\d(?=\d{2})/g, "•")}`);
        return Response.json({ ok: true });
      }

      // OTP e-mail (vérification d'adresse / mot de passe oublié / connexion)
      const to = payload.user?.email;
      if (!to) {
        return Response.json({ error: "Adresse e-mail absente." }, { status: 400 });
      }
      const content = otpEmailContent({
        code,
        otpType: data.otp_type ?? "sign-in",
        expiresInMinutes,
      });
      const result = await sendEmail(to, content.subject, content.text, content.html);
      if (!result.delivered) {
          console.error(`[neon-webhook] E-MAIL NON DÉLIVRÉ (${result.provider}) : ${result.error ?? "?"}`);
        return Response.json({ error: "Échec de la livraison e-mail." }, { status: 502 });
      }
      // eslint-disable-next-line no-console -- journal serveur volontaire (aucun code journalisé)
      console.log(`[neon-webhook] OTP e-mail délivré (${result.provider}) → ${to}`);
      return Response.json({ ok: true });
    }

    if (eventType === "phone_number.verified") {
      // Non bloquant : trace d'audit + miroir du numéro sur le compte local
      const phone = payload.event_data?.phone_number ?? payload.user?.phone_number ?? null;
      const neonUserId = payload.user?.id ?? null;
      const email = payload.user?.email ?? null;
      // eslint-disable-next-line no-console -- journal serveur volontaire
      console.log(`[neon-webhook] téléphone vérifié (${phone}) — utilisateur Neon ${neonUserId ?? "?"}`);
      if (phone && (neonUserId || email)) {
        await db.user
          .updateMany({
            where: {
              OR: [...(neonUserId ? [{ supabaseId: neonUserId }] : []), ...(email ? [{ email }] : [])],
            },
            data: { phone },
          })
          .catch(() => {});
      }
      return Response.json({ ok: true });
    }

    if (eventType === "user.created" || eventType === "user.before_create") {
      // Non bloquant : accuser réception (le miroir NZOKO est créé par
      // /api/neon-auth/exchange à la première session réelle).
      return Response.json({ ok: true });
    }

    // eslint-disable-next-line no-console -- journal serveur volontaire
    console.log(`[neon-webhook] événement ignoré : ${eventType || "(vide)"}`);
    return Response.json({ ok: true, ignored: eventType });
  } catch (err) {
    // Événement BLOQUANT en échec → 500 : Neon relancera (3 tentatives)
    console.error("[neon-webhook] erreur de traitement :", err instanceof Error ? err.message : err);
    return Response.json({ error: "Erreur de traitement." }, { status: 500 });
  }
}

export async function GET() {
  // Le webhook Neon n'envoie que des POST ; GET réservé au diagnostic
  return Response.json({ ok: true, service: "nzoko-neon-auth-webhook" });
}
