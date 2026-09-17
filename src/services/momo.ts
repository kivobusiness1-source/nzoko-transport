// ============================================================
// NZOKO TRANSPORT — Client MTN MoMo Open API (back-office)
// Documentation officielle : https://momodeveloper.mtn.com/api-documentation
//
// Produits intégrés :
//  • COLLECTION      → Request to Pay (collecte des paiements clients)
//  • DISBURSEMENT    → Transfer + Refund (envoi de fonds / remboursements)
//
// Authentification (2 facteurs, par produit) :
//  1. Ocp-Apim-Subscription-Key — clé de souscription au produit (portail MTN)
//  2. OAuth 2.0 Bearer token     — POST {produit}/token/ en Basic auth
//     (API User UUID : API Key), token mis en cache (expires_in ≈ 3600 s)
//
// Sémantique : les POST /requesttopay, /transfer, /refund sont ASYNCHRONES
// (HTTP 202 + statut PENDING) ; le statut final s'obtient par GET
// {produit}/v1_0/{opération}/{referenceId} ou par callback (X-Callback-Url,
// envoyé UNE SEULE fois — le polling reste le mécanisme de secours).
//
// ⚠️ Les clés ne sortent JAMAIS de ce fichier : ni DTO, ni log, ni ZIP.
// ============================================================

import { ApiError, ERROR_CODES } from "@/lib/api-response";
import { logSecurity } from "@/lib/audit";

// ------------------------------------------------------------
// Configuration (variables d'environnement)
// ------------------------------------------------------------

export type MomoProduct = "collection" | "disbursement";

const MOMO_ENV = (process.env.MOMO_ENVIRONMENT ?? "sandbox").toLowerCase() === "production" ? "production" : "sandbox";

/** Sandbox : https://sandbox.momodeveloper.mtn.com — Production : URL communiquée par MTN au go-live (proxy). */
const MOMO_BASE_URL = (
  process.env.MOMO_BASE_URL ??
  (MOMO_ENV === "production" ? "https://proxy.momoapi.mtn.com" : "https://sandbox.momodeveloper.mtn.com")
).replace(/\/+$/, "");

/** Environnement cible du portefeuille : "sandbox" en test ; en prod p.ex. "mtncongo". */
const MOMO_TARGET_ENV = process.env.MOMO_TARGET_ENVIRONMENT ?? (MOMO_ENV === "production" ? "mtncongo" : "sandbox");

/** Devise : le SANDBOX MTN n'accepte que EUR ; la production Congo utilise XAF. */
export function momoCurrency(): string {
  return process.env.MOMO_CURRENCY ?? (MOMO_ENV === "production" ? "XAF" : "EUR");
}

interface MomoProductCredentials {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
}

function productCredentials(product: MomoProduct): MomoProductCredentials | null {
  const prefix = product === "collection" ? "MOMO_COLLECTION" : "MOMO_DISBURSEMENT";
  const subscriptionKey = process.env[`${prefix}_SUBSCRIPTION_KEY`]?.trim();
  const apiUser = process.env[`${prefix}_API_USER`]?.trim();
  const apiKey = process.env[`${prefix}_API_KEY`]?.trim();
  if (!subscriptionKey || !apiUser || !apiKey) return null;
  return { subscriptionKey, apiUser, apiKey };
}

export function momoCollectionConfigured(): boolean {
  return productCredentials("collection") !== null;
}

export function momoDisbursementConfigured(): boolean {
  return productCredentials("disbursement") !== null;
}

