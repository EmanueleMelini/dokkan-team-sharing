// Gli script di produzione (db/prod/): il bersaglio che si rifiuta quando
// sembra sviluppo o quando il TLS non verifica, l'ambiente dei figli che
// non legge .env.local, la conferma con --yes, e prod:backup davvero su
// dokkan_test (in una cartella temporanea, con la rotazione delle copie).
//
// Non scrive niente su dokkan_test: legge lo schema e ne fa un dump.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import pg from 'pg'
import { hardenSql } from '../prod/harden.mjs'
import { childEnv, describe, resolveTarget } from '../prod/target.mjs'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
function errore(f: () => unknown): string {
  try { f(); return '' } catch (e) { return e instanceof Error ? e.message : String(e) }
}
const rifiuta = (nome: string, env: Record<string, string>, pezzo: string, allowLocal = false) => {
  const m = errore(() => resolveTarget(env, { allowLocal }))
  check(nome, m.includes(pezzo), m || 'accettato')
}

const TMP = mkdtempSync(join(tmpdir(), 'dokkan-prod-'))
const CA = join(TMP, 'prod-ca.crt')
writeFileSync(CA, '-----BEGIN CERTIFICATE-----\nMIIBfakefakefake\n-----END CERTIFICATE-----\n')
const PW = 's3gretissima'
const REMOTO = `postgres://postgres.abcd:${PW}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

console.log('resolveTarget: i rifiuti')
rifiuta('senza PROD_DATABASE_URL', {}, 'manca PROD_DATABASE_URL')
rifiuta('DATABASE_URL non conta', { DATABASE_URL: REMOTO }, 'manca PROD_DATABASE_URL')
rifiuta('localhost', { PROD_DATABASE_URL: 'postgres://u@localhost:5432/dokkan_prodsim' }, 'host localhost')
rifiuta('127.0.0.1', { PROD_DATABASE_URL: 'postgres://u@127.0.0.1/x' }, 'host 127.0.0.1')
rifiuta('[::1]', { PROD_DATABASE_URL: 'postgres://u@[::1]:5432/x' }, 'sembra sviluppo')
rifiuta('nome _dev anche su host remoto', { PROD_DATABASE_URL: 'postgres://u@db.example.com/dokkan_dev', PROD_DATABASE_CA_CERT: CA }, 'database dokkan_dev')
rifiuta('nome _test', { PROD_DATABASE_URL: 'postgres://u@db.example.com/dokkan_test', PROD_DATABASE_CA_CERT: CA }, 'database dokkan_test')
rifiuta('dokkanteamsharing mai, nemmeno con --allow-local', { PROD_DATABASE_URL: 'postgres://u@localhost/dokkanteamsharing' }, 'non e\' di questo progetto', true)
rifiuta('?host= cambia il bersaglio', { PROD_DATABASE_URL: `${REMOTO}?host=/tmp`, PROD_DATABASE_CA_CERT: CA }, '?host=')
rifiuta('porta 6543 (pooler transaction)', { PROD_DATABASE_URL: REMOTO.replace(':5432', ':6543'), PROD_DATABASE_CA_CERT: CA }, '6543')
rifiuta('remoto senza CA', { PROD_DATABASE_URL: REMOTO }, 'senza CA')
rifiuta('sslmode=require non basta', { PROD_DATABASE_URL: `${REMOTO}?sslmode=require` }, 'senza CA')
rifiuta('CA che non esiste', { PROD_DATABASE_URL: REMOTO, PROD_DATABASE_CA_CERT: join(TMP, 'manca.crt') }, 'non esiste')
rifiuta('protocollo sbagliato', { PROD_DATABASE_URL: 'mysql://u@db.example.com/x' }, 'protocollo')

console.log('resolveTarget: gli accettati')
const t = resolveTarget({ PROD_DATABASE_URL: `${REMOTO}?sslmode=require&sslrootcert=/altro.crt`, PROD_DATABASE_CA_CERT: CA })
const q = new URL(t.url).searchParams
check('sslmode diventa verify-full', q.get('sslmode') === 'verify-full', q.get('sslmode') ?? '')
check('sslrootcert e\' la nostra CA, una volta', q.getAll('sslrootcert').join() === CA)
const d = describe(t.info)
check('la descrizione dice host, db e utente', d.startsWith('aws-0-eu-central-1.pooler.supabase.com:5432/postgres come postgres.abcd'), d)
check('la password non si stampa', !d.includes(PW) && !JSON.stringify(t.info).includes(PW))
// cosa ne fa pg, cioe' gli importer (il Client non si connette qui): la CA
// letta dal file e nessun rejectUnauthorized spento
const params = (new pg.Client({ connectionString: t.url }) as unknown as
  { connectionParameters: { ssl: { ca?: string; rejectUnauthorized?: boolean } | boolean } }).connectionParameters
const ssl = typeof params.ssl === 'object' ? params.ssl : undefined
check('pg legge la CA dal file', ssl?.ca === readFileSync(CA, 'utf8'))
check('pg non spegne la verifica', ssl !== undefined && ssl.rejectUnauthorized !== false, JSON.stringify(ssl?.rejectUnauthorized))
const gia = resolveTarget({ PROD_DATABASE_URL: `${REMOTO}?sslmode=verify-full&sslrootcert=${CA}` })
check('URL con verify-full e sslrootcert va bene anche senza variabile', gia.info.tls.includes(CA))
const sim = resolveTarget({ PROD_DATABASE_URL: 'postgres://u@localhost:5432/dokkan_prodsim' }, { allowLocal: true })
check('--allow-local: la simulazione locale, senza TLS', sim.info.local && sim.info.tls.startsWith('nessuno'))

console.log('childEnv')
const ce = childEnv('postgres://x@h/db', { PGPASSWORD: 'p', PGHOST: 'h2', PGSSLMODE: 'disable', DATABASE_URL: 'dev',
                                             DATABASE_CA_CERT: 'pem', PATH: '/bin', ASSET_DIR: '/a' })
check('DATABASE_URL e\' quello passato', ce.DATABASE_URL === 'postgres://x@h/db')
check('via le PG*', !Object.keys(ce).some((k) => k.startsWith('PG')))
check('via DATABASE_CA_CERT dell\'app', !('DATABASE_CA_CERT' in ce))
check('i file .env spenti', ce.DOKKAN_ENV_FILES === 'off')
check('il resto resta', ce.PATH === '/bin' && ce.ASSET_DIR === '/a')

console.log('db/env.mjs con DOKKAN_ENV_FILES=off')
const probe = "import('./db/env.mjs').then(m => { console.log(JSON.stringify({ url: m.connectionString(), asset: process.env.ASSET_BASE_URL !== undefined })) })"
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PG') && k !== 'DATABASE_URL' && k !== 'ASSET_BASE_URL'))
const nodeRun = (env: Record<string, string | undefined>, args = ['-e', probe]) =>
  spawnSync(process.execPath, args, { env: env as NodeJS.ProcessEnv, encoding: 'utf8' })
const off = nodeRun({ ...base, DOKKAN_ENV_FILES: 'off', DATABASE_URL: 'postgres://x@remote.example/db' })
const offOut = JSON.parse(off.stdout || '{}')
check('usa solo il DATABASE_URL passato', offOut.url === 'postgres://x@remote.example/db')
check('non carica .env.local', offOut.asset === false)
// la controprova: senza la variabile .env.local si legge (se c'e')
const on = JSON.parse(nodeRun({ ...base, DATABASE_URL: 'postgres://x@remote.example/db' }).stdout || '{}')
if (existsSync('.env.local')) check('controprova: normalmente .env.local si legge', on.asset === true)
const offNone = nodeRun({ ...base, DOKKAN_ENV_FILES: 'off', PGDATABASE: 'dokkan_dev' })
check('senza DATABASE_URL si ferma (niente ripiego su PG*)', offNone.status === 1 && !offNone.stdout.includes('dokkan_dev'))

console.log('gli script senza --yes')
const scr = (s: string, env: Record<string, string>, extra: string[] = []) =>
  nodeRun({ ...base, ...env }, [`db/prod/${s}`, ...extra])
for (const s of ['setup.mjs', 'update.mjs', 'backup.mjs']) {
  const r = scr(s, { PROD_DATABASE_URL: REMOTO, PROD_DATABASE_CA_CERT: CA })
  check(`${s}: stampa il bersaglio ed esce 2`, r.status === 2 && r.stdout.includes('pooler.supabase.com:5432/postgres'), `uscita ${r.status}`)
  check(`${s}: senza password nell'output`, !(r.stdout + r.stderr).includes(PW))
}
const loc = scr('setup.mjs', { PROD_DATABASE_URL: 'postgres://u@localhost/dokkan_prodsim' }, ['--yes'])
check('setup su localhost senza --allow-local: rifiutato anche con --yes', loc.status === 1)

