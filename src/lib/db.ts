import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ──────────────────────────────────────────────────────────────────────
// Auto-correction d'environnement (migration Neon du 2026-09-17) :
// l'environnement sandbox peut injecter une DATABASE_URL SQLite périmée
// (file:…) qui ÉCRASE le fichier .env chargé par Next.js/Bun (l'env du
// processus a priorité). La sandbox réécrit aussi périodiquement le
// fichier .env lui-même — d'où une chaîne de repli à trois niveaux :
//
//   1. process.env.DATABASE_URL si elle pointe déjà vers PostgreSQL ;
//   2. DATABASE_URL lue dans le .env du projet (source de vérité) ;
//   3. DATABASE_URL lue dans .env.neon (sauvegarde non versionnée que
//      la sandbox ne réinitialise pas — restaurée si .env est écrasé).
//
// En production (Vercel…), une DATABASE_URL PostgreSQL définie dans
// l'environnement reste prioritaire (comportement inchangé).
// ──────────────────────────────────────────────────────────────────────

/** Extrait une DATABASE_URL PostgreSQL d'un fichier .env (simple parse). */
function readEnvFileUrl(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, 'utf8')
    const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m)
    if (match) {
      const url = match[1].trim().replace(/^["']|["']$/g, '')
      if (url.startsWith('postgres')) return url
    }
  } catch {
    // Fichier absent/illisible (hors projet, avant restauration…) —
    // on interroge la source suivante de la chaîne.
  }
  return undefined
}

function resolveDatabaseUrl(): string | undefined {
  const inherited = process.env.DATABASE_URL
  if (inherited?.startsWith('postgres')) return inherited
  const cwd = process.cwd()
  return (
    readEnvFileUrl(join(cwd, '.env')) ??
    readEnvFileUrl(join(cwd, '.env.neon')) ??
    inherited
  )
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