export function momoCallbackUrl(): string | null {
  const url = process.env.MOMO_CALLBACK_URL?.trim();
  if (!url || !/^https:\/\//i.test(url)) return null; // MTN n'accepte que HTTPS
  return url;
}

/** Éat de configuration SANS jamais exposer les secrets. */
export interface MomoConfigStatus {
  environment: "sandbox" | "production";
  targetEnvironment: string;
  currency: string;
  collectionConfigured: boolean;
  disbursementConfigured: boolean;
  callbackConfigured: boolean;
}

export function momoConfigStatus(): MomoConfigStatus {
  return {
    environment: MOMO_ENV,
    targetEnvironment: MOMO_TARGET_ENV,
    currency: momoCurrency(),
    collectionConfigured: momoCollectionConfigured(),
    disbursementConfigured: momoDisbursementConfigured(),
    callbackConfigured: momoCallbackUrl() !== null,
  };
}

// ------------------------------------------------------------
// Cache de tokens OAuth (par produit) — mémoire, mono-instance
// ------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<MomoProduct, CachedToken>();

async function getMomoAccessToken(product: MomoProduct): Promise<string> {
  const creds = productCredentials(product);
  if (!creds) {
    throw new ApiError(
      503,
      "MOMO_NOT_CONFIGURED",
      product === "collection"
        ? "Paiement MTN MoMo non configuré (clés Collections absentes)."
        : "Remboursement MTN MoMo non configuré (clés Disbursement absentes)."
    );
  }

  const cached = tokenCache.get(product);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) return cached.token; // marge 60 s

  // POST {base}/{product}/token/ — Basic auth (apiUser:apiKey), pas de JSON
  const basic = Buffer.from(`${creds.apiUser}:${creds.apiKey}`).toString("base64");
  const res = await momoFetch(`${product}/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": creds.subscriptionKey,
    },
    product,
  });

  if (!res.ok) {
    await logSecurity({
      event: "SUSPICIOUS",
      details: { reason: "momo_token_error", product, status: res.status },
    });
    throw new ApiError(
      502,
      "MOMO_AUTH_ERROR",
      "Authentification MTN MoMo refusée. Vérifiez les clés API User/Key et la souscription au produit."
    );
  }

  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!body?.access_token) {
    throw new ApiError(502, "MOMO_AUTH_ERROR", "Réponse token MTN MoMo invalide.");
  }
  const expiresIn = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  tokenCache.set(product, { token: body.access_token, expiresAt: now + expiresIn * 1000 });
  return body.access_token;
}

// ------------------------------------------------------------
// HTTP — fetch avec timeout, en-têtes communs, erreurs normalisées
// ------------------------------------------------------------

const MOMO_TIMEOUT_MS = 20_000;

async function momoFetch(
  path: string,
  init: RequestInit & { product: MomoProduct; auth?: "basic" | "bearer" | "none" }
): Promise<Response> {
  const { product, auth = "none", headers, ...rest } = init;
  const creds = productCredentials(product);
  const url = `${MOMO_BASE_URL}/${path.replace(/^\/+/, "")}`;

  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  };
  if (creds) finalHeaders["Ocp-Apim-Subscription-Key"] = creds.subscriptionKey;
  if (auth === "bearer") finalHeaders["Authorization"] = `Bearer ${await getMomoAccessToken(product)}`;
  finalHeaders["X-Target-Environment"] = MOMO_TARGET_ENV;

  try {
    return await fetch(url, {
      ...rest,
      headers: finalHeaders,
      signal: AbortSignal.timeout(MOMO_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    throw new ApiError(
      502,
      "MOMO_UNAVAILABLE",
      isTimeout
        ? "MTN MoMo ne répond pas (délai dépassé). Réessayez dans un instant."
        : "Service MTN MoMo injoignable. Réessayez dans un instant."
    );
  }
}

/** Traduit une réponse d'erreur MoMo (4xx/5xx JSON {code,message}) en ApiError lisible. */
async function momoError(res: Response, context: string): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  const code = body?.code ?? `HTTP_${res.status}`;
  const rawMsg = body?.message ?? `Erreur MTN MoMo (${res.status})`;

  // 429 chez MoMo → 429 chez nous (transparence pour le client final)
  if (res.status === 429) {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, "MTN MoMo momentanément saturé — réessayez dans un instant.");
  }
  // 401/403 → credential/subscription
  if (res.status === 401 || res.status === 403) {
    await logSecurity({ event: "SUSPICIOUS", details: { reason: "momo_auth_denied", context, status: res.status, code } });
    return new ApiError(502, "MOMO_AUTH_ERROR", `MTN MoMo a refusé l'appel (${code}). Vérifiez les clés/souscriptions.`);
  }
  if (res.status >= 500) {
    return new ApiError(502, "MOMO_ERROR", `MTN MoMo — erreur plateforme (${code}).`);
  }
  // 4xx métier (PAYEE_NOT_FOUND, INVALID_CURRENCY, RESOURCE_ALREADY_EXIST…)
  const translated = MOMO_ERROR_FR[code] ?? rawMsg;
  return new ApiError(502, "MOMO_ERROR", translated);
}

