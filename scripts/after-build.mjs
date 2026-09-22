// ============================================================
// NZOKO TRANSPORT — Post-build (cross-platform Windows/Linux/mac)
// Copie static/ + public/ dans le serveur standalone, sans `cp -r`
// (inexistant sous Windows cmd).
// ============================================================

import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("❌ .next/standalone introuvable — lancez d'abord `next build`.");
  process.exit(1);
}

// static/ → .next/standalone/.next/static
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standalone, ".next", "static");
mkdirSync(path.dirname(staticDest), { recursive: true });
cpSync(staticSrc, staticDest, { recursive: true });

// public/ → .next/standalone/public
const publicSrc = path.join(root, "public");
const publicDest = path.join(standalone, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true });
}

console.warn("✅ Build standalone prêt : npm run start (ou bun .next/standalone/server.js)");
