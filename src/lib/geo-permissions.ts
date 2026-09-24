"use client";

// ============================================================
// NZOKO TRANSPORT — Gestion de la permission de géolocalisation
//
// Les navigateurs EXIGENT un accord explicite de l'utilisateur avant
// de transmettre sa position. Quand la popup d'autorisation
// n'apparaît JAMAIS, c'est qu'une cause structurelle bloque tout :
//   1. ORIGINE NON SÉCURISÉE (http:// hors localhost) → géolocalisation
//      totalement désactivée par le navigateur, AUCUN réglage ne peut
//      la réactiver (isSecureContext = false) ;
//   2. APERÇU INTÉGRÉ (iframe) → la popup est interdite dans le cadre,
//      le navigateur répond « refusé » sans jamais rien afficher ;
//   3. NAVIGATEUR INTÉGRÉ à une appli (WhatsApp, Facebook, Instagram…)
//      → pas d'UI de permission du tout ;
//   4. REFUS MÉMORISÉ → après un premier « Bloquer », le navigateur ne
//      ré-affiche JAMAIS la popup : il faut repasser par ses réglages
//      (chemins différents sur desktop / Android / iOS).
//
// Ce module détecte la cause (diagnoseGeoBlock) et produit une
// guidance PAS-À-PAS adaptée à la plateforme, plus un demandeur
// robuste (requestGeolocation) qui appelle getCurrentPosition AVANT
// tout await — Safari iOS exige le lien direct avec le geste
// utilisateur (le clic) pour afficher la popup.
// ============================================================

export type GeoPermissionState = "granted" | "prompt" | "denied" | "unsupported";
export type GeoPlatform = "ios" | "android" | "desktop";

/** Causes structurelles d'un blocage sans popup. */
export type GeoBlockReason = "insecure" | "embedded" | "in-app" | "denied" | "unsupported";

/** Diagnostic lisible : titre + étapes numérotées + action proposée. */
export interface GeoBlockDiagnosis {
  reason: GeoBlockReason;
  title: string;
  steps: string[];
  /** true → proposer le bouton « Ouvrir dans un nouvel onglet ». */
  canOpenNewTab: boolean;
}

/** Photographie synchrone de l'environnement d'exécution. */
export interface GeoEnvironment {
  /** Origine sécurisée (https:// ou localhost) — exigée par l'API. */
  secure: boolean;
  /** Page affichée dans un iframe / panneau d'aperçu. */
  embedded: boolean;
  /** Navigateur intégré à une application (webview sociale). */
  inAppBrowser: boolean;
  platform: GeoPlatform;
  /** Origine actuelle (http://… ou https://…) pour la guidance. */
  origin: string;
}

/** Plateforme estimée (pour des chemins de réglages exacts). */
export function detectGeoPlatform(): GeoPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  // iPadOS 13+ se fait passer pour un Mac tactile.
  const iPadOS = /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPod/.test(ua) || /iPad/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** true si l'origine est sécurisée (https ou localhost) — condition
 *  ABSOLUE de l'API geolocation : sur http://, le navigateur répond
 *  « refusé » d'office sans jamais afficher de popup. */
export function isSecureOrigin(): boolean {
  if (typeof window === "undefined") return true;
  if (typeof window.isSecureContext === "boolean") return window.isSecureContext;
  // Repli (navigateurs anciens) : https ou localhost explicites.
  return window.location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

/** true si la page tourne dans un contexte intégré (iframe / panneau
 *  d'aperçu). La localisation y est généralement bloquée d'office par le
 *  navigateur, sans jamais afficher de popup à l'utilisateur. */
export function isEmbeddedContext(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Un accès cross-origin à window.top lève → forcément intégré.
    return true;
  }
}

/** Webviews sociales qui n'affichent JAMAIS la popup de localisation
 *  (il faut ouvrir le lien dans un vrai navigateur). */
function detectInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Snapchat|TikTok|LinkedInApp|Twitter|Line\/|WhatsApp/i.test(ua)) return true;
  // WebView Android générique : « … Chrome/xx … wv) » sans vrai navigateur.
  return /Android/.test(ua) && /\bwv\b/.test(ua) && !/(Chrome|Firefox|Opera|SamsungBrowser)\/[\d.]+\s*$/.test(ua);
}

