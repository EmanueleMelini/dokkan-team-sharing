// Il bersaglio degli script di produzione, deciso in un posto solo.
//
// Contro la produzione un errore non si annulla con un db:reset, quindi
// qui ogni ambiguita' e' un no: l'URL arriva solo da PROD_DATABASE_URL
// (mai DATABASE_URL, mai .env.local, che sono lo sviluppo), un database
// locale o col nome di sviluppo/test si rifiuta, il TLS deve verificare
// il certificato, e senza --yes non si tocca niente.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])
// il vecchio database di un altro progetto sullo stesso server: mai
const FORBIDDEN_DBS = new Set(['dokkanteamsharing'])
// L'ordine non conta (si cancellano dall'URL uno per uno), ma 'sslpassword'
// sta in fondo: seguito da un'altra stringa, gli scanner di segreti la
// leggevano come una password con quel valore (falso positivo di GitGuardian).
const SSL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'sslpassword']

const fail = (msg) => { throw new Error(msg) }

export function parseFlags(argv) {
  return { yes: argv.includes('--yes'), allowLocal: argv.includes('--allow-local') }
}

// Pura, per i test: dall'ambiente e dai flag all'URL da usare davvero.
// Ritorna { url, info }, oppure lancia con il motivo del rifiuto.
export function resolveTarget(env, { allowLocal = false } = {}) {
  const raw = env.PROD_DATABASE_URL
  if (!raw) fail('manca PROD_DATABASE_URL (la connessione diretta o di sessione di Supabase)')
  let u
  try { u = new URL(raw) } catch { fail('PROD_DATABASE_URL non e\' un URL valido') }
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail(`protocollo ${u.protocol} non previsto`)
  // questi parametri riscrivono host, porta, database o utente dell'URL:
  // il bersaglio stampato e confermato non sarebbe quello vero
  for (const k of ['host', 'hostaddr', 'port', 'dbname', 'user', 'service']) {
    if (u.searchParams.has(k)) fail(`il parametro ?${k}= cambia il bersaglio: scrivilo nell'URL, non dopo`)
  }
  const db = decodeURIComponent(u.pathname.slice(1))
  if (!db) fail('PROD_DATABASE_URL non dice il nome del database')
  if (FORBIDDEN_DBS.has(db)) fail(`${db} non e' di questo progetto: non lo tocco`)
  const host = u.hostname.toLowerCase()
  const local = LOCAL_HOSTS.has(host)
  const devName = /_(dev|test)$/i.test(db)
  if ((local || devName) && !allowLocal) {
    fail(`${local ? `host ${host || '(socket)'}` : `database ${db}`} sembra sviluppo, non produzione` +
         ' (--allow-local solo per la simulazione)')
  }
  // Porta 6543 = pooler in transaction mode: va bene per l'app, non per
  // le migrazioni (DDL lunghe) ne' per pg_dump. Qui serve la connessione
  // diretta (5432) o quella di sessione del pooler (5432 anche lei).
  if (u.port === '6543') fail('porta 6543 e\' il pooler transaction: usa la connessione diretta o di sessione (5432)')

  const ca = env.PROD_DATABASE_CA_CERT
  const mode = u.searchParams.get('sslmode')
  /** @type {string} */
  let tls = ''
  if (ca) {
    const path = resolve(ca)
    if (!existsSync(path)) fail(`PROD_DATABASE_CA_CERT: ${path} non esiste`)
    // i parametri TLS dell'URL si sostituiscono tutti: un sslmode=require
    // copiato dalla dashboard non deve sopravvivere accanto alla CA
    for (const k of SSL_PARAMS) u.searchParams.delete(k)
    u.searchParams.set('sslmode', 'verify-full')
    u.searchParams.set('sslrootcert', path)
    tls = `verificato con la CA ${path}`
  } else if (mode === 'verify-full' && u.searchParams.get('sslrootcert')) {
    tls = `verificato con la CA ${u.searchParams.get('sslrootcert')}`
  } else if (local) {
    tls = 'nessuno (database locale)'
  } else {
    fail('database remoto senza CA: imposta PROD_DATABASE_CA_CERT con il percorso del .crt di Supabase' +
         ' (niente TLS non verificato verso la produzione)')
  }
  const port = u.port || '5432'
  return { url: u.href, info: { host: host || '(socket)', port, db, user: decodeURIComponent(u.username) || '(default)', tls, local } }
}

export function describe(info) {
  return `${info.host}:${info.port}/${info.db} come ${info.user}, TLS ${info.tls}`
}

// L'ambiente dei processi figli: il loro DATABASE_URL e' il nostro, i file
// .env non si leggono (db/env.mjs) e le PG* si tolgono, perche' pg le usa
// come valori di ripiego per quello che l'URL non dice (password, sslmode).
/**
 * @param {string} url
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string | undefined>}
 */
export function childEnv(url, env = process.env) {
  /** @type {Record<string, string | undefined>} */
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('PG') || k === 'DATABASE_URL' || k === 'DATABASE_CA_CERT') continue
    out[k] = v
  }
  out.DATABASE_URL = url
  out.DOKKAN_ENV_FILES = 'off'
  return out
}

// Il preambolo comune: bersaglio, stampa, conferma. Esce invece di lanciare,
// e' l'ingresso degli script.
export function prepare(title, steps) {
  const flags = parseFlags(process.argv.slice(2))
  let target
  try { target = resolveTarget(process.env, flags) } catch (err) {
    console.error(`\n  ${title}: ${err.message}\n`); process.exit(1)
  }
  console.log(`\n  ${title}`)
  console.log(`  database: ${describe(target.info)}`)
  console.log(`  passi: ${steps.join(', ')}`)
  if (!flags.yes) {
    console.log('\n  Niente e\' stato toccato. Se il bersaglio e\' giusto, rilancia con --yes.\n')
    process.exit(2)
  }
  return { ...target, env: childEnv(target.url) }
}

export function runNode(script, args, env) {
  console.log(`\n  ---- ${script} ${args.join(' ')}`.trimEnd())
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], { stdio: 'inherit', env, cwd: ROOT })
  if (r.status !== 0) {
    console.error(`\n  ${script} e' fallito (uscita ${r.status ?? r.signal}): mi fermo qui.`)
    console.error('  Gli importer sono idempotenti: sistemato il problema, si rilancia da capo.\n')
    process.exit(1)
  }
}