// Messages FR pour les codes d'erreur MoMo les plus courants (doc « Common Error Codes »)
const MOMO_ERROR_FR: Record<string, string> = {
  PAYEE_NOT_FOUND: "Numéro Mobile Money introuvable ou non enregistré MTN MoMo.",
  PAYER_NOT_FOUND: "Numéro Mobile Money introuvable ou non enregistré MTN MoMo.",
  INVALID_MSISDN: "Numéro Mobile Money invalide.",
  INVALID_CURRENCY: "Devise non supportée par MTN MoMo pour cet environnement.",
  INVALID_AMOUNT: "Montant non autorisé par MTN MoMo.",
  NOT_ENOUGH_FUNDS: "Solde Mobile Money insuffisant sur ce compte.",
  PAYER_LIMIT_REACHED: "Plafond du compte Mobile Money atteint.",
  RESOURCE_ALREADY_EXIST: "Transaction déjà enregistrée chez MTN (référence en double).",
  RESOURCE_NOT_FOUND: "Transaction introuvable chez MTN MoMo.",
  NOT_ALLOWED: "Opération non autorisée pour ce compte.",
  NOT_ALLOWED_TARGET_ENVIRONMENT: "Environnement cible MTN non autorisé pour ces clés.",
  INTERNAL_PROCESSING_ERROR: "Erreur interne MTN MoMo — réessayez.",
  SERVICE_UNAVAILABLE: "MTN MoMo momentanément indisponible.",
  INVALID_CALLBACK_URL_HOST: "Domaine de callback non conforme à celui enregistré chez MTN.",
  UNAUTHORIZED: "Authentification MTN MoMo refusée.",
  TRANSACTION_ID_NOT_FOUND: "Transaction MoMo introuvable.",
};

// ------------------------------------------------------------
// Normalisation MSISDN → E.164 sans « + » (ex : 06 123 45 67 → 2426123456…)
// Congo-Brazzaville = indicatif 242 ; les numéros locaux commencent par 0.
// ------------------------------------------------------------

export function toMomoMsisdn(raw: string): string {
  let v = raw.replace(/[\s.\-()]/g, "");
  if (v.startsWith("00")) v = v.slice(2);
  if (v.startsWith("+")) v = v.slice(1);
  if (!v.startsWith("242")) {
    if (v.startsWith("0")) v = "242" + v.slice(1);
    else if (/^\d{8,9}$/.test(v)) v = "242" + v; // numéro local sans le 0
  }
  if (!/^\d{10,15}$/.test(v)) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Numéro Mobile Money invalide.");
  }
  return v;
}

// ------------------------------------------------------------
// Statuts MoMo → statut interne
// MoMo : PENDING | SUCCESSFUL | FAILED (+ raisons EXPIRED/REJECTED en FAILED)
// ------------------------------------------------------------

export interface MomoTransactionStatus {
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  rawStatus: string;
  reasonCode: string | null;
  reasonMessage: string | null;
  financialTransactionId: string | null;
  amount: number | null;
  currency: string | null;
}

interface RawMomoStatusBody {
  status?: string;
  reason?: { code?: string; message?: string } | null;
  financialTransactionId?: number | string;
  amount?: number | string;
  currency?: string;
}

function normalizeMomoStatus(body: RawMomoStatusBody | null): MomoTransactionStatus {
  const raw = body?.status ?? "PENDING";
  let status: MomoTransactionStatus["status"] = "PENDING";
  if (raw.toUpperCase() === "SUCCESSFUL" || raw.toUpperCase() === "SUCCESS") status = "SUCCESSFUL";
  else if (["FAILED", "REJECTED", "EXPIRED", "CANCELLED", "TIMEOUT", "ERROR"].includes(raw.toUpperCase())) status = "FAILED";

  return {
    status,
    rawStatus: raw,
    reasonCode: body?.reason?.code ?? null,
    reasonMessage: body?.reason?.message ?? null,
    financialTransactionId:
      body?.financialTransactionId !== undefined && body.financialTransactionId !== null
        ? String(body.financialTransactionId)
        : null,
    amount: typeof body?.amount === "number" ? body.amount : body?.amount ? Number(body.amount) || null : null,
    currency: body?.currency ?? null,
  };
}

