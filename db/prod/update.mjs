#!/usr/bin/env node
// L'aggiornamento settimanale: solo l'import, dalle cache locali appena
// riscaricate con npm run db:fetch. Le migrazioni nuove passano da
// prod:setup (che e' rilanciabile), cosi' questo comando non cambia mai
// lo schema per sbaglio. Non scarica niente: le stesse cache danno lo
// stesso risultato nel giro di prova della CI e nell'applicazione vera.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... npm run prod:update -- --yes
//   ... npm run prod:update -- --images-only --yes
//
// --images-only e' il giro giornaliero delle immagini (daily-images.yml):
// solo fetch-assets --offline (PIPELINE_IMAGES), che adotta i file appena
// pubblicati e li collega. Stesso lucchetto, stesso controllo dello schema,
// stesso rinfresco delle pagine; in import_run si chiude con summary.mode
// 'images' e senza commit del datamine, perche' di dati non ne importa:
// last-run.mjs non lo prende per l'ultimo import.
//
// Il giro si registra in import_run (0023): un secondo prod:update, dal
// Mac o dalla CI, mentre questo e' in corso si rifiuta. ASSET_DIR passa
// agli importer: la CI lo punta all'albero delle immagini appena
// pubblicato, cosi' fetch-assets --offline adotta i file nuovi.
//
// Alla fine, se ci sono PROD_SITE_URL e CRON_SECRET, chiede al sito di
// rinfrescare le pagine cambiate (POST /api/revalidate), e solo quelle:
// una fotografia delle tabelle di gioco prima e dopo il giro dice cosa e'
// cambiato (db/prod/rinfresco.mjs). Niente cambiato, niente richiesta; un
// giro delle immagini manda i tag delle carte e degli eventi toccati, un
// giro completo catalog ed events-list. E' un tentativo: se fallisce lo
// dice e basta, i dati sono gia' scritti.
//
// Anche un giro che si ferma a un passo fallito rinfresca, prima di uscire:
// i passi riusciti hanno gia' scritto. Com'e' andato il rinfresco resta in
// import_run.summary.refresh, e se il giro prima non ha chiuso il conto
// (fallito, morto, senza segreto) questo manda tutto anche se non cambia
// niente: le sue fotografie non vedrebbero quello che l'altro ha scritto.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import pg from 'pg'
import { describeInputs } from './inputs.mjs'
import { PIPELINE, PIPELINE_IMAGES, stepNames } from './pipeline.mjs'
import { TUTTO, cambiamenti, daRecuperare, giroPrecedente, legamiAsset, pianoRinfresco, rinfresca, soloImmagini } from './rinfresco.mjs'
import { takeSnapshot } from './snapshot.mjs'
import { ROOT, prepare, runNode } from './target.mjs'

const CI = process.env.GITHUB_ACTIONS === 'true'
const warn = (msg) => console.log(CI ? `::warning::${msg}` : `  attenzione: ${msg}`)

const IMAGES_ONLY = process.argv.includes('--images-only')
const STEPS = IMAGES_ONLY ? PIPELINE_IMAGES : PIPELINE
const { url, env, info } = prepare(IMAGES_ONLY ? 'prod:update --images-only' : 'prod:update', stepNames(STEPS))
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
async function conClient(fn) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}
const sql = (text, params) => conClient(async (c) => (await c.query(text, params)).rows)

// Il rinfresco delle pagine in cache. Mai nel giro di prova (database
// locale): rinfrescherebbe la produzione per dati che li' non ci sono.
const SITE = process.env.PROD_SITE_URL, SECRET = process.env.CRON_SECRET
const RINFRESCO = !info.local && Boolean(SITE && SECRET)

// Le tabelle di gioco, per sapere dopo cosa e' cambiato. Se la fotografia
// non riesce si rinfresca tutto, come prima: meglio una rigenerazione in
// piu' che una pagina vecchia.
async function fotografia() {
  try {
    return await conClient((c) => takeSnapshot(c, { contentOnly: true }))
  } catch (err) {
    warn(`snapshot for the page refresh failed (${err.message}): refreshing everything`)
    return null
  }
}

let runId
try {
  [{ id: runId }] = await sql('select import_run_begin($1, $2) as id', [CI ? 'ci' : 'local', gitSha()])
} catch (err) {
  console.error(`\n  prod:update: ${err.code === 'P0001' ? 'un altro import e\' in corso (import_run), riprova dopo' : err.message}\n`)
  process.exit(1)
}
console.log(`  import_run ${runId} aperto`)
const prima = RINFRESCO ? await fotografia() : null

