// ============================================================
// NZOKO TRANSPORT — Configuration GPS & cartographie ouverte (V4)
// Source UNIQUE de tuning du système GPS étendu. Isomorphe (client ou
// serveur), SANS AUCUN SECRET : ne jamais y lire de clé d'API.
//
// Deux familles de variables d'environnement :
//  1. NEXT_PUBLIC_MAP_* — cartographie 100 % ouverte (tuiles raster
//     Leaflet/OpenStreetMap, JAMAIS Google Maps). Préfixe NEXT_PUBLIC_
//     car utiles au rendu navigateur.
//  2. GPS_* / OSRM_* / PUBLIC_BUS_POSITIONS — seuils et options serveur.
//     Lues via process.env CÔTÉ SERVEUR uniquement (le navigateur ne les
//     voit pas) : le hook chauffeur et les cartes reçoivent les valeurs
//     EFFECTIVES via GET /api/tracking/config, qui fait autorité.
//
// Les valeurs sont résolues UNE FOIS au premier import (constantes).
// ============================================================

import { TRACKING } from "@/lib/constants";
import type { TrackingConfigDTO } from "@/types";

/** Nombre fini quelconque (latitudes/longitudes peuvent être négatives ou nulles). */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Entier strictement positif (intervalles, seuils, rayons). */
function envPositiveInt(name: string, fallback: number): number {
  const value = envNumber(name, fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Nombre strictement positif (vitesses). */
function envPositiveNumber(name: string, fallback: number): number {
  const value = envNumber(name, fallback);
  return value > 0 ? value : fallback;
}

/** Booléen ("true"/"false", tout autre valeur = défaut). */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw.trim().toLowerCase() === "true") return true;
  if (raw.trim().toLowerCase() === "false") return false;
  return fallback;
}

// ------------------------------------------------------------
// CARTOGRAPHIE OUVERTE — tuiles raster Leaflet (sans Google)
// ------------------------------------------------------------
// ⚠️ SEUL ENDROIT du code où une URL de tuile est définie : toute carte
// (publique, admin, chauffeur) DOIT consommer tileUrl() ou le champ
// map.tileUrl de /api/tracking/config — jamais une URL en dur.
export const GPS_MAP = {
  /** Identifiant du fournisseur de tuiles (information d'affichage). */
  provider: (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "openstreetmap").trim() || "openstreetmap",
  /** Template de tuiles raster Leaflet {z}/{x}/{y}. */
  tileUrl:
    (process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "").trim() ||
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  /** Attribution légale obligatoire affichée en bas de carte. */
  attribution:
    (process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "").trim() ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  /** Centre par défaut des cartes : Brazzaville (Congo). */
  defaultLat: envNumber("NEXT_PUBLIC_MAP_DEFAULT_LAT", -4.27),
  defaultLng: envNumber("NEXT_PUBLIC_MAP_DEFAULT_LNG", 15.28),
} as const;

// ------------------------------------------------------------
// INTERVALLES D'ENVOI DU CHAUFFEUR (côté client, servis par /api/tracking/config)
// ------------------------------------------------------------
export const GPS_INTERVALS = {
  /** Bus en mouvement : un point toutes les 8 s. */
  activeIntervalMs: envPositiveInt("GPS_ACTIVE_INTERVAL", 8_000),
  /** Vitesse lente / circulation dense : un point toutes les 15 s. */
  idleIntervalMs: envPositiveInt("GPS_IDLE_INTERVAL", 15_000),
  /** Bus à l'arrêt (gare, embouteillage) : un point toutes les 30 s. */
  stoppedIntervalMs: envPositiveInt("GPS_STOPPED_INTERVAL", 30_000),
} as const;

// ------------------------------------------------------------
// SEUILS SERVEUR — font AUTORITÉ (jamais dérivés côté client)
// ------------------------------------------------------------
export const GPS_SERVER = {
  /** Secondes sans position au-delà desquelles un bus passe OFFLINE (120 s). */
  offlineThresholdMs: envPositiveInt("GPS_OFFLINE_THRESHOLD", 120) * 1000,
  /** Rayon (mètres) autour de la destination officielle détectant une ARRIVÉE. */
  arrivalRadiusM: envPositiveInt("GPS_ARRIVAL_RADIUS", 2_000),
  /** Seuil km/h : en dessous, le bus est STOPPED (défaut = TRACKING.stoppedSpeedKmh). */
  stoppedSpeedKmh: envPositiveNumber("TRACKING_GPS_STOPPED_SPEED", TRACKING.stoppedSpeedKmh),
  /** Base OSRM pour le routage routier réel ("" = désactivé → lignes droites). */
  osrmBaseUrl: (process.env.OSRM_BASE_URL ?? "").trim().replace(/\/+$/, ""),
  /** Expose les positions des bus sur la carte publique (défaut : false). */
  publicBusPositions: envBool("PUBLIC_BUS_POSITIONS", false),
} as const;

