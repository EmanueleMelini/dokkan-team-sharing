import { readAuthEnv } from '@/lib/auth/env'
import { sqlOne } from '@/lib/db'

const DAY = 24 * 60 * 60 * 1000

/**
 * Toglie sessioni, token e contatori scaduti (purge_auth_expired, 0014).
 * Restituisce quante righe ha tolto. La chiamano il timer qui sotto in
 * sviluppo e la rotta /api/cron/purge su Vercel.
 */
export async function purgeAuthExpired(): Promise<number> {
  const r = await sqlOne<{ n: number }>('select purge_auth_expired() as n')
  return r?.n ?? 0
}

async function purge() {
  try {
    const n = await purgeAuthExpired()
    if (n) console.log(`[auth] pulizia: ${n} righe scadute tolte`)
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
 *
 * Su Vercel niente pulizia qui: le istanze vivono minuti, il timer di un
 * giorno non scatterebbe mai, e quella all'avvio girerebbe a ogni avvio a
 * freddo. Lo fa Vercel Cron una volta al giorno (vercel.json).
 */
export async function startAuth() {
  readAuthEnv()
  if (process.env.VERCEL) return
  await purge()
  setInterval(purge, DAY).unref()
}