/** Motif lisible en français pour l'échec (code raison → message FR). */
export function momoFailureMessage(status: MomoTransactionStatus): string {
  if (status.reasonCode && MOMO_ERROR_FR[status.reasonCode]) return MOMO_ERROR_FR[status.reasonCode];
  if (status.reasonMessage) return status.reasonMessage;
  return "Le paiement Mobile Money a échoué.";
}

// ------------------------------------------------------------
// COLLECTIONS — Request to Pay (collecte)
// ------------------------------------------------------------

export interface MomoRequestToPayInput {
  referenceId: string; // X-Reference-Id — UUID v4 (idempotence MoMo)
  amount: number; // entier (XAF/FCFA ou EUR sandbox)
  currency: string;
  externalId: string; // référence métier (ex : NZK-2026-…)
  msisdn: string; // payer, E.164 sans +
  payerMessage?: string;
  payeeNote?: string;
}

/** POST /collection/v1_0/requesttopay → 202 Accepted (asynchrone). */
export async function momoRequestToPay(input: MomoRequestToPayInput): Promise<{ accepted: true }> {
  const callbackUrl = momoCallbackUrl();
  const res = await momoFetch("collection/v1_0/requesttopay", {
    method: "POST",
    product: "collection",
    auth: "bearer",
    headers: {
      "Content-Type": "application/json",
      "X-Reference-Id": input.referenceId,
      ...(callbackUrl ? { "X-Callback-Url": callbackUrl } : {}),
    },
    body: JSON.stringify({
      amount: String(input.amount),
      currency: input.currency,
      externalId: input.externalId,
      payer: { partyIdType: "MSISDN", partyId: input.msisdn },
      payerMessage: input.payerMessage?.slice(0, 120) ?? undefined,
      payeeNote: input.payeeNote?.slice(0, 120) ?? undefined,
    }),
  });

  if (res.status === 202) return { accepted: true };
  if (res.status === 200) return { accepted: true }; // tolérance certaines passerelles
  throw await momoError(res, "requesttopay");
}

/** GET /collection/v1_0/requesttopay/{referenceId} → statut. */
export async function momoGetRequestToPayStatus(referenceId: string): Promise<MomoTransactionStatus> {
  const res = await momoFetch(`collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`, {
    method: "GET",
    product: "collection",
    auth: "bearer",
  });
  if (!res.ok) throw await momoError(res, "requesttopay_status");
  const body = (await res.json().catch(() => null)) as RawMomoStatusBody | null;
  return normalizeMomoStatus(body);
}

/** GET /collection/v1_0/accountholder/msisdn/{msisdn}/active → true/false. */
export async function momoValidateAccountHolder(msisdn: string): Promise<boolean> {
  const res = await momoFetch(`collection/v1_0/accountholder/msisdn/${encodeURIComponent(msisdn)}/active`, {
    method: "GET",
    product: "collection",
    auth: "bearer",
  });
  if (!res.ok) throw await momoError(res, "accountholder_active");
  return res.json().catch(() => false);
}

// ------------------------------------------------------------
// DISBURSEMENTS — Transfer & Refund (envoi de fonds / remboursements)
// ------------------------------------------------------------

export interface MomoTransferInput {
  referenceId: string; // X-Reference-Id — UUID v4
  amount: number;
  currency: string;
  externalId: string;
  msisdn: string; // payee, E.164 sans +
  payerMessage?: string;
  payeeNote?: string;
}

