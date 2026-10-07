import { readAuthEnv } from '@/lib/auth/env'
import { sqlOne } from '@/lib/db'

const DAY = 24 * 60 * 60 * 1000

async function purge() {
  try {
    const r = await sqlOne<{ n: number }>('select purge_auth_expired() as n')
    if (r?.n) console.log(`[auth] pulizia: ${r.n} righe scadute tolte`)
  } catch (e) {
    // Una pulizia mancata non deve fermare il sito: si riprova domani.
    console.error('[auth] pulizia non riuscita:', e instanceof Error ? e.message : e)
  }
}

/**
 * All'avvio: la configurazione deve essere completa (in produzione senza
 * RESEND_API_KEY il server non parte, invece di accettare richieste di
 * link che non arriverebbero mai), poi la pulizia di sessioni e token
 * scaduti, ora e ogni giorno.
 */
export async function startAuth() {
  readAuthEnv()
  await purge()
  setInterval(purge, DAY).unref()
}