const TEST = process.env.TEST_DATABASE_URL
console.log('harden (i ruoli della Data API di Supabase)')
check('i nomi dei ruoli si quotano', hardenSql(['a"b'])[0].endsWith('from "a""b"'))
if (TEST) {
  // anon e authenticated qui non esistono: la sintassi si prova su public,
  // in una transazione annullata
  const c = new pg.Client({ connectionString: TEST })
  await c.connect()
  await c.query('begin')
  const e = await (async () => { try { for (const s of hardenSql(['public'])) await c.query(s); return '' } catch (x) { return String(x) } })()
  await c.query('rollback')
  await c.end()
  check('le revoche sono SQL valido', e === '', e)
}

console.log('prod:backup su dokkan_test')
if (!TEST || !/_test$/.test(new URL(TEST).pathname)) {
  check('TEST_DATABASE_URL di test', false, 'lancialo da npm run db:test')
} else {
  const dir = join(TMP, 'backups')
  const vecchie = Array.from({ length: 9 }, (_, i) => `2020-01-0${i + 1}T00-00-00Z.sql.gz`)
  spawnSync('mkdir', ['-p', dir])
  for (const f of vecchie) writeFileSync(join(dir, f), 'vecchia')
  writeFileSync(join(dir, 'appunti.txt'), 'non e\' una copia')
  const r = scr('backup.mjs', { PROD_DATABASE_URL: TEST, BACKUP_DIR: dir }, ['--yes', '--allow-local'])
  check('pg_dump riuscito', r.status === 0, `uscita ${r.status} ${r.stderr.trim().split('\n').pop() ?? ''}`)
  const rimaste = readdirSync(dir).filter((f) => f.endsWith('.sql.gz')).sort()
  check('restano 8 copie', rimaste.length === 8, String(rimaste.length))
  check('tolte le due piu\' vecchie', !rimaste.includes(vecchie[0]) && !rimaste.includes(vecchie[1]))
  check('gli altri file non si toccano', readdirSync(dir).includes('appunti.txt'))
  const nuova = rimaste.at(-1) ?? ''
  const sql = nuova.startsWith('2020') ? '' : gunzipSync(readFileSync(join(dir, nuova))).toString('utf8')
  check('la copia nuova e\' un dump vero', /CREATE TABLE public\.card \(/.test(sql) && sql.includes('schema_migrations'))
  check('con le estensioni, per un database vuoto', /CREATE EXTENSION IF NOT EXISTS citext/.test(sql) && sql.includes('btree_gist'))
  check('niente file .partial', !readdirSync(dir).some((f) => f.endsWith('.partial')))
}

rmSync(TMP, { recursive: true, force: true })
console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
