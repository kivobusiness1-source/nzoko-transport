// ============================================================
// OCÉAN DU NORD — Identifiant du téléphone chauffeur (V5, §6)
//
// Le téléphone est identifié par un UUID stable généré UNE fois
// et conservé en localStorage — INDEPENDANT du compte chauffeur
// (un chauffeur peut changer de téléphone, un téléphone peut
// passer de main en main). Ne JAMAIS utiliser le numéro de
// téléphone comme identifiant GPS.
//
// Repli : si localStorage est indisponible (navigation privée
// stricte), un identifiant volatile par vie de la page est retourné
// (mieux que rien — la session reste liée au compte authentifié).
// ============================================================

const STORAGE_KEY = "nzoko-device-id";
/** Préfixe pour distinguer nos UUID des autres valeurs de stockage. */
const PREFIX = "dev-";

/** Génère un UUID v4 (crypto.randomUUID si dispo, repli RFC4122). */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Repli manuel (anciens navigateurs) — qualité suffisante pour un
  // identifiant d'appareil non sécuritaire.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Identifiant stable du téléphone (créé au premier appel).
 * Côté serveur : min 8 / max 64 caractères.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "dev-ssr";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.startsWith(PREFIX) && existing.length >= 12) return existing;
    const fresh = `${PREFIX}${generateUuid()}`;
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage indisponible — identifiant volatile par page.
    return `${PREFIX}volatile-${generateUuid()}`;
  }
}
