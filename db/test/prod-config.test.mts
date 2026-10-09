// La configurazione di produzione: la pool (dimensioni, TLS verificato da
// DATABASE_CA_CERT), l'header dell'IP per il limite di better-auth e
// l'autenticazione della rotta di Vercel Cron.
//
// Quasi tutto funzioni pure. L'ultima parte chiama la rotta vera
// /api/cron/purge sul database di test: lanciarlo dentro npm run db:test.
import pg from 'pg'
import { readIpAddressHeaders } from '@/lib/auth/env'
import { CRON_SECRET_MIN_LENGTH, isCronAuthorized } from '@/lib/cron'
import { isLocalDatabase, readCaCert, readPoolSettings } from '@/lib/db-config'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const mostra = (v: unknown) => JSON.stringify(v) ?? String(v)
function vale<T>(nome: string, got: T, atteso: T) {
  const ok = mostra(got) === mostra(atteso)
  check(nome, ok, `= ${mostra(got)}${ok ? '' : `, atteso ${mostra(atteso)}`}`)
}
/** Il messaggio dell'errore, o '' se non lancia. */
function errore(f: () => unknown): string {
  try { f(); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
}

// Non serve un certificato vero: si controlla la forma, e pg non apre
// connessioni in questo file (tranne la rotta in fondo, sul db locale).
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfakefakefake\n-----END CERTIFICATE-----'
// L'URL con le credenziali finte si compone a pezzi: nel file non c'e' mai
// un URL con utente e password scritto per intero.
const PASSWORD_FINTA = ['p', '%40', 'ss'].join('')
const REMOTO = `postgres://u:${PASSWORD_FINTA}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`

console.log('isLocalDatabase')
const loc = (u: string) => isLocalDatabase(new URL(u))
vale('localhost', loc('postgres://u@localhost:5432/db'), true)
vale('127.0.0.1', loc('postgres://u@127.0.0.1/db'), true)
vale('[::1]', loc('postgres://u@[::1]:5432/db'), true)
vale('socket senza host', loc('postgres:///db'), true)
vale('?host=/tmp e\' un socket', loc('postgres://u@db.example.com/db?host=/tmp'), true)
vale('?host= remoto vince su localhost', loc('postgres://u@localhost/db?host=db.example.com'), false)
vale('Supabase', loc(REMOTO), false)
vale('un nome che contiene localhost non lo e\'', loc('postgres://u@localhost.evil.com/db'), false)

console.log('readCaCert')
vale('assente', readCaCert(undefined), null)
vale('vuota', readCaCert('  '), null)
vale('PEM con a capo veri', readCaCert(PEM), PEM)
vale('PEM con \\n letterali', readCaCert(PEM.replace(/\n/g, '\\n')), PEM)
check('non un PEM: errore', errore(() => readCaCert('ciao')).includes('DATABASE_CA_CERT'))
check('l\'errore non contiene il valore', !errore(() => readCaCert('segreto-xyz')).includes('segreto-xyz'))

console.log('readPoolSettings: sviluppo')
const dev = readPoolSettings({ NODE_ENV: 'development', DATABASE_URL: 'postgres://u@localhost:5432/dokkan_dev' })
vale('URL invariato', dev.connectionString, 'postgres://u@localhost:5432/dokkan_dev')
vale('niente TLS', dev.ssl, undefined)
vale('max 10, idle 30 s', [dev.max, dev.idleTimeoutMillis], [10, 30_000])
vale('timeout di connessione', dev.connectionTimeoutMillis, 10_000)
check('senza DATABASE_URL: errore', errore(() => readPoolSettings({})).includes('DATABASE_URL'))
check('URL illeggibile: errore', errore(() => readPoolSettings({ DATABASE_URL: 'non un url' })).includes('DATABASE_URL'))
check('l\'errore non contiene l\'URL', !errore(() => readPoolSettings({ DATABASE_URL: 'pw-segreta' })).includes('pw-segreta'))

console.log('readPoolSettings: produzione')
const prodLocale = readPoolSettings({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u@localhost/dokkan_prodsim' })
vale('db locale senza CA: va (next start in locale)', prodLocale.ssl, undefined)
vale('max 5, idle 5 s', [prodLocale.max, prodLocale.idleTimeoutMillis], [5, 5_000])
check('remoto senza CA: errore', errore(() => readPoolSettings({ NODE_ENV: 'production', DATABASE_URL: REMOTO })).includes('DATABASE_CA_CERT'))
check('su Vercel conta come produzione', errore(() => readPoolSettings({ VERCEL: '1', DATABASE_URL: REMOTO })).includes('DATABASE_CA_CERT'))
vale('remoto in sviluppo senza CA: permesso', readPoolSettings({ DATABASE_URL: REMOTO }).ssl, undefined)

const conRequire = `${REMOTO}?sslmode=require&sslrootcert=/no/file&application_name=dts`
const prod = readPoolSettings({ VERCEL: '1', NODE_ENV: 'production', DATABASE_URL: conRequire, DATABASE_CA_CERT: PEM })
vale('TLS verificato con la CA', prod.ssl, { ca: PEM, rejectUnauthorized: true })
check('i parametri TLS tolti dall\'URL', !/ssl/.test(prod.connectionString), prod.connectionString.replace(/:[^:@/]*@/, ':***@'))
check('gli altri parametri restano', prod.connectionString.includes('application_name=dts'))
check('la password resta codificata', prod.connectionString.includes(`${PASSWORD_FINTA}@`))

// La prova che conta: cio' che pg usa davvero. Senza togliere sslmode
// dall'URL, pg-connection-string sostituirebbe la nostra opzione ssl.
const usati = (cfg: pg.ClientConfig) =>
  (new pg.Client(cfg) as unknown as { connectionParameters: { ssl: unknown; host: string; port: number } })
    .connectionParameters
const cp = usati(prod)
const sslUsata = cp.ssl as { ca?: string; rejectUnauthorized?: boolean }
vale('pg usa la nostra CA', sslUsata.ca, PEM)
vale('pg verifica il certificato', sslUsata.rejectUnauthorized, true)
vale('pg va sul pooler in transaction mode', [cp.host, cp.port], ['aws-0-eu-central-1.pooler.supabase.com', 6543])
const ingenuo = usati({ connectionString: `${REMOTO}?sslmode=no-verify`, ssl: { ca: PEM, rejectUnauthorized: true } }).ssl as { rejectUnauthorized?: boolean }
vale('(controprova: senza pulizia l\'URL vincerebbe)', ingenuo.rejectUnauthorized, false)

console.log('readIpAddressHeaders')
vale('sviluppo: default di better-auth', readIpAddressHeaders({}), null)
vale('Vercel: l\'header scritto da Vercel', readIpAddressHeaders({ VERCEL: '1' }), ['x-vercel-forwarded-for'])
vale('AUTH_IP_HEADERS vince', readIpAddressHeaders({ VERCEL: '1', AUTH_IP_HEADERS: 'X-Real-IP, cf-connecting-ip' }), ['x-real-ip', 'cf-connecting-ip'])
check('AUTH_IP_HEADERS storto: errore', errore(() => readIpAddressHeaders({ AUTH_IP_HEADERS: 'x real ip' })).includes('AUTH_IP_HEADERS'))
check('AUTH_IP_HEADERS solo virgole: errore', errore(() => readIpAddressHeaders({ AUTH_IP_HEADERS: ' , ' })).includes('AUTH_IP_HEADERS'))

console.log('isCronAuthorized')
const S = 'a'.repeat(CRON_SECRET_MIN_LENGTH) + '-cron'
vale('header giusto', isCronAuthorized(`Bearer ${S}`, S), true)
vale('senza header', isCronAuthorized(null, S), false)
vale('header vuoto', isCronAuthorized('', S), false)
vale('segreto sbagliato', isCronAuthorized(`Bearer ${S}x`, S), false)
vale('un prefisso del segreto', isCronAuthorized(`Bearer ${S.slice(0, -1)}`, S), false)
vale('senza "Bearer "', isCronAuthorized(S, S), false)
vale('bearer minuscolo', isCronAuthorized(`bearer ${S}`, S), false)
vale('spazio in piu\'', isCronAuthorized(`Bearer  ${S}`, S), false)
vale('CRON_SECRET assente: sempre no', isCronAuthorized('Bearer ', undefined), false)
vale('CRON_SECRET vuoto: sempre no', isCronAuthorized('Bearer ', ''), false)
const corto = 'x'.repeat(CRON_SECRET_MIN_LENGTH - 1)
vale('CRON_SECRET troppo corto: sempre no', isCronAuthorized(`Bearer ${corto}`, corto), false)

// La rotta vera, sul database di test: 401 senza il segreto (e senza
// toccare il database), 200 con il conteggio quando Vercel la chiama.
console.log('/api/cron/purge')
const url = process.env.TEST_DATABASE_URL ?? ''
if (!/_test$/.test(new URL(url || 'postgres:///x').pathname) || process.env.DATABASE_URL !== url) {
  console.error('\n  mi fermo: DATABASE_URL e TEST_DATABASE_URL devono puntare allo stesso database *_test')
  console.error('  (lancialo dentro  npm run db:test)\n')
  process.exit(2)
}
process.env.CRON_SECRET = `${S}-route`
const { GET } = await import('@/app/api/cron/purge/route')
const { db } = await import('@/lib/db')
type Rotta = Parameters<typeof GET>[0]
const chiama = (auth?: string) =>
  GET(new Request('http://localhost/api/cron/purge', { headers: auth ? { authorization: auth } : {} }) as Rotta)

const senza = await chiama()
vale('senza Authorization: 401', senza.status, 401)
vale('401 non in cache', senza.headers.get('cache-control'), 'no-store')
vale('segreto sbagliato: 401', (await chiama(`Bearer ${S}`)).status, 401)

// Una sessione scaduta da togliere: un utente di prova, poi via.
const uid = (await db.query<{ id: string }>(
  "insert into app_user (handle, email) values ('cronpurge_test', 'crontest+purge@example.invalid') returning id")).rows[0].id
try {
  await db.query(
    `insert into auth_session (id, user_id, token, expires_at)
     values (gen_random_uuid(), $1, 'crontest-' || gen_random_uuid(), now() - interval '1 day')`, [uid])
  const ok = await chiama(`Bearer ${S}-route`)
  vale('con il segreto: 200', ok.status, 200)
  const corpo = (await ok.json()) as { purged?: number }
  check('restituisce quante righe ha tolto', typeof corpo.purged === 'number' && corpo.purged >= 1, mostra(corpo))
  const rimaste = (await db.query('select 1 from auth_session where user_id = $1', [uid])).rowCount
  vale('la sessione scaduta non c\'e\' piu\'', rimaste, 0)
} finally {
  await db.query('delete from app_user where id = $1', [uid])
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
