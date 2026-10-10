import { Pool } from 'pg'
import { readPoolSettings } from '@/lib/db-config'

// Una sola pool per processo. In sviluppo Next ricarica i moduli a ogni
// modifica, e senza questo si accumulerebbero pool finché Postgres non
// rifiuta le connessioni.
const globalForDb = globalThis as unknown as { dokkanPool?: Pool }

// Dimensioni, tempi e TLS stanno in lib/db-config.ts, provati dai test.
export const db: Pool = globalForDb.dokkanPool ?? new Pool(readPoolSettings())

// Anche in produzione: il bundler puo' copiare questo modulo in piu'
// chunk del server (pagine, Route Handler, instrumentation), e ogni copia
// aprirebbe la sua pool, moltiplicando le connessioni sul pooler.
globalForDb.dokkanPool = db

// Un client inattivo che perde la connessione (il database riavviato, o
// ricreato da db:reset) emette 'error' sulla pool. Senza un listener
// l'evento diventa un'eccezione non gestita; la pool invece scarta da sola
// quel client e alla query successiva ne apre uno nuovo, quindi basta dirlo.
if (!db.listenerCount('error')) {
  db.on('error', (err) => console.error('[db] connessione inattiva persa:', err.message))
}

/**
 * Esegue una query e restituisce le righe già tipizzate.
 *
 * Un deadlock (40P01) si riprova una volta. Ogni chiamata è una sola
 * istruzione in autocommit sulla pool, e Postgres la annulla per intero:
 * riprovarla è come se l'utente avesse cliccato di nuovo. Succede, raro,
 * quando due scritture insieme bloccano le stesse righe degli admin col
 * feed dell'attività acceso in ordini diversi (0032, per esempio un
 * moderatore che nasconde una tip mentre qualcuno la vota).
 */
export async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
  try {
    const res = await db.query(text, params)
    return res.rows as T[]
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code !== '40P01') throw e
    const res = await db.query(text, params)
    return res.rows as T[]
  }
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