/** Photographie synchrone de l'environnement (jamais de popup). */
export function readGeoEnvironment(): GeoEnvironment {
  return {
    secure: isSecureOrigin(),
    embedded: isEmbeddedContext(),
    inAppBrowser: detectInAppBrowser(),
    platform: detectGeoPlatform(),
    origin: typeof window === "undefined" ? "" : window.location.origin,
  };
}

/** État de la permission de géolocalisation (Permissions API — Safari OK
 *  depuis 16.4 ; en cas d'absence → "unsupported", on tente quand même).
 *  N'affiche JAMAIS de popup : lecture pure. */
export async function queryGeoPermission(): Promise<GeoPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state as GeoPermissionState;
  } catch {
    return "unsupported";
  }
}

/** Étapes de réactivation selon la plateforme (refus mémorisé). */
function deniedSteps(platform: GeoPlatform): string[] {
  if (platform === "android") {
    return [
      "Dans Chrome, appuyez sur le menu ⋮ (à droite de la barre d'adresse) → « Paramètres du site » (⚙) → « Position » → « Autoriser ».",
      "Vérifiez aussi que la localisation du téléphone est activée : Réglages → Localisation (ou Position).",
      "Revenez sur cette page, rechargez-la, puis relancez le suivi.",
    ];
  }
  if (platform === "ios") {
    return [
      "Appuyez sur « aA » ou ℹ à gauche de la barre d'adresse → « Réglages du site web » → « Position » → « Autoriser ».",
      "Si NZOKO est installée depuis l'écran d'accueil : Réglages de l'iPhone → NZOKO → « Position » → « Autoriser ».",
      "Revenez sur cette page, rechargez-la, puis relancez le suivi.",
    ];
  }
  return [
    "Cliquez sur l'icône à gauche de l'adresse (🔒 ou ℹ), section « Autorisations » → « Localisation » → « Autoriser ».",
    "Rechargez la page, puis relancez le suivi.",
  ];
}

/** Diagnostic du blocage, À APPELER après un refus constaté
 *  (PERMISSION_DENIED reçu). Synchrone, ne déclenche aucune popup.
 *  Ordre de gravité : origine non sécurisée > aperçu intégré >
 *  navigateur intégré > refus mémorisé. */
export function diagnoseGeoBlock(): GeoBlockDiagnosis {
  const env = readGeoEnvironment();

  if (!env.secure) {
    return {
      reason: "insecure",
      title: "Page non sécurisée — localisation impossible",
      steps: [
        "Cette page est servie en http:// (sans cadenas 🔒) : les navigateurs bloquent la localisation sur ces adresses et AUCUN réglage ne peut la réactiver ici.",
        "Ouvrez NZOKO via une adresse sécurisée https:// — la version officielle déployée — ou, en développement, http://localhost:3000 (accepté par les navigateurs).",
        `Adresse actuelle : ${env.origin || "(inconnue)"}`,
      ],
      canOpenNewTab: false,
    };
  }

  if (env.embedded) {
    return {
      reason: "embedded",
      title: "Localisation bloquée dans cet aperçu intégré",
      steps: [
        "La page s'affiche dans un cadre intégré (aperçu) : le navigateur y bloque la demande d'autorisation sans jamais l'afficher.",
        "Cliquez sur « Ouvrir dans un nouvel onglet » ci-dessous — la page s'ouvrira seule, hors du cadre.",
        "Démarrez le suivi : la popup d'autorisation du navigateur apparaîtra — choisissez « Autoriser ».",
      ],
      canOpenNewTab: true,
    };
  }

  if (env.inAppBrowser) {
    return {
      reason: "in-app",
      title: "Navigateur d'application — localisation bloquée",
      steps: [
        "Ce lien a été ouvert dans le navigateur intégré d'une application (WhatsApp, Facebook, Instagram…) qui n'affiche jamais les demandes de localisation.",
        "Ouvrez le menu de l'application (⋮ ou ⇧) et choisissez « Ouvrir dans Chrome » ou « Ouvrir dans Safari ».",
        "Depuis le vrai navigateur, ouvrez NZOKO puis démarrez le suivi.",
      ],
      canOpenNewTab: false,
    };
  }

  return {
    reason: "denied",
    title: "Localisation refusée pour ce site",
    steps: deniedSteps(env.platform),
    // Utile même hors iframe : force une page top-level propre (et
    // rafraîchit l'état de permission sur certains navigateurs mobiles).
    canOpenNewTab: true,
  };
}

