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

// ============================================================
// V4 — SUIVI GPS ÉTENDU : cap, états du bus, distance d'arrivée
// Fonctions PURES (aucune E/S) → testables et réutilisables
// serveur (détection d'arrivée, flotte admin) comme client (cartes).
// ============================================================

/** État dérivé d'un bus suivi par GPS (INDÉPENDANT du statut du VÉHICULE,
 *  `BusStatus` de @/lib/constants = ACTIVE/MAINTENANCE/INACTIVE/OUT_OF_SERVICE). */
export type GpsBusStatus = "MOVING" | "STOPPED" | "OFFLINE" | "ARRIVED" | "GPS_ERROR";

/** Alias de contrat V4 — le champ TrackingSessionDTO.busStatus utilise ce type. */
export type BusStatus = GpsBusStatus;

/** Libellés français des états GPS d'un bus. */
export const BUS_STATUS_LABELS: Record<BusStatus, string> = {
  MOVING: "En mouvement",
  STOPPED: "Arrêté",
  OFFLINE: "Hors ligne",
  ARRIVED: "Arrivé",
  GPS_ERROR: "Signal GPS défaillant",
};

/** Cap initial (bearing) en degrés 0–360 (0 = nord, sens horaire). */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const latA = toRad(from.latitude);
  const latB = toRad(to.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(latB);
  const x = Math.cos(latA) * Math.sin(latB) - Math.sin(latA) * Math.cos(latB) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface DeriveBusStatusInput {
  /** Vitesse du dernier point GPS (km/h) — null si le navigateur ne la fournit pas. */
  speedKmh: number | null;
  /** Horodatage du dernier point GPS — null si la session vivante n'a AUCUN point. */
  lastPointAt: Date | null;
  /** Instant de référence (testabilité) — défaut : maintenant. */
  now?: Date;
  /** Seuil OFFLINE en millisecondes (autorité serveur : offlineThresholdMs()). */
  offlineThresholdMs: number;
  /** Seuil km/h de l'état STOPPED (autorité serveur : stoppedSpeedKmh()). */
  stoppedSpeedKmh: number;
  /** Le voyage rattaché est-il déjà ARRIVÉ ? (priorité absolue) */
  tripArrived?: boolean;
}

/**
 * État GPS dérivé d'un bus, règles dans l'ordre STRICT :
 *  1. ARRIVED   — le voyage rattaché est déjà ARRIVED (jugement définitif) ;
 *  2. GPS_ERROR — session vivante SANS AUCUN point (GPS jamais reçu) ;
 *  3. OFFLINE   — dernier point plus vieux que offlineThresholdMs ;
 *  4. STOPPED   — vitesse ≤ stoppedSpeedKmh (null = vitesse inconnue :
 *                 présumé à l'arrêt — la perte de signal est couverte par OFFLINE) ;
 *  5. MOVING    — sinon.
 */
export function deriveBusStatus(input: DeriveBusStatusInput): BusStatus {
  if (input.tripArrived) return "ARRIVED";
  if (!input.lastPointAt) return "GPS_ERROR";
  const now = input.now ?? new Date();
  if (now.getTime() - input.lastPointAt.getTime() > input.offlineThresholdMs) return "OFFLINE";
  if (input.speedKmh === null || input.speedKmh <= input.stoppedSpeedKmh) return "STOPPED";
  return "MOVING";
}

/** Voyage rattaché avec sa destination officielle (pour la distance d'arrivée).
 *  latitude/longitude optionnels : certaines villes du référentiel n'en ont pas. */
export interface ArrivalTripLike {
  status?: string;
  route?: {
    destinationCity?: { latitude?: number | null; longitude?: number | null } | null;
  } | null;
}

export interface ArrivalDistanceInput {
  trip: ArrivalTripLike | null;
  lastPoint: GeoPoint | null;
}

/**
 * Distance (mètres, Haversine) entre le dernier point GPS et la
 * destination OFFICIELLE du voyage (City de destination du Trip).
 * null si la ville de destination n'a pas de coordonnées ou sans point.
 */
export function arrivalDistance(input: ArrivalDistanceInput): number | null {
  const destination = input.trip?.route?.destinationCity;
  if (!input.lastPoint || !destination) return null;
  if (typeof destination.latitude !== "number" || typeof destination.longitude !== "number") return null;
  return haversineMeters(input.lastPoint, {
    latitude: destination.latitude,
    longitude: destination.longitude,
  });
}
