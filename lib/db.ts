import { Pool } from 'pg'

// Una sola pool per processo. In sviluppo Next ricarica i moduli a ogni
// modifica, e senza questo si accumulerebbero pool finché Postgres non
// rifiuta le connessioni.
const globalForDb = globalThis as unknown as { dokkanPool?: Pool }

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL non impostata. In sviluppo sta in .env.local; ' +
        'il database si avvia con `npm run db:start` se usi il cluster del progetto.',
    )
  }
  return url
}

export const db: Pool =
  globalForDb.dokkanPool ??
  new Pool({
    connectionString: connectionString(),
    max: 10,
    idleTimeoutMillis: 30_000,
  })

if (process.env.NODE_ENV !== 'production') globalForDb.dokkanPool = db

// Un client inattivo che perde la connessione (il database riavviato, o
// ricreato da db:reset) emette 'error' sulla pool. Senza un listener
// l'evento diventa un'eccezione non gestita; la pool invece scarta da sola
// quel client e alla query successiva ne apre uno nuovo, quindi basta dirlo.
if (!db.listenerCount('error')) {
  db.on('error', (err) => console.error('[db] connessione inattiva persa:', err.message))
}

/** Esegue una query e restituisce le righe già tipizzate. */
export async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(text, params)
  return res.rows as T[]
}

/** La prima riga, o null. Per le query che ne attendono al massimo una. */
export async function sqlOne<T>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await sql<T>(text, params)
  return rows[0] ?? null
}

/**
 * L'URL pubblico di un asset a partire dalla sua chiave.
 * Il database tiene la chiave ('cards/1007470/thumb.webp'), non l'URL:
 * così passare dal disco locale a un object storage è una variabile
 * d'ambiente e non una UPDATE su migliaia di righe.
 */
export function assetUrl(key: string | null | undefined): string | null {
  if (!key) return null
  const base = process.env.ASSET_BASE_URL ?? '/assets'
  return `${base.replace(/\/$/, '')}/${key}`
}
