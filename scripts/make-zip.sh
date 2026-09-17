#!/bin/bash
# Régénère le ZIP téléchargeable nzoko-transport.zip — version de production
# autonome SANS secrets (.env réel), SANS node_modules, SANS .next, SANS base
# de données. Vérifié exhaustivement (worklog Task ID 6 & 10).
set -euo pipefail
cd /home/z/my-project

STAGE=/tmp/nzoko-zip-stage
rm -rf "$STAGE"
mkdir -p "$STAGE/nzoko-transport/db"

# --- Source applicative complète ---
cp -r src "$STAGE/nzoko-transport/src"
cp -r prisma "$STAGE/nzoko-transport/prisma"
rm -f "$STAGE/nzoko-transport/prisma/migrations"/*.sql 2>/dev/null || true

# --- Configs & racine ---
for f in package.json bun.lock postcss.config.mjs eslint.config.mjs \
         tsconfig.json next.config.ts tailwind.config.ts components.json \
         next-env.d.ts .env.example .gitignore \
         README.md README-MOMO.md README-ASSISTANT.md; do
  [ -f "$f" ] && cp "$f" "$STAGE/nzoko-transport/"
done
touch "$STAGE/nzoko-transport/db/.gitkeep"

# --- Scripts de maintenance (idempotents, utiles en upgrade) ---
mkdir -p "$STAGE/nzoko-transport/scripts"
cp scripts/fix-phones.ts scripts/create-passenger-role.ts scripts/dev-seed-demo-client.ts "$STAGE/nzoko-transport/scripts/" 2>/dev/null || true

# --- Public (sans l'archive elle-même ni download/) ---
mkdir -p "$STAGE/nzoko-transport/public"
find public -maxdepth 2 -type f ! -name "nzoko-transport.zip" -exec cp --parents {} "$STAGE/nzoko-transport/" \; 2>/dev/null || true

# --- Purge : aucun secret, aucun artefact ---
find "$STAGE" -name ".env" -not -name ".env.example" -delete
rm -rf "$STAGE/nzoko-transport/.next" "$STAGE/nzoko-transport/node_modules"
find "$STAGE" -name "*.db" -delete
rm -f "$STAGE/nzoko-transport/dev.log" "$STAGE/nzoko-transport/worklog.md"

# --- Archive ---
rm -f public/nzoko-transport.zip download/nzoko-transport.zip
(cd "$STAGE" && zip -r -q /home/z/my-project/public/nzoko-transport.zip nzoko-transport)
mkdir -p download
cp public/nzoko-transport.zip download/nzoko-transport.zip

FILES=$(unzip -l public/nzoko-transport.zip | tail -1 | awk '{print $2}')
SIZE=$(du -h public/nzoko-transport.zip | cut -f1)
echo "✓ ZIP régénéré : $FILES fichiers, $SIZE"
echo "✓ Vérification secret .env : $(unzip -l public/nzoko-transport.zip | grep -c 'nzoko-transport/.env$') (doit être 0)"
