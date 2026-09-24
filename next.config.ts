import type { NextConfig } from "next";

// ============================================================
// En-têtes de sécurité HTTP (restaurés — voir audit sécurité).
//
// ⚠️ La CSP est possédée par src/middleware.ts (nonce par requête
// + 'strict-dynamic') — elle ne doit JAMAIS figurer ici : deux
// en-têtes CSP seraient tous deux appliqués par le navigateur.
//
// Permissions-Policy : camera=(self) pour le scanner QR du CHECKER
// (BarcodeDetector/getUserMedia, audit d'architecture point 18) et
// geolocation=(self) pour le suivi GPS chauffeur + « agences autour
// de moi ». ⚠️ geolocation=() bloquait TOUTE géolocalisation au niveau
// navigateur (popup d'autorisation jamais affichée, refus immédiat,
// aucun réglage utilisateur ne pouvait l'outrepasser) — corrigé.
//
// HSTS actif (HTTPS obligatoire en production derrière le proxy).
// ============================================================
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Origines de développement autorisées : le panneau de prévisualisation
  // du sandbox (proxy HTTPS) requête les ressources /_next/* depuis une
  // origine externe — sans cette déclaration, Next.js 16 les rejette à terme.
  allowedDevOrigins: ["*.space-z.ai", "localhost", "*.space-z.dev"],
  // Gardes-fous qualité réarmés (audit d'architecture Task 11) :
  // le build échoue désormais sur toute erreur TypeScript.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
