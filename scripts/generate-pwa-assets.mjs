#!/usr/bin/env bun
// ============================================================
// NZOKO TRANSPORT — Génération des assets PWA
//  - Splash screens iOS (apple-touch-startup-image) : 13 tailles
//  - Screenshots du manifest (install enrichi Android/desktop)
// Usage : bun scripts/generate-pwa-assets.mjs
// ============================================================

import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/icons";
mkdirSync(`${OUT}/splash`, { recursive: true });
mkdirSync(`${OUT}/screenshots`, { recursive: true });

const FONT = "DejaVu Sans, FreeSans, sans-serif";

// Autocar de marque (viewBox 512, identique à offline.html/manifest)
const BUS = `
  <g>
    <rect x="80" y="130" width="352" height="230" rx="34" fill="#ffffff"/>
    <rect x="112" y="162" width="86" height="60" rx="12" fill="#0B6E4A"/>
    <rect x="212" y="162" width="86" height="60" rx="12" fill="#0B6E4A"/>
    <rect x="312" y="162" width="86" height="60" rx="12" fill="#0B6E4A" opacity=".55"/>
    <rect x="112" y="240" width="240" height="16" rx="8" fill="#F59E0B"/>
    <rect x="330" y="240" width="48" height="102" rx="10" fill="#F59E0B"/>
    <circle cx="160" cy="382" r="30" fill="#1F2937"/>
    <circle cx="352" cy="382" r="30" fill="#1F2937"/>
    <circle cx="160" cy="382" r="12" fill="#E5E7EB"/>
    <circle cx="352" cy="382" r="12" fill="#E5E7EB"/>
  </g>`;

const busGroup = (size) => `<g transform="scale(${size / 512})">${BUS}</g>`;

