#!/usr/bin/env node
// L'aggiornamento settimanale: solo l'import, dalle cache locali appena
// riscaricate con npm run db:fetch. Le migrazioni nuove passano da
// prod:setup (che e' rilanciabile), cosi' questo comando non cambia mai
// lo schema per sbaglio. Non scarica niente: le stesse cache danno lo
// stesso risultato nel giro di prova della CI e nell'applicazione vera.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:update -- --yes
//
// Il giro si registra in import_run (0023): un secondo prod:update, dal
// Mac o dalla CI, mentre questo e' in corso si rifiuta. ASSET_DIR passa
// agli importer: la CI lo punta all'albero delle immagini appena
// pubblicato, cosi' fetch-assets --offline adotta i file nuovi.
//
// Alla fine, se ci sono PROD_SITE_URL e CRON_SECRET, chiede al sito di
// rinfrescare le pagine dei dati di gioco (POST /api/revalidate). E' un
// tentativo: se fallisce lo dice e basta, i dati sono gia' scritti.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import pg from 'pg'
import { describeInputs } from './inputs.mjs'
import { PIPELINE, stepNames } from './pipeline.mjs'
import { ROOT, prepare, runNode } from './target.mjs'

const CI = process.env.GITHUB_ACTIONS === 'true'
const warn = (msg) => console.log(CI ? `::warning::${msg}` : `  attenzione: ${msg}`)

const { url, env, info } = prepare('prod:update', stepNames(PIPELINE))
// lo schema deve essere gia' quello del codice: un import su uno schema
// vecchio fallirebbe a meta', meglio dirlo prima
runNode('db/prod/check-schema.mjs', [], env)

function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

// Una connessione breve per aprire e una per chiudere: il lucchetto e' la
// riga, non la sessione, e durante l'import non resta niente aperto.
async function sql(text, params) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try { return (await c.query(text, params)).rows } finally { await c.end() }
}

let runId
try {
  [{ id: runId }] = await sql('select import_run_begin($1, $2) as id', [CI ? 'ci' : 'local', gitSha()])
} catch (err) {
  console.error(`\n  prod:update: ${err.code === 'P0001' ? 'un altro import e\' in corso (import_run), riprova dopo' : err.message}\n`)
  process.exit(1)
}
console.log(`  import_run ${runId} aperto`)

const inputs = describeInputs()
const t0 = Date.now()
async function finish(status, extra) {
  const summary = { steps: PIPELINE.length, duration_s: Math.round((Date.now() - t0) / 1000),
                    wiki_sha: inputs.wiki_sha, wiki_pages: inputs.wiki_pages,
                    event_pages: inputs.event_pages, ...extra }
  try {
    await sql('select import_run_end($1, $2, $3, $4, $5, $6)',
      [runId, status, summary, inputs.datamine_commit, inputs.datamine_committed_at, inputs.wiki_fetched_at])
  } catch (err) {
    warn(`import_run ${runId} not closed: ${err.message}`)
  }
}

for (const [script, args] of PIPELINE) {
  console.log(`\n  ---- ${script} ${args.join(' ')}`.trimEnd())
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], { stdio: 'inherit', env, cwd: ROOT })
  if (r.status !== 0) {
    console.error(`\n  ${script} e' fallito (uscita ${r.status ?? r.signal}): mi fermo qui.`)
    console.error('  Gli importer sono idempotenti: sistemato il problema, si rilancia da capo.\n')
    await finish('failed', { failed_step: script })
    process.exit(1)
  }
}
await finish('ok', {})
console.log(`\n  import_run ${runId} chiuso: ok`)

// Il rinfresco delle pagine in cache. Mai nel giro di prova (database
// locale): rinfrescherebbe la produzione per dati che li' non ci sono.
async function revalidate() {
  const site = process.env.PROD_SITE_URL, secret = process.env.CRON_SECRET
  if (info.local) return
  if (!site || !secret) { console.log('  PROD_SITE_URL o CRON_SECRET assenti: niente rinfresco delle pagine'); return }
  let u
  try { u = new URL('/api/revalidate', site) } catch { warn('PROD_SITE_URL is not a valid URL'); return }
  // il segreto non viaggia in chiaro
  if (u.protocol !== 'https:') { warn('PROD_SITE_URL must be https: page refresh skipped'); return }
  try {
    const res = await fetch(u, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['catalog', 'events-list'] }),
    })
    if (res.ok) console.log('  pagine dei dati di gioco rinfrescate')
    else warn(`page refresh answered HTTP ${res.status}: pages update when their cache expires`)
  } catch (err) {
    warn(`page refresh failed (${err.name}): pages update when their cache expires`)
  }
}
await revalidate()
console.log('\n  prod:update finito.\n')
