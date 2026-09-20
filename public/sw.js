// ============================================================
// NZOKO TRANSPORT — Service Worker (PWA)
// Stratégies :
//  - Navigations : network-first → cache → /offline.html
//  - Build Next (/_next/static) : RÉSEAU-FIRST ⚠️ (incident
//    2026-09-19 « ChunkLoadError admin » : en dev Turbopack, les URL
//    de chunks sont STABLES mais leur contenu change à chaque
//    recompilation/restart — un cache-first servait indéfiniment des
//    modules périmés, même après F5, et brisait le graphe de modules
//    → ChunkLoadError persistant. Réseau-first : toujours frais en
//    dev ; en prod le CDN répond vite et le cache reste un repli hors
//    ligne. Bump v2 → les caches v1 sont purgés à l'activation.)
//  - Immuables (icônes, manifest, offline) : cache-first
//  - /api/* : TOUJOURS réseau (données fraîches obligatoires)
//  - Le scanner offline (cache chiffré des passagers) est une
//    évolution documentée — NON implémentée ici (voir worklog §36)
// ============================================================

const VERSION = "nzoko-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutantes : jamais d'interception

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin : laisser passer

  // API : réseau exclusif (jamais de cache de données métier)
  if (url.pathname.startsWith("/api/")) return;

  // Build Next : RÉSEAU-FIRST avec rafraîchissement du cache
  // (repli hors ligne). ⚠️ JAMAIS cache-first ici — cf. incident
  // ChunkLoadError du 2026-09-19 documenté en tête de fichier.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(req, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (cached) => cached || new Response("", { status: 504, statusText: "NZOKO offline" })
          )
        )
    );
    return;
  }

  // Immuables (contenu jamais réécrit sous une même URL) : cache-first
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.png" ||
    url.pathname === "/offline.html"
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Navigations : network-first avec repli offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGES_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
  }
});

// Message du client : reprise de contrôle immédiate après mise à jour
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
