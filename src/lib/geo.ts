// ============================================================
// NZOKO TRANSPORT — Utilitaires géographiques (V3)
// Haversine : distance orthodromique fiable aux courtes portées
// (quartiers/agences d'une même ville). Décision TOUJOURS serveur.
// ============================================================

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_008.8; // rayon moyen IUGG

/** Distance Haversine en mètres entre deux points WGS84. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const latA = toRad(a.latitude);
  const latB = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance en km arrondie à 1 décimale (affichage). */
export function km(distanceMeters: number): number {
  return Math.round((distanceMeters / 1000) * 10) / 10;
}

/** Un point est-il dans le rayon d'une zone (quartier) ? */
export function isWithinRadius(point: GeoPoint, center: GeoPoint, radiusMeters: number): boolean {
  return haversineMeters(point, center) <= radiusMeters;
}

/** Plausibilité d'une position GPS reçue du navigateur. */
export function isPlausiblePosition(p: GeoPoint): boolean {
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180 &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

/**
 * Heure locale Congo (UTC+1, pas d'heure d'été) au format "HH:MM".
 * Les horaires d'agence sont stockés en heure Congo.
 */
export function congoTimeString(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + 3600_000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
}

/** "HH:MM" → minutes depuis minuit (null si format invalide). */
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** L'agence est-elle ouverte à l'heure Congo donnée ? (null = 24/7) */
export function isOpenAt(
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
  at: Date = new Date()
): boolean {
  const open = parseHHMM(openingTime);
  const close = parseHHMM(closingTime);
  if (open === null || close === null) return true; // pas d'horaires renseignés → présumée ouverte
  const now = parseHHMM(congoTimeString(at)) ?? 0;
  if (open === close) return true; // 24/7 explicite
  if (open < close) return now >= open && now < close;
  return now >= open || now < close; // créneau à cheval sur minuit
}

/** Libellé d'accessibilité : "350 m" / "1,4 km" (français). */
export function humanDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) return `${Math.round(distanceMeters / 10) * 10} m`;
  return `${km(distanceMeters).toLocaleString("fr-FR").replace(",", ",")} km`;
}
