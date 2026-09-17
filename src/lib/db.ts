import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ──────────────────────────────────────────────────────────────────────
// Auto-correction d'environnement (migration Neon du 2026-09-17) :
// l'environnement sandbox peut injecter une DATABASE_URL SQLite périmée
// (file:…) qui ÉCRASE le fichier .env chargé par Next.js/Bun (l'env du
// processus a priorité). Depuis la migration vers PostgreSQL (Neon), le
// .env du projet est la source de vérité : si la variable héritée ne
// pointe pas vers PostgreSQL, on relit l'URL dans .env.
// En production, une DATABASE_URL PostgreSQL définie dans l'environnement
// reste prioritaire (comportement inchangé).
// ──────────────────────────────────────────────────────────────────────
function resolveDatabaseUrl(): string | undefined {
  const inherited = process.env.DATABASE_URL
  if (inherited?.startsWith('postgres')) return inherited
  try {
    const envFile = readFileSync(join(process.cwd(), '.env'), 'utf8')
    const match = envFile.match(/^DATABASE_URL\s*=\s*(.+)$/m)
    if (match) {
      const url = match[1].trim().replace(/^["']|["']$/g, '')
      if (url.startsWith('postgres')) return url
    }
  } catch {
    // .env illisible (hors projet) — on laisse la valeur héritée
    // pour que Prisma produise une erreur explicite si elle est invalide.
  }
  return inherited
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const databaseUrl = resolveDatabaseUrl()

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