// ------------------------------------------------------------
// V5 MULTI-BUS — validation, idempotence, heartbeat, géofences,
// retards. Toutes les valeurs ci-dessous sont configurables par
// variable d'environnement (aucun nombre magique dispersé).
// ------------------------------------------------------------
export const GPS_V5 = {
  // ---- Heartbeat (§11) : séparé des positions ----
  /** Intervalle d'envoi du heartbeat côté client (30 s). */
  heartbeatIntervalMs: envPositiveInt("GPS_HEARTBEAT_INTERVAL", 30_000),
  /** Heartbeat plus vieux que ce délai → téléphone considéré HORS LIGNE. */
  heartbeatOfflineMs: envPositiveInt("GPS_HEARTBEAT_OFFLINE", 150) * 1000,

  // ---- Validation des positions (§8) ----
  /** Vitesse km/h au-delà de laquelle une position est IMPOSSIBLE → REJECT. */
  maxSpeedKmh: envPositiveNumber("GPS_MAX_SPEED_KMH", 200),
  /** Vitesse km/h au-delà de laquelle la position est SUSPECTE → FLAG. */
  suspectSpeedKmh: envPositiveNumber("GPS_SUSPECT_SPEED_KMH", 140),
  /** Vitesse implicite (km/h) entre 2 positions au-delà de laquelle le
   *  déplacement est une TÉLÉPORTATION → REJECT (GPS glitch / spoof). */
  teleportSpeedKmh: envPositiveNumber("GPS_TELEPORT_SPEED_KMH", 500),
  /** Précision (m) au-delà de laquelle la position est SIGNALÉE (FLAG). */
  suspectAccuracyM: envPositiveInt("GPS_SUSPECT_ACCURACY", 5_000),
  /** Tolérance d'horodatage dans le futur (ms) au-delà de laquelle → REJECT. */
  futureToleranceMs: envPositiveInt("GPS_FUTURE_TOLERANCE", 60_000),

  // ---- Géofences des arrêts (§20) ----
  /** Rayon par défaut des arrêts (m) quand RouteStop.radiusM est null. */
  stopRadiusM: envPositiveInt("GPS_STOP_RADIUS", 1_200),
  /** Hystérésis : sortie de géofence seulement au-delà de rayon × ce facteur. */
  stopExitFactor: envPositiveNumber("GPS_STOP_EXIT_FACTOR", 1.5),
  /** Durée minimale DANS la géofence avant ARRIVÉE confirmée (ms). */
  stopMinDwellMs: envPositiveInt("GPS_STOP_MIN_DWELL", 25_000),
  /** Distance à la destination (m) sous laquelle tripPhase → ARRIVING. */
  approachingRadiusM: envPositiveInt("GPS_APPROACHING_RADIUS", 10_000),

  // ---- Retards (§23) ----
  /** Retard (min) au-delà duquel un bus est « en retard léger ». */
  delaySlightMin: envPositiveInt("GPS_DELAY_SLIGHT_MIN", 10),
  /** Retard (min) au-delà duquel un bus est « en retard important ». */
  delayHeavyMin: envPositiveInt("GPS_DELAY_HEAVY_MIN", 30),
  /** Vitesse moyenne de croisière (km/h) pour l'ETA quand la vitesse
   *  instantanée est indisponible/nulle (ETA = distance / vitesse). */
  cruiseSpeedKmh: envPositiveNumber("GPS_CRUISE_SPEED_KMH", 60),

  // ---- Alertes (§35) ----
  /** Immobilité (min) au-delà de laquelle une alerte « bus immobilisé ». */
  longStopMin: envPositiveInt("GPS_LONG_STOP_MIN", 30),
  /** Nombre maximal d'événements récents renvoyés à l'admin. */
  alertsMaxEvents: envPositiveInt("GPS_ALERTS_MAX", 50),
} as const;

// ------------------------------------------------------------
// HELPERS — l'API stable consommée par les routes et composants
// ------------------------------------------------------------
/** Template de tuiles raster Leaflet ({z}/{x}/{y}). */
export function tileUrl(): string {
  return GPS_MAP.tileUrl;
}

/** Centre de carte par défaut { lat, lng }. */
export function mapDefaults(): { lat: number; lng: number } {
  return { lat: GPS_MAP.defaultLat, lng: GPS_MAP.defaultLng };
}

/** Seuil OFFLINE en millisecondes (autorité serveur). */
export function offlineThresholdMs(): number {
  return GPS_SERVER.offlineThresholdMs;
}

/** Rayon d'arrivée en mètres autour de la destination officielle (autorité serveur). */
export function arrivalRadiusM(): number {
  return GPS_SERVER.arrivalRadiusM;
}

/** Seuil km/h de l'état STOPPED (autorité serveur). */
export function stoppedSpeedKmh(): number {
  return GPS_SERVER.stoppedSpeedKmh;
}

/** Base OSRM configurée ("" = routage réel désactivé). */
export function osrmBaseUrl(): string {
  return GPS_SERVER.osrmBaseUrl;
}

/** Les positions des bus sont-elles exposées sur la carte publique ? */
export function publicBusPositionsEnabled(): boolean {
  return GPS_SERVER.publicBusPositions;
}

/** Intervalles d'envoi du hook chauffeur. */
export function gpsIntervals(): { activeIntervalMs: number; idleIntervalMs: number; stoppedIntervalMs: number } {
  return { ...GPS_INTERVALS };
}

/**
 * Instantané SERVEUR des valeurs effectives — contrat exact de
 * GET /api/tracking/config. C'est la seule façon pour le navigateur
 * de connaître les seuils (aucune donnée sensible).
 */
export function trackingConfigSnapshot(): TrackingConfigDTO {
  return {
    activeIntervalMs: GPS_INTERVALS.activeIntervalMs,
    idleIntervalMs: GPS_INTERVALS.idleIntervalMs,
    stoppedIntervalMs: GPS_INTERVALS.stoppedIntervalMs,
    stoppedSpeedKmh: GPS_SERVER.stoppedSpeedKmh,
    offlineThresholdMs: GPS_SERVER.offlineThresholdMs,
    arrivalRadiusM: GPS_SERVER.arrivalRadiusM,
    map: {
      provider: GPS_MAP.provider,
      tileUrl: GPS_MAP.tileUrl,
      attribution: GPS_MAP.attribution,
      defaultLat: GPS_MAP.defaultLat,
      defaultLng: GPS_MAP.defaultLng,
    },
  };
}
