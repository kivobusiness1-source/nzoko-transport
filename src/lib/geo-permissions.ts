"use client";

// ============================================================
// NZOKO TRANSPORT — Gestion de la permission de géolocalisation
//
// Les navigateurs EXIGENT un accord explicite de l'utilisateur avant
// de transmettre sa position (règle de confidentialité — aucun site
// ne peut la contourner). Ce module rend ce parcours aussi fluide et
// compréhensible que possible :
//  - permissions.query → état connu AVANT d'appeler getCurrentPosition
//    (permission déjà accordée = zéro clic ; bloquée = guidance précise) ;
//  - détection du contexte intégré (iframe/aperçu) où la localisation
//    est bloquée SANS popup → suggestion d'ouvrir dans un onglet ;
//  - getCurrentPosition avec réessai automatique en cas de timeout
//    (premier fix GPS, surtout en intérieur).
// ============================================================

export type GeoPermissionState = "granted" | "prompt" | "denied" | "unsupported";

/** État de la permission de géolocalisation (Permissions API — Safari OK
 *  depuis 16.4 ; en cas d'absence → "unsupported", on tente quand même). */
export async function queryGeoPermission(): Promise<GeoPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state as GeoPermissionState;
  } catch {
    return "unsupported";
  }
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

/** Message pédagogique quand la localisation est bloquée, adapté au
 *  contexte (intégré vs page normale). */
export function geoDeniedMessage(): string {
  if (isEmbeddedContext()) {
    return "La localisation est bloquée dans cet aperçu intégré. Ouvrez la page dans un nouvel onglet (bouton « Ouvrir dans un nouvel onglet » au-dessus de l’aperçu), puis autorisez la localisation.";
  }
  return "La localisation est refusée pour ce site. Cliquez sur l’icône à gauche de l’adresse (🔒 ou ℹ), section « Autorisations » → « Localisation » → « Autoriser », puis rechargez la page.";
}

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
