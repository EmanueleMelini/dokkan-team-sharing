import type { PoolConfig } from 'pg'

// La configurazione della pool letta dalle variabili d'ambiente, senza
// aprire connessioni: funzione pura, cosi' i test la provano su ogni caso
// (db/test/db-config.test.mts) e lib/db.ts resta solo la pool.

type Env = Record<string, string | undefined>

// I parametri TLS dell'URL. pg-connection-string li legge e il risultato
// SOSTITUISCE l'opzione ssl passata a Pool (connection-parameters.js fa
// Object.assign con l'URL per ultimo): un ?sslmode=require dimenticato
// nell'URL copiato da Supabase spegnerebbe in silenzio la verifica del
// certificato. Con DATABASE_CA_CERT impostata vale solo la nostra.
const PARAMETRI_TLS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']

const LOCALI = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** True se l'URL porta a questa macchina (host locale o socket Unix). */
export function isLocalDatabase(url: URL): boolean {
  // ?host=/tmp e' un socket: vince sull'host dell'URL, come in libpq.
  const host = url.searchParams.get('host')
  if (host !== null) return host.startsWith('/') || LOCALI.has(host)
  return url.hostname === '' || LOCALI.has(url.hostname)
}

/**
 * Il PEM del certificato radice, da DATABASE_CA_CERT. Le interfacce delle
 * variabili d'ambiente (Vercel compreso) a volte appiattiscono gli a capo
 * in "\n" letterali: si rimettono, altrimenti TLS non riconosce il PEM.
 */
export function readCaCert(value: string | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  const pem = v.includes('\\n') ? v.replace(/\\n/g, '\n') : v
  if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(pem)) {
    // Mai il valore nel messaggio: solo il nome della variabile.
    throw new Error('DATABASE_CA_CERT non contiene un certificato PEM (-----BEGIN CERTIFICATE-----).')
  }
  return pem
}

export type PoolSettings = PoolConfig & { connectionString: string }

/**
 * Pool di produzione (Vercel, NODE_ENV=production) o di sviluppo.
 *
 * In produzione le istanze sono effimere e servono molte richieste in
 * parallelo (Fluid compute): poche connessioni per istanza, chiuse presto
 * quando non servono, dietro il pooler in transaction mode di Supabase.
 * In sviluppo resta la pool di prima: un solo processo, Postgres locale.
 */
export function readPoolSettings(env: Env = process.env): PoolSettings {
  const raw = env.DATABASE_URL?.trim()
  if (!raw) {
    throw new Error(
      'DATABASE_URL non impostata. In sviluppo sta in .env.local; ' +
        'il database si avvia con `npm run db:start` se usi il cluster del progetto.',
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL non e\' un URL postgres:// valido.')
  }

  const production = env.NODE_ENV === 'production' || Boolean(env.VERCEL)
  const ca = readCaCert(env.DATABASE_CA_CERT)
  const locale = isLocalDatabase(url)

  // Un database remoto in produzione senza il certificato vorrebbe dire
  // TLS non verificato (o niente TLS): password e dati esposti a chi sta
  // in mezzo. Meglio un errore all'avvio che un sito che sembra andare.
  if (production && !locale && !ca) {
    throw new Error(
      'DATABASE_CA_CERT non impostata: in produzione il database remoto si raggiunge solo ' +
        'con TLS verificato (il certificato radice di Supabase, in formato PEM).',
    )
  }

  let ssl: PoolConfig['ssl'] = undefined
  if (ca) {
    for (const p of PARAMETRI_TLS) url.searchParams.delete(p)
    // rejectUnauthorized e il controllo del nome host restano quelli di
    // Node: catena verso la nostra radice E nome del server nel certificato.
    ssl = { ca, rejectUnauthorized: true }
  }

  return {
    connectionString: ca ? url.toString() : raw,
    ssl,
    max: production ? 5 : 10,
    // Corto in produzione: un'istanza sospesa con connessioni aperte le
    // terrebbe occupate sul pooler finche' il server non le chiude.
    idleTimeoutMillis: production ? 5_000 : 30_000,
    // Senza limite una richiesta resterebbe appesa finche' la funzione non
    // scade (300 s) se il database non risponde o e' in pausa.
    connectionTimeoutMillis: 10_000,
  }
}