// ---------- Splash screen (une taille) ----------
function splashSvg(w, h) {
  const u = Math.min(w, h) / 812; // unité relative
  const logo = 300 * u;
  const cx = w / 2;
  const logoTop = h * 0.34 - logo / 2;
  const wordY = logoTop + logo + 100 * u;
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0C7852"/>
      <stop offset="1" stop-color="#095838"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <path d="M0 ${h * 0.86} C ${w * 0.25} ${h * 0.80}, ${w * 0.4} ${h * 0.92}, ${w * 0.55} ${h * 0.88} L ${w} ${h * 0.96} L ${w} ${h} L 0 ${h} Z" fill="#ffffff" opacity="0.06"/>
  <path d="M0 ${h * 0.90} C ${w * 0.3} ${h * 0.85}, ${w * 0.5} ${h * 0.95}, ${w * 0.7} ${h * 0.91} L ${w} ${h * 0.98} L ${w} ${h} L 0 ${h} Z" fill="#ffffff" opacity="0.08"/>
  <g transform="translate(${cx - logo / 2}, ${logoTop})">${busGroup(logo)}</g>
  <text x="${cx}" y="${wordY}" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="${64 * u}" fill="#ffffff" letter-spacing="${6 * u}">NZOKO</text>
  <text x="${cx}" y="${wordY + 34 * u}" text-anchor="middle" font-family="${FONT}" font-size="${26 * u}" fill="#9FD8BF" letter-spacing="${10 * u}">TRANSPORT</text>
  <text x="${cx}" y="${h * 0.80}" text-anchor="middle" font-family="${FONT}" font-size="${24 * u}" fill="#CDEBDD">Voyagez simplement. Voyagez en confiance.</text>
</svg>`;
}

// ---------- Screenshot manifest (portrait, 1080x1920) ----------
function screenshotNarrowSvg(w, h) {
  const pad = 84;
  const cardR = 36;
  const features = [
    { t: "Recherchez votre voyage", s: "Villes, dates et places en temps réel", icon: "magnifier" },
    { t: "Payez comme vous voulez", s: "Espèces au guichet ou Mobile Money", icon: "phone" },
    { t: "Voyagez avec votre QR", s: "Billet QR, embarquement au scan", icon: "qr" },
  ];
  const iconDefs = {
    magnifier: `<circle cx="0" cy="0" r="26" fill="none" stroke="#ffffff" stroke-width="8"/><line x1="18" y1="18" x2="38" y2="38" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>`,
    phone: `<rect x="-16" y="-28" width="32" height="56" rx="8" fill="none" stroke="#ffffff" stroke-width="6"/><line x1="-6" y1="18" x2="6" y2="18" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>`,
    qr: `<rect x="-28" y="-28" width="16" height="16" fill="#ffffff"/><rect x="12" y="-28" width="16" height="16" fill="#ffffff"/><rect x="-28" y="12" width="16" height="16" fill="#ffffff"/><rect x="-4" y="-4" width="8" height="8" fill="#ffffff"/><rect x="12" y="12" width="6" height="6" fill="#ffffff"/><rect x="22" y="4" width="6" height="6" fill="#ffffff"/>`,
  };
  const cards = features
    .map((f, i) => {
      const y = 980 + i * 300;
      return `
  <g>
    <rect x="${pad}" y="${y}" width="${w - pad * 2}" height="240" rx="${cardR}" fill="#ffffff"/>
    <rect x="${pad}" y="${y}" width="${w - pad * 2}" height="240" rx="${cardR}" fill="none" stroke="#DCE9E1" stroke-width="3"/>
    <circle cx="${pad + 130}" cy="${y + 120}" r="56" fill="#0B6E4A"/>
    <g transform="translate(${pad + 130}, ${y + 120})">${iconDefs[f.icon]}</g>
    <text x="${pad + 230}" y="${y + 100}" font-family="${FONT}" font-weight="bold" font-size="52" fill="#1a2e25">${f.t}</text>
    <text x="${pad + 230}" y="${y + 160}" font-family="${FONT}" font-size="40" fill="#5f6f66">${f.s}</text>
  </g>`;
    })
    .join("");
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0C7852"/>
      <stop offset="1" stop-color="#095838"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="#F6FAF7"/>
  <rect width="${w}" height="880" fill="url(#hero)"/>
  <path d="M0 800 C 300 720, 600 900, ${w} 820 L ${w} 880 L 0 880 Z" fill="#F6FAF7"/>
  <g transform="translate(${w / 2 - 130}, 210)">${busGroup(260)}</g>
  <text x="${w / 2}" y="640" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="92" fill="#ffffff" letter-spacing="8">NZOKO</text>
  <text x="${w / 2}" y="700" text-anchor="middle" font-family="${FONT}" font-size="38" fill="#9FD8BF" letter-spacing="16">TRANSPORT</text>
  <text x="${w / 2}" y="790" text-anchor="middle" font-family="${FONT}" font-size="42" fill="#CDEBDD">Réservez votre bus en 2 minutes</text>
  ${cards}
  <text x="${w / 2}" y="${h - 90}" text-anchor="middle" font-family="${FONT}" font-size="36" fill="#7b8a83">Congo-Brazzaville · Pointe-Noire — Brazzaville</text>
</svg>`;
}

