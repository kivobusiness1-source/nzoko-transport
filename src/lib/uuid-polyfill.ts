// ============================================================
// OCÉAN DU NORD — Polyfill crypto.randomUUID (contextes http://)
//
// crypto.randomUUID() n'existe que dans les CONTEXTES SÉCURISÉS
// (https:// ou localhost). Sur une origine http:// simple (ex. test
// réseau local), l'API est absente — or le SDK Neon Auth l'appelle
// AU CHARGEMENT DU MODULE (adapter-core : CURRENT_TAB_CLIENT_ID =
// crypto.randomUUID()) → l'écran de connexion plantait entièrement
// (« Une erreur est survenue ») avant même de pouvoir se connecter.
//
// Ce polyfill installe un UUID v4 RFC 4122 fondé sur
// crypto.getRandomValues — disponible PARTOUT, même en http — et
// doit être importé AVANT tout module qui utiliserait randomUUID à
// l'échelle du module (ordre d'évaluation ES : les imports sont
// évalués dans l'ordre d'écriture).
//
// getRandomValues est fourni par le PRNG du navigateur : la qualité
// aléatoire est identique à randomUUID (seule la mise en forme v4
// est faite ici). À noter : ces identifiants ne servent pas à la
// sécurité côté client.
// ============================================================

/** UUID v4 RFC 4122 construit sur crypto.getRandomValues. */
function uuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Version 4 (6e octet haut) + variant RFC 4122 (8e octet haut).
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Installation idempotente : ne touche à rien si l'API native existe
// (contextes sécurisés — cas normal en production HTTPS).
if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID !== "function") {
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: uuidV4,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    // Objet crypto non extensible (navigateur exotique) — silencieux :
    // les modules du projet gardent leurs replis explicites
    // (device-id.ts, use-driver-gps.ts…).
  }
}

export {};
