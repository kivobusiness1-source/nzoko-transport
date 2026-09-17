import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ============================================================
// NZOKO TRANSPORT — CSP à NONCE (durcissement sécurité)
//
// Convention Next.js 16 : "proxy" (ex-middleware, renommé natif).
// La Content-Security-Policy est possédée par CE fichier
// (jamais dupliquée dans next.config.ts : deux en-têtes CSP
// seraient TOUS DEUX appliqués par le navigateur).
//
// Mécanique (pattern officiel Next.js) :
//  1. Un nonce aléatoire est généré PAR REQUÊTE ;
//  2. il est injecté dans les en-têtes de REQUÊTE (x-nonce +
//     Content-Security-Policy) → Next.js le lit et l'applique
//     automatiquement à ses propres scripts (bootstrap/flight) ;
//  3. il est aussi posé sur la RÉPONSE (en-tête réel du navigateur) ;
//  4. les composants serveur le lisent via (await headers())
//     .get("x-nonce") pour leurs scripts inline (JSON-LD).
//
// Politique script-src :
//  - 'nonce-…' + 'strict-dynamic' → seuls les scripts marqués du
//    nonce (et ceux qu'ils injectent dynamiquement) s'exécutent ;
//    'self' est IGNORÉ par les navigateurs modernes ;
//  - repli legacy 'self' 'unsafe-inline' https: — ignoré par les
//    navigateurs modernes (nonce présent) mais maintient les
//    navigateurs anciens fonctionnels ;
//  - DEV uniquement : 'unsafe-eval' requis par le HMR/React
//    Refresh de Next.js (aucun risque hors développement).
//
// Styles : 'unsafe-inline' conservé (Tailwind, framer-motion et
// l'overlay Next injectent des <style> inline non-nonceables).
//
// Permissions-Policy (camera) reste dans next.config.ts.
// ============================================================

/** Nonce CSP aléatoire — base64, 128 bits (spec CSP nonce-source). */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV === "development";

  const scriptSrc = isDev
    ? // Développement : nonce + strict-dynamic + 'unsafe-eval' (HMR/React Refresh)
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline'`
    : // Production : nonce + strict-dynamic + repli legacy
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`;

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // 1) Injection côté REQUÊTE : Next.js lit ce nonce et marque ses scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // 2) En-tête réel côté RÉPONSE pour le navigateur.
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Toutes les routes document SAUF /api (pas de documents) et les
// assets _next statiques (inutile d'y calculer un nonce par requête).
export const config = {
  matcher: ["/((?!api|_next/static|_next/image).*)"],
};