// Il giro chiuso prima di questo ha lasciato pagine da rinfrescare? Se la
// lettura non riesce si rinfresca tutto, come per la fotografia.
async function daRecuperarePrima() {
  try {
    const p = await conClient((c) => giroPrecedente(c, runId))
    if (!daRecuperare(p)) return false
    console.log(`  il giro ${p.id} (${p.status}) non ha chiuso il rinfresco (${p.refresh ?? 'not recorded'}): questo rinfresca tutto`)
    return true
  } catch (err) {
    warn(`reading the previous import_run failed (${err.message}): refreshing everything`)
    return true
  }
}
const recupera = RINFRESCO ? await daRecuperarePrima() : false

const inputs = describeInputs()
const t0 = Date.now()
async function finish(status, extra) {
  const duration_s = Math.round((Date.now() - t0) / 1000)
  const summary = IMAGES_ONLY
    ? { mode: 'images', steps: STEPS.length, duration_s, ...extra }
    : { mode: 'full', steps: STEPS.length, duration_s,
        wiki_sha: inputs.wiki_sha, wiki_pages: inputs.wiki_pages,
        event_pages: inputs.event_pages, ...extra }
  // un giro delle immagini non ha importato nessun commit: niente date
  const fonti = IMAGES_ONLY ? [null, null, null]
    : [inputs.datamine_commit, inputs.datamine_committed_at, inputs.wiki_fetched_at]
  try {
    await sql('select import_run_end($1, $2, $3, $4, $5, $6)', [runId, status, summary, ...fonti])
  } catch (err) {
    warn(`import_run ${runId} not closed: ${err.message}`)
  }
}

for (const [script, args] of STEPS) {
  console.log(`\n  ---- ${script} ${args.join(' ')}`.trimEnd())
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], { stdio: 'inherit', env, cwd: ROOT })
  if (r.status !== 0) {
    console.error(`\n  ${script} e' fallito (uscita ${r.status ?? r.signal}): mi fermo qui.`)
    console.error('  Gli importer sono idempotenti: sistemato il problema, si rilancia da capo.\n')
    // i passi prima di questo hanno gia' scritto: le loro pagine si rinfrescano ora
    const esito = await revalidate()
    await finish('failed', { failed_step: script, refresh: esito })
    process.exit(1)
  }
}
const refresh = await revalidate()
await finish('ok', { refresh })
console.log(`\n  import_run ${runId} chiuso: ok`)

/**
 * Il rinfresco delle pagine, e come e' andato (summary.refresh di
 * import_run, letto dal giro dopo: rinfresco.mjs daRecuperare). Non lancia
 * mai: le sue letture e le richieste avvisano e basta.
 */
async function revalidate() {
  if (info.local) return 'local'
  if (!RINFRESCO) { console.log('  PROD_SITE_URL o CRON_SECRET assenti: niente rinfresco delle pagine'); return 'off' }
  try {
    return await pianoEInvio()
  } catch (err) {
    warn(`page refresh failed (${err?.message ?? err}): those pages update when their cache revalidates`)
    return 'failed'
  }
}

async function pianoEInvio() {
  const dopo = prima ? await fotografia() : null
  let piano
  if (!prima || !dopo) piano = { tags: TUTTO, motivo: 'no snapshot to compare' }
  else {
    const cambi = cambiamenti(prima, dopo)
    let legami = null
    if (IMAGES_ONLY && soloImmagini(cambi)) {
      try {
        legami = await conClient((c) => legamiAsset(c, { assetKeys: cambi.asset ?? [], cardIds: cambi.card ?? [] }))
      } catch (err) {
        warn(`reading the pages behind the changed images failed (${err.message}): refreshing everything`)
      }
    }
    piano = pianoRinfresco(cambi, { imagesOnly: IMAGES_ONLY, legami, recupera })
  }
  if (!piano.tags.length) { console.log(`  niente da rinfrescare: ${piano.motivo}`); return 'nothing' }
  console.log(`  rinfresco: ${piano.motivo} (${piano.tags.length} tag)`)
  const { inviati, falliti } = await rinfresca({ site: SITE, secret: SECRET, tags: piano.tags, warn })
  return !falliti && inviati === piano.tags.length ? 'sent' : 'failed'
}
console.log('\n  prod:update finito.\n')