/** Message pédagogique en UNE ligne (toasts) — reprend le diagnostic
 *  complet : cause structurelle d'abord, sinon chemin selon plateforme. */
export function geoDeniedMessage(): string {
  const block = diagnoseGeoBlock();
  return `${block.title}. ${block.steps.slice(0, 2).join(" ")}`;
}

// ------------------------------------------------------------
// Demande robuste (geste utilisateur préservé)
// ------------------------------------------------------------

export interface GeoRequestResult {
  /** false UNIQUEMENT sur refus explicite — bloque le démarrage.
   *  Timeout/indisponibilité → true : le GPS peut revenir en route. */
  granted: boolean;
  /** Refus explicite du navigateur (popup refusée ou mémorisée). */
  denied: boolean;
  /** Diagnostic quand denied=true (null sinon). */
  block: GeoBlockDiagnosis | null;
}

/** Demande la position UNE fois pour déclencher l'autorisation.
 *  getCurrentPosition est appelé AVANT tout await : Safari iOS exige
 *  le lien direct avec le geste utilisateur (le clic) pour afficher
 *  la popup — un simple await avant l'appel peut la faire rejeter
 *  en silence. Réessai automatique sur timeout (premier fix GPS,
 *  surtout en intérieur). */
export function requestGeolocation(): Promise<GeoRequestResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ granted: false, denied: false, block: null });
  }
  return new Promise<GeoRequestResult>((resolve) => {
    let retried = false;
    const attempt = (timeout: number) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve({ granted: true, denied: false, block: null }),
        (err) => {
          if (err.code === err.TIMEOUT && !retried) {
            retried = true;
            attempt(30_000);
            return;
          }
          if (err.code === err.PERMISSION_DENIED) {
            // Popup refusée OU cause structurelle (http/iframe/webview)
            // → diagnostic immédiat, synchrone, sans nouvelle popup.
            resolve({ granted: false, denied: true, block: diagnoseGeoBlock() });
            return;
          }
          // POSITION_UNAVAILABLE (GPS éteint, intérieur…) : départ
          // autorisé — le signal revient souvent une fois en route.
          resolve({ granted: true, denied: false, block: null });
        },
        { enableHighAccuracy: true, timeout, maximumAge: 30_000 }
      );
    };
    attempt(15_000);
  });
}

// ------------------------------------------------------------
// Localisation éphémère (trouver mon agence)
// ------------------------------------------------------------

export interface LocateResult {
  latitude: number;
  longitude: number;
  /** Précision en mètres (rayon à 68 %) — transmise au serveur pour
   *  moduler l'affirmation du quartier. */
  accuracy: number | null;
}

/** Demande la position UNE fois, avec réessai automatique sur timeout
 *  (le premier fix GPS peut prendre 20-40 s à froid). Résout null en
 *  cas d'échec définitif — `reason` distingue refus/indisponibilité. */
export function locateOnce(
  onDenied?: () => void
): Promise<{ position: LocateResult | null; reason: "denied" | "unavailable" | "timeout" | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ position: null, reason: "unavailable" });
      return;
    }

    let retried = false;
    const attempt = (timeout: number, maximumAge: number) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            position: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
            },
            reason: null,
          });
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            onDenied?.();
            resolve({ position: null, reason: "denied" });
            return;
          }
          // TIMEOUT : un second essai, sans cache, avec plus de marge.
          if (err.code === err.TIMEOUT && !retried) {
            retried = true;
            attempt(30_000, 0);
            return;
          }
          resolve({ position: null, reason: "unavailable" });
        },
        { enableHighAccuracy: true, timeout, maximumAge }
      );
    };

    attempt(12_000, 30_000);
  });
}