// ---------- Screenshot manifest (paysage, 1920x1080) ----------
function screenshotWideSvg(w, h) {
  const pad = 100;
  const cols = [
    { t: "Recherche &amp; réservation", s: "Plan de sièges interactif, verrouillage", icon: "magnifier" },
    { t: "Paiements flexibles", s: "Espèces, MTN MoMo, Airtel Money + suivi", icon: "phone" },
    { t: "Embarquement QR", s: "Scan anti-fraude et tableau de départ", icon: "qr" },
  ];
  const iconDefs = {
    magnifier: `<circle cx="0" cy="0" r="22" fill="none" stroke="#ffffff" stroke-width="7"/><line x1="15" y1="15" x2="32" y2="32" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>`,
    phone: `<rect x="-14" y="-24" width="28" height="48" rx="7" fill="none" stroke="#ffffff" stroke-width="5"/><line x1="-5" y1="15" x2="5" y2="15" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>`,
    qr: `<rect x="-24" y="-24" width="14" height="14" fill="#ffffff"/><rect x="10" y="-24" width="14" height="14" fill="#ffffff"/><rect x="-24" y="10" width="14" height="14" fill="#ffffff"/><rect x="-3" y="-3" width="7" height="7" fill="#ffffff"/><rect x="10" y="10" width="5" height="5" fill="#ffffff"/>`,
  };
  const cards = cols
    .map((c, i) => {
      const x = pad + i * ((w - pad * 2) / 3);
      const cw = (w - pad * 2) / 3 - 30;
      return `
  <g>
    <rect x="${x}" y="560" width="${cw}" height="380" rx="32" fill="#ffffff"/>
    <rect x="${x}" y="560" width="${cw}" height="380" rx="32" fill="none" stroke="#DCE9E1" stroke-width="3"/>
    <circle cx="${x + 100}" cy="680" r="52" fill="#0B6E4A"/>
    <g transform="translate(${x + 100}, 680)">${iconDefs[c.icon]}</g>
    <text x="${x + 40}" y="800" font-family="${FONT}" font-weight="bold" font-size="46" fill="#1a2e25">${c.t}</text>
    <text x="${x + 40}" y="860" font-family="${FONT}" font-size="34" fill="#5f6f66">${c.s}</text>
  </g>`;
    })
    .join("");
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0C7852"/>
      <stop offset="1" stop-color="#095838"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="#F6FAF7"/>
  <rect width="${w}" height="500" fill="url(#hero)"/>
  <path d="M0 430 C 500 360, 1200 480, ${w} 420 L ${w} 500 L 0 500 Z" fill="#F6FAF7"/>
  <g transform="translate(${pad}, 120)">${busGroup(240)}</g>
  <text x="${w - pad}" y="260" text-anchor="end" font-family="${FONT}" font-weight="bold" font-size="88" fill="#ffffff" letter-spacing="8">NZOKO</text>
  <text x="${w - pad}" y="320" text-anchor="end" font-family="${FONT}" font-size="34" fill="#9FD8BF" letter-spacing="16">TRANSPORT</text>
  <text x="${w - pad}" y="420" text-anchor="end" font-family="${FONT}" font-size="38" fill="#CDEBDD">La plateforme de billetterie interurbaine</text>
  ${cards}
</svg>`;
}

// ---------- Appareils iOS (portrait, dpr) ----------
const DEVICES = [
  { name: "iphone-se", w: 320, h: 568, dpr: 2 },
  { name: "iphone-6-7-8-se2", w: 375, h: 667, dpr: 2 },
  { name: "iphone-plus", w: 414, h: 736, dpr: 3 },
  { name: "iphone-x-xs-11pro-mini", w: 375, h: 812, dpr: 3 },
  { name: "iphone-xr-11", w: 414, h: 896, dpr: 2 },
  { name: "iphone-xsmax-11promax", w: 426, h: 896, dpr: 3 },
  { name: "iphone-12-13-14", w: 390, h: 844, dpr: 3 },
  { name: "iphone-12promax-13promax-14plus", w: 428, h: 926, dpr: 3 },
  { name: "iphone-14pro-15-16", w: 393, h: 852, dpr: 3 },
  { name: "iphone-14promax-15promax-16plus", w: 430, h: 932, dpr: 3 },
  { name: "ipad-10-2", w: 810, h: 1080, dpr: 2 },
  { name: "ipad-pro-11", w: 834, h: 1194, dpr: 2 },
  { name: "ipad-pro-12-9", w: 1024, h: 1366, dpr: 2 },
];

async function main() {
  // Splash screens
  for (const d of DEVICES) {
    const file = `${OUT}/splash/${d.name}.png`;
    await sharp(Buffer.from(splashSvg(d.w * d.dpr, d.h * d.dpr))).png({ compressionLevel: 9 }).toFile(file);
    const media = `(device-width: ${d.w}px) and (device-height: ${d.h}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`;
    console.log(`splash ${d.name} ${d.w * d.dpr}x${d.h * d.dpr} → ${media}`);
  }

  // Screenshots manifest
  await sharp(Buffer.from(screenshotNarrowSvg(1080, 1920))).png({ compressionLevel: 9 }).toFile(`${OUT}/screenshots/narrow.png`);
  console.log("screenshot narrow 1080x1920");
  await sharp(Buffer.from(screenshotWideSvg(1920, 1080))).png({ compressionLevel: 9 }).toFile(`${OUT}/screenshots/wide.png`);
  console.log("screenshot wide 1920x1080");
  console.log("✓ Assets PWA générés");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