/** POST /disbursement/v1_0/transfer → 202 Accepted (asynchrone). */
export async function momoTransfer(input: MomoTransferInput): Promise<{ accepted: true }> {
  const callbackUrl = momoCallbackUrl();
  const res = await momoFetch("disbursement/v1_0/transfer", {
    method: "POST",
    product: "disbursement",
    auth: "bearer",
    headers: {
      "Content-Type": "application/json",
      "X-Reference-Id": input.referenceId,
      ...(callbackUrl ? { "X-Callback-Url": callbackUrl } : {}),
    },
    body: JSON.stringify({
      amount: String(input.amount),
      currency: input.currency,
      externalId: input.externalId,
      payee: { partyIdType: "MSISDN", partyId: input.msisdn },
      payerMessage: input.payerMessage?.slice(0, 120) ?? undefined,
      payeeNote: input.payeeNote?.slice(0, 120) ?? undefined,
    }),
  });

  if (res.status === 202 || res.status === 200) return { accepted: true };
  throw await momoError(res, "transfer");
}

/** GET /disbursement/v1_0/transfer/{referenceId} → statut. */
export async function momoGetTransferStatus(referenceId: string): Promise<MomoTransactionStatus> {
  const res = await momoFetch(`disbursement/v1_0/transfer/${encodeURIComponent(referenceId)}`, {
    method: "GET",
    product: "disbursement",
    auth: "bearer",
  });
  if (!res.ok) throw await momoError(res, "transfer_status");
  return normalizeMomoStatus((await res.json().catch(() => null)) as RawMomoStatusBody | null);
}

export interface MomoRefundInput {
  referenceId: string; // X-Reference-Id du remboursement — UUID v4
  amount: number;
  currency: string;
  externalId: string;
  referenceIdToRefund: string; // X-Reference-Id du Request to Pay d'origine
  payerMessage?: string;
  payeeNote?: string;
}

/** POST /disbursement/v1_0/refund → 202 Accepted (asynchrone). Rembourse un Request to Pay. */
export async function momoRefund(input: MomoRefundInput): Promise<{ accepted: true }> {
  const callbackUrl = momoCallbackUrl();
  const res = await momoFetch("disbursement/v1_0/refund", {
    method: "POST",
    product: "disbursement",
    auth: "bearer",
    headers: {
      "Content-Type": "application/json",
      "X-Reference-Id": input.referenceId,
      ...(callbackUrl ? { "X-Callback-Url": callbackUrl } : {}),
    },
    body: JSON.stringify({
      amount: String(input.amount),
      currency: input.currency,
      externalId: input.externalId,
      referenceIdToRefund: input.referenceIdToRefund,
      payerMessage: input.payerMessage?.slice(0, 120) ?? undefined,
      payeeNote: input.payeeNote?.slice(0, 120) ?? undefined,
    }),
  });

  if (res.status === 202 || res.status === 200) return { accepted: true };
  throw await momoError(res, "refund");
}

/** GET /disbursement/v1_0/refund/{referenceId} → statut. */
export async function momoGetRefundStatus(referenceId: string): Promise<MomoTransactionStatus> {
  const res = await momoFetch(`disbursement/v1_0/refund/${encodeURIComponent(referenceId)}`, {
    method: "GET",
    product: "disbursement",
    auth: "bearer",
  });
  if (!res.ok) throw await momoError(res, "refund_status");
  return normalizeMomoStatus((await res.json().catch(() => null)) as RawMomoStatusBody | null);
}

// ------------------------------------------------------------
// SOLDES (par produit)
// ------------------------------------------------------------

export interface MomoBalance {
  availableBalance: string;
  currency: string;
}

/** GET {product}/v1_0/account/balance — solde du compte marchand MoMo. */
export async function momoGetBalance(product: MomoProduct): Promise<MomoBalance> {
  const res = await momoFetch(`${product}/v1_0/account/balance`, {
    method: "GET",
    product,
    auth: "bearer",
  });
  if (!res.ok) throw await momoError(res, "account_balance");
  const body = (await res.json().catch(() => null)) as { availableBalance?: string | number; currency?: string } | null;
  if (!body) throw new ApiError(502, "MOMO_ERROR", "Réponse solde MTN MoMo invalide.");
  return {
    availableBalance: String(body.availableBalance ?? "?"),
    currency: body.currency ?? momoCurrency(),
  };
}
