// ============================================================
// NZOKO TRANSPORT — Normalisation des téléphones congolais
// Pure & isomorphe (client + serveur).
// Format canonique : E.164 digits SANS "+" → "242061234567".
// Congo-Brazzaville : indicatif 242, mobiles 0X XX XX XX XX.
// ============================================================

/**
 * Normalise un numéro congolais vers E.164 digits.
 * Accepte : "06 123 45 67", "+242 06 123 45 67", "242061234567", "6 123 45 67"…
 * @returns "242061234567" ou null si introuvable/invalide.
 */
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("242")) {
    const rest = digits.slice(3);
    return rest.length >= 8 && rest.length <= 10 ? digits : null;
  }
  if (digits.startsWith("0")) {
    // format national "061234567" (9 chiffres) → 242 + 9
    return digits.length >= 9 && digits.length <= 10 ? `242${digits}` : null;
  }
  if (digits.length === 8) {
    // "61234567" (sans le zéro) → 242 + 0 + 8
    return `2420${digits}`;
  }
  return null;
}

/** "242061234567" → "+242 06 123 45 67" (affichage). Tolère les formats déjà espacés. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const n = normalizePhone(e164);
  if (!n) return e164;
  // 242 | 06 | 123 | 45 | 67
  return `+${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8, 10)} ${n.slice(10, 12)}`;
}

/** true si le numéro semble être un mobile congolais valide (242 + 0X...). */
export function isValidCongoPhone(raw: string): boolean {
  return normalizePhone(raw) !== null;
}

/** Derniers 4 chiffres pour les affichages discrets ("…45 67"). */
export function phoneTail(e164: string | null | undefined): string {
  if (!e164) return "—";
  return e164.slice(-4);
}
