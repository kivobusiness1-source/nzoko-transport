// ============================================================
// OCÉAN DU NORD — Primitives de sécurité (tokens, références)
// ============================================================

import crypto from "node:crypto";

// Alphabet sans caractères ambigus (0/O, 1/I/L excluts)
const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomFrom(alphabet: string, length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Référence réservation du type NZK-2026-A8F92K — unique, non prédictible */
export function generateBookingReference(): string {
  const year = new Date().getFullYear();
  return `NZK-${year}-${randomFrom(REF_ALPHABET, 6)}`;
}

/** Token de billet QR — aléatoire, AUCUNE donnée passager */
export function generateTicketToken(): string {
  return `nzk_tkt_${randomFrom(TOKEN_ALPHABET, 32)}`;
}

/**
 * Numéro d'embarquement V3 — « NZK-8F42K9 » : court, lisible, saisissable à
 * la main au contrôle. Aléatoire sécurisé (JAMAIS un compteur devinable) ;
 * l'unicité est garantie par la contrainte unique en base (retry à la collision).
 */
export function generateBoardingNumber(): string {
  return `NZK-${randomFrom(REF_ALPHABET, 6)}`;
}

/** Code voyage lisible */
export function generateTripCode(): string {
  return `TRP-${randomFrom(REF_ALPHABET, 6)}`;
}

// Codes villes usuels (fallback : 3 premières lettres du nom normalisé)
const CITY_CODES: Record<string, string> = {
  "pointe-noire": "PN",
  brazzaville: "BZV",
  dolisie: "DOL",
  nkayi: "NKY",
  ouesso: "OUS",
  owando: "OWD",
  gamboma: "GBM",
  sibiti: "SIB",
};

function cityCode(name: string): string {
  const key = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const code = CITY_CODES[key] ?? key.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
  return code || "XXX";
}

/** Code route lisible — ex : PN-BZV-A7K (origine-destination-aléatoire) */
export function generateRouteCode(originCityName: string, destinationCityName: string): string {
  return `${cityCode(originCityName)}-${cityCode(destinationCityName)}-${randomFrom(REF_ALPHABET, 3)}`;
}

export function generateSessionToken(): string {
  return randomFrom(TOKEN_ALPHABET, 48);
}

/** Code promo récompense — ex : Océan du Nord-A7K2M9 (base32 lisible, unique en base). */
export function generatePromoCode(): string {
  return `Océan du Nord-${randomFrom(REF_ALPHABET, 6)}`;
}

/** Code OTP à 6 chiffres (crypto.randomInt — uniformément aléatoire). */
export function generateOtpCode(length: number): string {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, "0");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
