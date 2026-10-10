// L'aggiornamento settimanale (.github/workflows/weekly-data.yml e
// db/prod/*) e il giro giornaliero delle immagini (daily-images.yml): il
// confronto fra fotografie e i limiti, i controlli sulle sorgenti, il
// commit del datamine, la scelta delle immagini, il mirror, le maschere dei
// log; poi sul database di test lo snapshot vero, il confronto dopo un
// import che non deve toccare i dati degli utenti, migrate --check,
// import_run (e i giri delle sole immagini), le immagini che mancano anche
// alle carte senza pagina, la provenienza degli asset (0033), e la forma
// dei due workflow.
//
// Crea solo l'utente weeklytest+author@example.invalid (e lo toglie) e un
// database usa e getta <test>_mc_test per migrate --check (e lo cancella).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { nonAmmessi } from '../prod/cache-check.mjs'
import { allowedRemovals, compare, md, sameChanges } from '../prod/compare.mjs'
import { maskValues } from '../prod/ci-mask.mjs'
import { hasChanged, lastOkRun } from '../prod/last-run.mjs'
import { missingAssets, missingMarkdown } from '../prod/missing-assets.mjs'
import { PIPELINE_IMAGES } from '../prod/pipeline.mjs'
import { treeGuard, verifyFile, safePath } from '../prod/mirror-assets.mjs'
import { checkDatamine, checkPages } from '../prod/sanity.mjs'
import { TABLES, unclassified } from '../prod/tables.mjs'
import { headersFor, resolveCommit } from '../import/datamine-source.mjs'
import { ASSET_ADOTTA_SQL, ASSET_SCARICA_SQL, selectJobs, siMuove } from '../import/asset-select.mjs'
import { takeSnapshot } from '../prod/snapshot.mjs'
import { db } from '@/lib/db'
import { DOMINIO, SUBMIT, dati, guardia, one, payload, utente } from '@/db/test/builder-helpers'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}

const LIMITS = JSON.parse(readFileSync('db/prod/limits.json', 'utf8'))

// --------------------------------------------------- fotografie finte
type Table = { class: string, count?: number, rows?: Record<string, string>, hash?: string }
type Snap = { tables: Record<string, Table>, names: Record<string, Record<string, string>> }
type Row = { table: string, before: number, after: number, added: number, removed: number, changed: number }
type Violation = { table: string, rule: string, bypassable: boolean }
type Result = { ok: boolean, tables: Row[], violations: Violation[], blocking: Violation[], markdown: string }
type Step = { name?: string, id?: string, uses?: string, run?: string, if?: string, env?: Record<string, string>,
              with?: Record<string, string>, 'continue-on-error'?: boolean }
type Job = { env?: Record<string, string>, permissions?: unknown, environment?: string, needs?: string | string[],
             if?: string, concurrency?: { group?: string, 'cancel-in-progress'?: boolean }, steps: Step[] }
type Workflow = { on?: Record<string, unknown>, env?: Record<string, string>, permissions?: Record<string, string>,
                  concurrency?: { group?: string, 'cancel-in-progress'?: boolean }, jobs: Record<string, Job> }
// compare.mjs e' JavaScript: qui il suo risultato con i tipi
const cmp = (...a: Parameters<typeof compare>) => compare(...a) as unknown as Result
const rows = (n: number, from = 0) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(from + i), 'h']))
const content = (r: Record<string, string>) => ({ class: 'content', count: Object.keys(r).length, rows: r })
const user = (count: number, hash: string) => ({ class: 'user', count, hash })
function snap(t: Record<string, Table>, names: Snap['names'] = {}): Snap {
  return { tables: { app_user: user(3, 'aaa'), import_run: { class: 'system' }, ...t }, names }
}
const viol = (r: Result, t: string) => r.violations.filter((v) => v.table === t)

console.log('compare: i limiti')
{
  const a = snap({ card: content(rows(100)), event: content(rows(2000)) })
  const r = cmp(a, structuredClone(a), LIMITS)
  check('fotografie uguali: ok, nessun cambiamento', r.ok && r.tables.every((t: Row) => !t.added && !t.removed && !t.changed))

  const senzaCarta = snap({ card: content(rows(99)), event: content(rows(2000)) })
  check('una carta tolta: violazione', !cmp(a, senzaCarta, LIMITS).ok)
  const bypass = cmp(a, senzaCarta, LIMITS, { allowDeletions: true })
  check('... che allow_deletions scavalca', bypass.ok && viol(bypass, 'card').length === 1)

  const ev = (n: number) => snap({ card: content(rows(100)), event: content(rows(2000 - n)) })
  check('event: 11 tolti su 2000 e\' una violazione', viol(cmp(a, ev(11), LIMITS), 'event').length === 1)
  check('event: 10 tolti su 2000 va bene', cmp(a, ev(10), LIMITS).ok)
  check('i due limiti valgono insieme (il piu\' stretto)', allowedRemovals({ maxRemoved: 10, maxRemovedPct: 1 }, 2000) === 10 &&
    allowedRemovals({ maxRemoved: 10, maxRemovedPct: 1 }, 500) === 5 && allowedRemovals(undefined, 9) === Infinity)

  const m0 = snap({ mission: content(rows(7720)) })
  const ms = (n: number) => snap({ mission: content(rows(7720 - n)) })
  check('mission: 5% tolto e\' una violazione', !cmp(m0, ms(Math.round(7720 * 0.05)), LIMITS).ok)
  check('mission: 3% tolto va bene', cmp(m0, ms(Math.round(7720 * 0.03)), LIMITS).ok)

  const u1 = cmp(a, { ...a, tables: { ...a.tables, app_user: user(4, 'bbb') } }, LIMITS, { allowDeletions: true })
  check('utenti: un conteggio diverso non si scavalca', !u1.ok && u1.blocking[0]?.table === 'app_user')
  const u2 = cmp(a, { ...a, tables: { ...a.tables, app_user: user(3, 'zzz') } }, LIMITS, { allowDeletions: true })
  check('utenti: stesso conteggio, hash diverso: violazione', !u2.ok)
  const u3 = cmp(a, { ...a, tables: { ...a.tables, app_user: user(4, 'bbb') } }, LIMITS, { userTables: 'ignore' })
  check('utenti: ignorati nella verifica dopo (traffico vero)', u3.ok)

  const l0 = snap({ card_link: content(rows(1000)), card_text: content(rows(1000)) })
  const l96 = snap({ card_link: content(rows(960)), card_text: content(rows(1000)) })
  check('card_link al 96%: violazione', viol(cmp(l0, l96, LIMITS), 'card_link').length === 1)
  const t96 = snap({ card_link: content(rows(1000)), card_text: content(rows(960)) })
  check('minTotalPct ("*", tabelle senza limiti propri): al 96% violazione',
    viol(cmp(l0, t96, LIMITS), 'card_text').some((v: Violation) => v.rule.startsWith('total')))
  check('minTotalPct: al 98% no', cmp(l0, snap({ card_link: content(rows(1000)), card_text: content(rows(980)) }), LIMITS).ok)

  const changed = snap({ card: content({ ...rows(100), 5: 'x' }), event: content(rows(2000)) })
  const rc = cmp(a, changed, LIMITS)
  check('una riga cambiata si conta come cambiata', rc.ok && rc.tables.find((t: Row) => t.table === 'card')?.changed === 1)
  check('una tabella system non si confronta', !rc.tables.some((t: Row) => t.table === 'import_run'))
}

console.log('compare: il markdown')
{
  check('md scappa | ` < > [ ]', md('a|b`c<script>[x](y)') === 'a\\|b\\`c&lt;script&gt;\\[x\\](y)', md('a|b`c<script>[x](y)'))
  const before = snap({ card: content(rows(5)) })
  const nomi = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(100 + i), `Goku <script>|${i}`]))
  const after = snap({ card: content({ ...rows(5), ...rows(25, 100) }) }, { card: nomi })
  const r = cmp(before, after, LIMITS)
  check('le carte nuove: 20 nomi e "+5 more"', (r.markdown.match(/^- 1\d\d /gm) ?? []).length === 20 && r.markdown.includes('- +5 more'))
  check('nei nomi niente HTML ne\' tabelle rotte', !r.markdown.includes('<script>') && r.markdown.includes('Goku &lt;script&gt;\\|0'))
  const h = cmp(before, before, LIMITS, { meta: { datamine_commit: 'a'.repeat(40), datamine_committed_at: '2026-10-07', wiki_fetched_at: 'x', dry_run: true } })
  check('intestazione: link al commit del datamine e "Dry run"', h.markdown.includes(`https://github.com/Nicholas1006/dokkan-backend/commit/${'a'.repeat(40)}`) &&
    h.markdown.includes('Dry run: production not touched'))
  const bad = cmp(before, before, LIMITS, { meta: { datamine_commit: 'not-a-sha)](http://evil' } })
  check('un commit che non e\' uno sha non diventa un link', !bad.markdown.includes('evil'))
  const prova = cmp(before, after, LIMITS)
  check('sameChanges: uguali', sameChanges(prova, prova).length === 0)
  check('sameChanges: diversi', sameChanges(prova, cmp(before, before, LIMITS)).length === 1)
}

console.log('tables.mjs')
check('unclassified trova le tabelle nuove', unclassified(['card', 'nuova_tabella', 'app_user']).join() === 'nuova_tabella')
check('le tabelle degli utenti principali sono user', ['app_user', 'clear', 'clear_version', 'tip', 'report', 'auth_session']
  .every((t) => TABLES[t]?.class === 'user'))
check('import_run e schema_migrations sono system', TABLES.import_run?.class === 'system' && TABLES.schema_migrations?.class === 'system')

console.log('sanity.mjs')
check('pagine del wiki: -3% non va', checkPages('wiki cards', 1000, 970).length === 1)
check('pagine del wiki: -1% va bene', checkPages('wiki cards', 1000, 990).length === 0)
check('pagine del wiki: senza cache precedente basta che ci siano', checkPages('w', null, 5).length === 0 &&
  checkPages('w', null, null).length === 1 && checkPages('w', null, 0).length === 1)
check('datamine: un CSV mancante non va', checkDatamine({ cards: 100 }, { cards: undefined }, ['cards']).length === 1)
check('datamine: un CSV a meta\' non va', checkDatamine({ cards: 100 }, { cards: 50 }, ['cards']).length === 1)
check('datamine: al 95% va bene', checkDatamine({ cards: 100 }, { cards: 95 }, ['cards']).length === 0)

console.log('fetch-datamine: il commit e il token')
{
  const calls: { url: string, headers: Record<string, string> }[] = []
  const fake = (status: number, body: unknown) => async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} })
    return { ok: status < 400, status, json: async () => body }
  }
  const sha = 'b'.repeat(40)
  const ok = await resolveCommit(fake(200, [{ sha, commit: { committer: { date: '2026-10-07T15:30:00Z' } } }]), { strict: true, token: 'tok' })
  check('il commit dalla API', ok.commit === sha && ok.committed_at === '2026-10-07T15:30:00Z')
  let msg = ''
  try { await resolveCommit(fake(403, {}), { strict: true }) } catch (e) { msg = (e as Error).message }
  check('--strict: un 403 rifiuta', msg.includes('HTTP 403'), msg)
  const loose = await resolveCommit(fake(403, {}), { strict: false })
  check('senza --strict: commit null (si scarica da HEAD)', loose.commit === null)
  check('il token va all\'API di GitHub', calls[0].headers.Authorization === 'Bearer tok')
  check('mai a raw.githubusercontent.com', !('Authorization' in headersFor('https://raw.githubusercontent.com/x/y/z.csv', 'tok')))
  check('mai a un altro host', !('Authorization' in headersFor('https://api.github.com.evil.example/x', 'tok')))
  check('lo User-Agent dice chi siamo', /^DokkanTeamSharing\/\S+ \(\+https:\/\/github\.com\//.test(headersFor('https://x.example/', undefined)['User-Agent']))
}

console.log('fetch-assets: quali job')
{
  const jobs = [{ keyBase: 'cards/1/thumb' }, { keyBase: 'cards/1/thumb-animated' }, { keyBase: 'cards/2/thumb' }]
  const have = ['cards/1/thumb.webp', 'cards/3/art.webp']
  const m = selectJobs(jobs, have, { missing: true })
  check('--missing: solo i job senza riga', m.todo.map((j) => j.keyBase).join() === 'cards/1/thumb-animated,cards/2/thumb' && m.dropped === 1)
  const o = selectJobs(jobs, have, { offline: true })
  check('--offline: la riga c\'e\', si collega senza file', o.kept.length === 1 && o.kept[0].key === 'cards/1/thumb.webp')
  check('--offline: gli altri seguono la strada solita', o.todo.length === 2)
  check('thumb non prende la riga di thumb-animated', selectJobs([{ keyBase: 'cards/9/thumb' }], ['cards/9/thumb-animated.webp'], { missing: true }).todo.length === 1)
  // Il campo apng del wiki a volte punta a un'immagine ferma
  const head = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))
  check('WebP con ANIM: si muove', siMuove(head('RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x12\x00\x00\x00ANIM')))
  check('WebP VP8 semplice: fermo', !siMuove(head('RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00')))
  check('APNG (acTL) si muove, PNG no', siMuove(head('\x89PNG\r\n\x1a\n....IHDR........acTL')) && !siMuove(head('\x89PNG\r\n\x1a\n....IHDR........IDAT')))
  check('GIF: si muove; altro: no', siMuove(head('GIF89a')) && !siMuove(head('<html>')))
}

console.log('mirror-assets')
{
  const buf = Buffer.from('ciao')
  const sha = '0fb2ac5e3c1d0f0a2b06a3ba0e5c1d3b5f0bd0b0bdbb1c9a40a3dc26ab11c7a1'
  const real = (await import('node:crypto')).createHash('sha256').update(buf).digest('hex')
  check('verifyFile: giusto', verifyFile(buf, { byte_size: 4, checksum: real }) === null)
  check('verifyFile: dimensione sbagliata', (verifyFile(buf, { byte_size: 5, checksum: real }) ?? '').startsWith('size'))
  check('verifyFile: sha256 sbagliato', verifyFile(buf, { byte_size: 4, checksum: sha }) === 'sha256 mismatch')
  check('treeGuard: meno file delle righe, no', treeGuard(6245, 6246) !== null)
  check('treeGuard: almeno quanti le righe e il minimo, si\'', treeGuard(6250, 6246, 6246) === null && treeGuard(6250, 6246, 6300) !== null)
  let fuori = ''
  try { safePath('/tmp/albero', '../etc/passwd') } catch (e) { fuori = (e as Error).message }
  check('una chiave con .. non esce dall\'albero', fuori.includes('non valida'))
}

console.log('maschere dei log')
{
  // Password finte composte a parte, come in prod-scripts.test.mts: un URL
  // intero con la password scritta dentro lo prenderebbero gli scanner di segreti.
  const PW = 'p%40ss-w0rd'
  const PW2 = 'x1234567'
  const m = maskValues(`postgres://postgres.abcdefghijkl:${PW}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`)
  check('password (anche decodificata), utente, host, ref', ['p@ss-w0rd', 'postgres.abcdefghijkl', 'aws-0-eu-central-1.pooler.supabase.com', 'abcdefghijkl']
    .every((v) => m.includes(v)), m.length + ' pezzi')
  check('"postgres" da solo non si maschera', !m.includes('postgres'))
  check('host diretto: il ref', maskValues(`postgres://postgres:${PW2}@db.zyxwvutsrqpo.supabase.co:5432/postgres`).includes('zyxwvutsrqpo'))
}

console.log('la cache di Actions: solo le fonti pubbliche')
{
  // Come la scrivono gli script dell'import, in una cartella temporanea
  const dir = mkdtempSync(join(tmpdir(), 'dts-cache-'))
  try {
    mkdirSync(join(dir, 'datamine'))
    for (const f of ['wiki-cards.json', 'wiki-events.json', 'wiki-items-template.json', 'datamine/_snapshot.json',
                     'datamine/cards.csv', 'datamine/z_battle_stages.csv']) writeFileSync(join(dir, f), '{}')
    check('cache-check: wiki, template, CSV e fotografia del datamine vanno bene', nonAmmessi(dir).length === 0, nonAmmessi(dir).join())
    const cli = (d: string) => spawnSync(process.execPath, ['db/prod/cache-check.mjs', d], { encoding: 'utf8' })
    check('cache-check da riga di comando: esce 0', cli(dir).status === 0, cli(dir).stdout.trim())
    // quello che non deve mai finire in una cache che una fork puo' leggere
    writeFileSync(join(dir, 'prod.dump'), 'NON-PUBBLICO')
    writeFileSync(join(dir, 'datamine', 'cards.csv.partial'), 'x')
    mkdirSync(join(dir, 'backup'))
    writeFileSync(join(dir, 'backup', 'x.json'), 'x')
    mkdirSync(join(dir, 'datamine', 'sub'))
    writeFileSync(join(dir, 'datamine', 'sub', 'a.csv'), 'x')
    symlinkSync(join(dir, 'prod.dump'), join(dir, 'datamine', 'link.csv'))
    symlinkSync(join(dir, 'backup'), join(dir, 'wiki-link'))
    const fuori = nonAmmessi(dir)
    check('cache-check: un dump, un .partial, una cartella in piu\', una sottocartella e i link no',
      fuori.join() === 'backup/,datamine/cards.csv.partial,datamine/link.csv,datamine/sub/,prod.dump,wiki-link', fuori.join())
    const r = cli(dir)
    check('...e da riga di comando esce 1 con i soli nomi, mai il contenuto', r.status === 1 &&
      /^::error::the import cache holds files/m.test(r.stdout) && r.stdout.includes('prod.dump') && !r.stdout.includes('NON-PUBBLICO'),
      r.stdout.trim().slice(0, 200))
    check('...una cache che non c\'e\': esce 1', cli(join(dir, 'manca')).status === 1)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('pipeline delle sole immagini')
check('PIPELINE_IMAGES: solo fetch-assets --offline', JSON.stringify(PIPELINE_IMAGES) === JSON.stringify([['db/import/fetch-assets.mjs', ['--offline']]]))

console.log('last-run: niente di nuovo?')
{
  const inp = { datamine_commit: 'c1', wiki_sha: 'w1' }
  check('nessun giro riuscito: si importa', hasChanged(null, inp).changed)
  check('stesso commit e stesso wiki: no', !hasChanged({ datamine_commit: 'c1', wiki_sha: 'w1' }, inp).changed)
  check('commit nuovo: si', hasChanged({ datamine_commit: 'c0', wiki_sha: 'w1' }, inp).changed)
  check('wiki cambiato: si', hasChanged({ datamine_commit: 'c1', wiki_sha: 'w0' }, inp).changed)
}

// ------------------------------------------------- sul database di test
guardia()
const URL_TEST = process.env.DATABASE_URL as string
const TEST_DB = decodeURIComponent(new URL(URL_TEST).pathname.slice(1))
const c = new pg.Client({ connectionString: URL_TEST })
await c.connect()
const node = (script: string, args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: URL_TEST, ...env }, encoding: 'utf8' })
const EMAIL = `weeklytest+weekly_author${DOMINIO}`

try {
  console.log('snapshot.mjs sul database di test')
  const s1 = await takeSnapshot(c)
  check('nessuna tabella senza classe in tables.mjs', Object.keys(s1.tables).length > 50, `${Object.keys(s1.tables).length} tabelle`)
  check('le carte hanno i nomi inglesi', Object.keys(s1.names.card).length > 1000)
  check('nessun dato degli utenti nella fotografia', !JSON.stringify(s1).includes('@example.invalid') &&
    s1.tables.app_user.rows === undefined && /^[0-9a-f]{32}$/.test(s1.tables.app_user.hash))
  const dry = node('db/import/load-missions.mjs', ['--dry-run'])
  check('load-missions --dry-run gira', dry.status === 0, dry.stderr.slice(-200))
  const s2 = await takeSnapshot(c)
  check('un dry-run non scrive, e lo snapshot e\' deterministico', JSON.stringify(s1.tables) === JSON.stringify(s2.tables))

  await c.query('begin')
  const { rows: [tier] } = await c.query(`
    select id from stage_tier st
    where not exists (select 1 from clear where stage_tier_id = st.id)
      and not exists (select 1 from tip where stage_tier_id = st.id)
    order by id limit 1`)
  await c.query('delete from stage_tier where id = $1', [tier.id])
  const s3 = await takeSnapshot(c, { inTransaction: true })
  await c.query('rollback')
  const r3 = cmp(s1, s3, LIMITS)
  const st = r3.tables.find((t: Row) => t.table === 'stage_tier')
  check('uno stage_tier tolto: removed = 1', st?.removed === 1 && st?.added === 0, JSON.stringify(st))

  console.log('i dati degli utenti dopo un import')
  const d = await dati()
  const autore = await utente('weeklytest', 'weekly_author')
  const clearId = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards))])).id
  check('un clear vero dall\'API di scrittura', !!clearId)
  const u1 = await takeSnapshot(c)
  for (const s of ['load-events', 'load-game-events', 'load-missions']) {
    const r = node(`db/import/${s}.mjs`)
    check(`${s} dalla cache`, r.status === 0, r.stderr.slice(-200))
  }
  const u2 = await takeSnapshot(c)
  const ru = cmp(u1, u2, LIMITS)
  check('tabelle degli utenti identiche dopo l\'import', !ru.violations.some((v: Violation) => !v.bypassable),
    JSON.stringify(ru.violations.filter((v: Violation) => !v.bypassable)))
  check('cmp().ok', ru.ok, JSON.stringify(ru.blocking))
  check('il clear c\'e\' ancora', (await one<{ n: number }>('select count(*)::int as n from clear where id = $1', [clearId])).n === 1)
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
} finally {
  await c.query('rollback').catch(() => {})
  await db.query('delete from app_user where email = $1', [EMAIL])
  check('pulizia: l\'utente di prova non c\'e\' piu\'', (await one<{ n: number }>(
    'select count(*)::int as n from app_user where email = $1', [EMAIL])).n === 0)
}

console.log('migrate --check')
{
  const r = node('db/migrate.mjs', ['--check'])
  check('dopo il reset: esce 0', r.status === 0, `uscita ${r.status}`)
  // un database usa e getta, mai quello di un altro progetto
  const tmp = `${TEST_DB}_mc_test`
  const tmpUrl = Object.assign(new URL(URL_TEST), { pathname: `/${tmp}` }).href
  await c.query(`drop database if exists "${tmp}"`)
  await c.query(`create database "${tmp}"`)
  const t = new pg.Client({ connectionString: tmpUrl })
  try {
    await t.connect()
    const vuoto = node('db/migrate.mjs', ['--check'], { DATABASE_URL: tmpUrl })
    check('database vuoto: esce 4', vuoto.status === 4, `uscita ${vuoto.status}`)
    check('... e in sola lettura non crea schema_migrations',
      (await t.query(`select to_regclass('schema_migrations') is null as ok`)).rows[0].ok)
    const { rows: mig } = await c.query('select version, checksum, duration_ms from schema_migrations order by version')
    await t.query('create table schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now(), duration_ms integer not null)')
    for (const m of mig.slice(0, -1)) await t.query('insert into schema_migrations (version, checksum, duration_ms) values ($1, $2, $3)', [m.version, m.checksum, m.duration_ms])
    const indietro = node('db/migrate.mjs', ['--check'], { DATABASE_URL: tmpUrl })
    check('l\'ultima migrazione tolta: esce 4 e la nomina', indietro.status === 4 && indietro.stdout.includes(mig.at(-1).version), `uscita ${indietro.status}`)
    await t.query(`update schema_migrations set checksum = 'cambiato' where version = $1`, [mig[0].version])
    const cambiata = node('db/migrate.mjs', ['--check'], { DATABASE_URL: tmpUrl })
    check('un file applicato e cambiato: esce 1', cambiata.status === 1, `uscita ${cambiata.status}`)
  } finally {
    await t.end().catch(() => {})
    await c.query(`drop database if exists "${tmp}"`)
  }
}

console.log('import_run (0023)')
{
  const code = async (sql: string, params: unknown[] = []) => {
    await c.query('savepoint s')
    try { await c.query(sql, params); await c.query('release savepoint s'); return 'ok' }
    catch (e) { await c.query('rollback to savepoint s'); return (e as { code?: string }).code ?? 'errore' }
  }
  await c.query('begin')
  try {
    // un giro rimasto aperto da prima non deve falsare la prova
    await c.query(`update import_run set status = 'failed', finished_at = now() where status = 'running'`)
    const id1 = (await c.query(`select import_run_begin('local', 'sha1') as id`)).rows[0].id
    check('il primo giro si apre', !!id1)
    check('il secondo, mentre il primo e\' in corso: P0001', await code(`select import_run_begin('ci', null)`) === 'P0001')
    await c.query(`update import_run set started_at = now() - interval '3 hours' where id = $1`, [id1])
    const id2 = (await c.query(`select import_run_begin('ci', 'sha2') as id`)).rows[0].id
    const vecchio = (await c.query('select status, summary->>\'reason\' as reason, finished_at from import_run where id = $1', [id1])).rows[0]
    check('dopo 2 ore il giro vecchio si chiude come stale', vecchio.status === 'failed' && vecchio.reason === 'stale' && !!vecchio.finished_at)
    await c.query(`select import_run_end($1, 'ok', '{"steps": 9}', 'c'||repeat('0', 39), now(), now())`, [id2])
    const nuovo = (await c.query('select status, finished_at, datamine_commit, summary from import_run where id = $1', [id2])).rows[0]
    check('end: stato, fine, commit e riepilogo', nuovo.status === 'ok' && !!nuovo.finished_at && nuovo.datamine_commit.length === 40 && nuovo.summary.steps === 9)
    check('end due volte: P0002', await code(`select import_run_end($1, 'ok', '{}', null, null, null)`, [id2]) === 'P0002')
    check('uno stato inventato si rifiuta', await code(`select import_run_end($1, 'boh', '{}', null, null, null)`, [id2]) === '22023')
  } finally { await c.query('rollback') }
}

console.log('import_run: i giri delle sole immagini')
{
  await c.query('begin')
  try {
    // nel futuro, cosi' sono loro le ultime qualunque cosa ci sia gia'
    await c.query(`insert into import_run (source, status, finished_at, datamine_commit, summary) values
      ('ci', 'ok', now() + interval '1 day', 'c'||repeat('1', 39), '{"mode": "full", "wiki_sha": "w1"}'),
      ('ci', 'ok', now() + interval '2 days', null, '{"mode": "images"}'),
      ('ci', 'failed', now() + interval '3 days', 'c'||repeat('3', 39), '{"mode": "full"}')`)
    const l1 = await lastOkRun(c)
    check('un giro delle sole immagini piu\' recente non e\' "l\'ultimo import"', l1?.datamine_commit === 'c' + '1'.repeat(39) && l1?.wiki_sha === 'w1',
      JSON.stringify(l1))
    await c.query(`insert into import_run (source, status, finished_at, datamine_commit, summary)
      values ('local', 'ok', now() + interval '4 days', 'c'||repeat('4', 39), '{"steps": 9}')`)
    check('un giro di prima di summary.mode conta come completo', (await lastOkRun(c))?.datamine_commit === 'c' + '4'.repeat(39))
  } finally { await c.query('rollback') }
}

console.log('immagini mancanti, anche senza pagina wiki')
{
  const m = await missingAssets(c)
  const senza = m.cards.filter((x: { no_page: boolean }) => x.no_page)
  const una = m.cards.find((x: { id: string }) => x.id === '1034030')
  check('una carta solo del datamine (1034030) e\' fra le mancanti, senza pagina', una?.no_page === true &&
    JSON.stringify(una?.missing) === '["thumb","art"]', JSON.stringify(una))
  check('pending le conta', m.pending === m.cards.length + m.events.length && senza.length > 0 && senza.length === m.cards_without_wiki,
    `${senza.length} senza pagina, ${m.cards_without_wiki} in tutto`)
  const mdText = missingMarkdown(m, { plan: { jobs: [{ keyBase: 'cards/1034030/thumb', size: 30000 }], missing_quiet: 12, api_challenged: false } })
  check('il riepilogo: una riga per le carte senza pagina, e il piano', mdText.includes(`${senza.length} cards without a wiki page`) &&
    !mdText.includes('card 1034030 ') && /Plan: 1 files on the wiki to fetch/.test(mdText) && mdText.includes('12 not on the wiki yet'))
  const loc = node('db/prod/missing-assets.mjs', ['--prod'], { PROD_DATABASE_URL: URL_TEST })
  check('missing-assets --prod rifiuta un database locale senza --allow-local', loc.status === 1 && /sviluppo/.test(loc.stderr), `uscita ${loc.status}`)
  const ok = node('db/prod/missing-assets.mjs', ['--prod', '--allow-local'], { PROD_DATABASE_URL: URL_TEST })
  check('...e con --allow-local legge e basta', ok.status === 0 && /immagini mancanti/.test(ok.stdout), ok.stderr.slice(-200))
}

console.log('provenienza degli asset (0033)')
{
  const errore = async (sql: string, params: unknown[] = []) => {
    await c.query('savepoint s')
    try { await c.query(sql, params); await c.query('release savepoint s'); return 'ok' }
    catch (e) {
      await c.query('rollback to savepoint s')
      const x = e as { code?: string, constraint?: string }
      return `${x.code ?? 'errore'}${x.constraint ? ' ' + x.constraint : ''}`
    }
  }
  const WIKI = 'https://static.wikia.nocookie.net/dbz-dokkanbattle/images/a/ab/Card_1_thumb.png/revision/latest'
  const riga = (key: string, source: string | null, url: string | null) => [key, 'card_thumb', 'image/webp', 1, 1, 1, 'x', source, url]
  await c.query('begin')
  try {
    check('una riga senza source: rifiutata (not null)', await errore(`insert into asset (key, kind, content_type, byte_size, checksum)
      values ('test/p0.webp', 'card_thumb', 'image/webp', 1, 'x')`) === '23502')
    check('source "game": rifiutata da asset_source', await errore(ASSET_SCARICA_SQL, riga('test/p1.webp', 'game', null)) === '23514 asset_source')
    check('un source_url del wiki su un altro host: rifiutato', await errore(ASSET_SCARICA_SQL, riga('test/p2.webp', 'wiki', 'https://evil.example/x.png')) ===
      '23514 asset_source_url_wiki')
    check('...anche http', await errore(ASSET_SCARICA_SQL, riga('test/p2.webp', 'wiki', WIKI.replace('https:', 'http:'))) === '23514 asset_source_url_wiki')
    check('un download con l\'URL del wiki: va', await errore(ASSET_SCARICA_SQL, riga('test/p3.webp', 'wiki', WIKI)) === 'ok')
    check('vignette, il nome vecchio della CDN, va', await errore(ASSET_SCARICA_SQL,
      riga('test/p4.webp', 'wiki', WIKI.replace('static.', 'vignette.'))) === 'ok')
    await c.query(ASSET_ADOTTA_SQL, riga('test/p3.webp', 'wiki', null))
    const dopo = (await c.query(`select source, source_url from asset where key = 'test/p3.webp'`)).rows[0]
    check('una riadozione senza URL tiene quello che c\'era', dopo?.source === 'wiki' && dopo?.source_url === WIKI, JSON.stringify(dopo))
    await c.query(ASSET_SCARICA_SQL, riga('test/p3.webp', 'wiki', WIKI + '2'))
    check('un nuovo download lo sostituisce', (await c.query(`select source_url from asset where key = 'test/p3.webp'`)).rows[0]?.source_url === WIKI + '2')
  } finally { await c.query('rollback') }
  check('ogni riga di asset dopo l\'import ha source wiki', Number((await c.query(`select count(*) from asset where source is distinct from 'wiki'`)).rows[0].count) === 0)
}

console.log('i workflow')
{
  // js-yaml arriva con eslint, non e' una dipendenza nostra: se manca, solo testo
  const YAML_MOD: string = 'js-yaml'
  let load: ((t: string) => unknown) | null = null
  try { load = (await import(YAML_MOD)).load } catch { console.log('  (js-yaml non disponibile: solo controlli sul testo)') }
  const WEEKLY = '.github/workflows/weekly-data.yml', DAILY = '.github/workflows/daily-images.yml'
  const JOBS: Record<string, string[]> = { [WEEKLY]: ['update'], [DAILY]: ['gate', 'images'] }
  // I permessi del GITHUB_TOKEN job per job: quelli del job se li scrive
  // (e allora valgono solo quelli), altrimenti quelli del workflow.
  // actions: read solo a chi chiama gh run: il settimanale, un job solo,
  // per l'artifact di riserva; nel giornaliero il solo cancello, che non
  // ha secret. Il job delle immagini, con i secret, ha solo contents.
  const PERMESSI: Record<string, Record<string, Record<string, string>>> = {
    [WEEKLY]: { update: { actions: 'read', contents: 'read' } },
    [DAILY]: { gate: { actions: 'read' }, images: { contents: 'read' } },
  }
  const ordinati = (p: Record<string, string>) => JSON.stringify(Object.entries(p).sort(([a], [b]) => a.localeCompare(b)))
  const testi: Record<string, string> = {}
  const flussi: Record<string, Workflow | null> = {}
  const passi = (wf: Workflow) => Object.values(wf.jobs).flatMap((j) => j.steps ?? [])
  for (const [file, jobs] of Object.entries(JOBS)) {
    const n = file.split('/').pop()
    const text = readFileSync(file, 'utf8')
    testi[file] = text
    const wf = load ? load(text) as Workflow : null
    flussi[file] = wf
    const on = wf ? Object.keys(wf.on ?? {}) : []
    check(`${n}: nessun trigger pull_request o pull_request_target`, !/^\s*pull_request(_target)?\s*:/m.test(text) && !on.some((k) => k.startsWith('pull_request')))
    check(`${n}: environment: production`, /^\s+environment:\s*production\s*$/m.test(text))
    check(`${n}: persist-credentials: false`, /persist-credentials:\s*false/.test(text))
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1])
    check(`${n}: ogni uses: fissato a uno sha di 40 caratteri`, uses.length >= 4 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), uses.filter((u) => !/@[0-9a-f]{40}$/.test(u)).join(', '))
    check(`${n}: niente set -x`, !/set\s+-[a-z]*x/.test(text))
    check(`${n}: npm ci --ignore-scripts`, /npm ci --ignore-scripts/.test(text))
    check(`${n}: wrangler a una versione esatta`, /wrangler@\d+\.\d+\.\d+ /.test(text) && !/wrangler(@latest)?\s+pages/.test(text))
    if (wf) {
      check(`${n}: i job sono ${jobs.join(', ')}`, Object.keys(wf.jobs).sort().join() === [...jobs].sort().join())
      const steps = passi(wf)
      check(`${n}: PROD_DATABASE_URL mai nell'env del workflow o di un job`, !('PROD_DATABASE_URL' in (wf.env ?? {})) &&
        Object.values(wf.jobs).every((j) => !('PROD_DATABASE_URL' in (j.env ?? {}))))
      const inSteps = steps.filter((s: Step) => String(s.env?.PROD_DATABASE_URL ?? '').includes('secrets.PROD_DATABASE_URL')).length
      check(`${n}: il secret PROD_DATABASE_URL compare solo nell'env dei passi`, inSteps >= 3 && (text.match(/secrets\.PROD_DATABASE_URL/g) ?? []).length === inSteps, `${inSteps} passi`)
      const ops = steps.filter((s: Step) => String(s.env?.OPS_ARCHIVE_TOKEN ?? '').includes('secrets.OPS_ARCHIVE_TOKEN')).length
      check(`${n}: OPS_ARCHIVE_TOKEN solo nell'env dei passi`, (text.match(/secrets\.OPS_ARCHIVE_TOKEN/g) ?? []).length === ops, `${ops} passi`)
      check(`${n}: nessun secret dentro uno script run:`, !steps.some((s: Step) => /\$\{\{\s*secrets\./.test(s.run ?? '')))
      const effettivi = Object.entries(wf.jobs).map(([nome, j]) =>
        `${nome}=${ordinati((j.permissions as Record<string, string> | undefined) ?? wf.permissions ?? {})}`)
      const attesi = Object.entries(PERMESSI[file]).map(([nome, p]) => `${nome}=${ordinati(p)}`)
      check(`${n}: permessi minimi, job per job`, effettivi.sort().join(' ') === attesi.sort().join(' '), effettivi.join(' '))
      if (Object.keys(wf.jobs).length > 1) {
        // con piu' job, chi legge secret non ha actions: read
        const conActions = Object.entries(wf.jobs).filter(([, j]) => JSON.stringify(j).includes('secrets.') &&
          'actions' in ((j.permissions as Record<string, string> | undefined) ?? wf.permissions ?? {})).map(([nome]) => nome)
        check(`${n}: nessun job con secret ha actions: read`, conActions.length === 0, conActions.join())
      }
      for (const [nome, j] of Object.entries(wf.jobs)) {
        if (JSON.stringify(j).includes('secrets.')) check(`${n}: il job ${nome} legge secret, quindi environment production`, j.environment === 'production')
      }
      check(`${n}: si carica solo la cache dell'import o il backup cifrato`, steps.filter((s: Step) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
        .every((s: Step) => s.with?.name === 'import-cache' ||
          String(s.with?.path).trim().split('\n').every((p: string) => /\.dump\.age$|\.dump\.extensions\.json$/.test(p.trim()))))
      for (const [nome, j] of Object.entries(wf.jobs)) {
        const deploy = j.steps.findIndex((s) => /wrangler@/.test(s.run ?? ''))
        if (deploy < 0) continue
        const guardia = j.steps.findIndex((s) => /db\/prod\/storage\.mjs[^\n]*--tree[^\n]*--guard/.test(s.run ?? ''))
        check(`${n}: nel job ${nome} la guardia dello spazio viene prima del deploy`, guardia >= 0 && guardia < deploy &&
          j.steps[guardia].if === j.steps[deploy].if, `guardia ${guardia}, deploy ${deploy}`)
      }
      const fresh = steps.find((s) => /db\/prod\/freshness\.mjs/.test(s.run ?? ''))
      check(`${n}: le fonti fresche non fermano mai il giro`, fresh?.['continue-on-error'] === true && !!fresh?.env?.GITHUB_TOKEN)
    }
    const al = spawnSync('actionlint', [file], { encoding: 'utf8' })
    if (al.error) console.log(`  (actionlint non installato: salto il lint di ${n})`)
    else check(`${n}: actionlint`, al.status === 0, (al.stdout + al.stderr).slice(0, 400))
  }

  // Un passo run: del workflow, eseguito qui con bash: GITHUB_ENV e il
  // riepilogo in una cartella temporanea
  const tmp = mkdtempSync(join(tmpdir(), 'dts-wf-'))
  const esegui = (run: string, env: Record<string, string>) => {
    const ge = join(tmp, `env-${Math.random().toString(36).slice(2)}`)
    const vars: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: process.env.HOME,
      GITHUB_ENV: ge, GITHUB_STEP_SUMMARY: join(tmp, 'summary.md'), RUNNER_TEMP: tmp, ...env }
    const r = spawnSync('bash', ['-c', run], { encoding: 'utf8', env: vars as NodeJS.ProcessEnv })
    let out = ''
    try { out = readFileSync(ge, 'utf8') } catch { /* nessuna riga */ }
    return { status: r.status, env: out }
  }
  try {
    const w = flussi[WEEKLY], d = flussi[DAILY]
    if (w && d) {
      const wsteps = w.jobs.update.steps
      const passo = (steps: Step[], name: string) => steps.find((s) => s.name === name)
      // il datamine che non arriva
      const dm = passo(wsteps, 'Fetch the datamine'), fb = passo(wsteps, 'Datamine fallback')
      check('weekly: il fetch del datamine puo\' fallire, e allora c\'e\' il ripiego', dm?.['continue-on-error'] === true &&
        fb?.if === "steps.datamine.outcome != 'success'" && wsteps.indexOf(fb!) === wsteps.indexOf(dm!) + 1)
      // La cache di Actions non e' privata (un giro pull_request, anche di
      // una fork, la ripristina): solo fonti pubbliche, controllate prima
      const guardiaCache = passo(wsteps, 'Check the import cache holds only public sources')
      const salva = passo(wsteps, 'Save the import cache'), carica = passo(wsteps, 'Upload the import cache')
      check('weekly: prima di salvare, cache-check.mjs guarda che la cache tenga solo le fonti pubbliche',
        guardiaCache?.id === 'cache-check' && guardiaCache.run?.trim() === 'node db/prod/cache-check.mjs' &&
        guardiaCache.if === "always() && steps.datamine.outcome == 'success'" && !guardiaCache['continue-on-error'] &&
        wsteps.indexOf(guardiaCache) < wsteps.indexOf(salva!) && wsteps.indexOf(guardiaCache) < wsteps.indexOf(carica!))
      check('weekly: la cache si salva e si carica solo da un datamine arrivato davvero, e solo dopo la guardia',
        [salva, carica].every((s) => s?.if === "always() && steps.datamine.outcome == 'success' && steps.cache-check.outcome == 'success'"))
      const salvataggi = [...passi(w), ...passi(d)].filter((s) => /^actions\/cache(\/save)?@/.test(String(s.uses ?? '')))
      check('nei due workflow si salva solo db/import/.cache, e una volta sola', salvataggi.length === 1 &&
        salvataggi[0] === salva && String(salva?.with?.path).trim() === 'db/import/.cache', salvataggi.map((s) => s.name).join())
      const nodeCache = [...passi(w), ...passi(d)].filter((s) => String(s.uses ?? '').startsWith('actions/setup-node@'))
      check('...e l\'altra cache e\' quella di npm (pacchetti pubblici)', nodeCache.length === 2 &&
        nodeCache.every((s) => !s.with?.cache || s.with.cache === 'npm'))
      const arch = passo(wsteps, 'Archive the datamine snapshot')
      check('weekly: l\'archivio del datamine e\' facoltativo e non ferma il giro', arch?.['continue-on-error'] === true &&
        /datamine-archive\.mjs push/.test(arch?.run ?? ''))
      // solo una fotografia buona diventa LATEST.json: arrivata intera,
      // passata dal controllo delle sorgenti e, se nuova, dal giro di prova
      const sanity = passo(wsteps, 'Sanity check of the sources'), cmp = passo(wsteps, 'Compare and enforce the limits')
      const archIf = String(arch?.if ?? '').replace(/\s+/g, ' ').trim()
      check('weekly: l\'archivio solo dopo il controllo delle sorgenti e il giro di prova coi limiti',
        sanity?.id === 'sanity' && cmp?.id === 'compare' && archIf ===
          "always() && steps.datamine.outcome == 'success' && steps.sanity.outcome == 'success' " +
          "&& (env.GO == 'false' || (env.GO == 'true' && steps.compare.outcome == 'success'))", archIf)
      check('...e dopo di loro', wsteps.indexOf(arch!) > wsteps.indexOf(cmp!) && wsteps.indexOf(cmp!) > wsteps.indexOf(sanity!))
      // l'artifact pubblico non porta i CSV del datamine
      const up = passo(wsteps, 'Upload the import cache')
      const upPath = String(up?.with?.path ?? '').trim().split('\n').map((x: string) => x.trim())
      check('weekly: l\'artifact import-cache tiene fuori db/import/.cache/datamine', upPath[0] === 'db/import/.cache' &&
        upPath.includes('!db/import/.cache/datamine') && upPath.includes('!db/import/.cache/datamine/**'), upPath.join(' '))
      // lo spazio nel riepilogo anche quando le immagini non girano
      const sto = passo(wsteps, 'Storage summary')
      check('weekly: "Storage summary" sempre, in sola lettura, senza fermare il giro', sto?.if === '${{ !cancelled() }}' &&
        sto?.['continue-on-error'] === true && /storage\.mjs --prod --out/.test(sto?.run ?? '') &&
        /-s "\$RUNNER_TEMP\/storage\.md"/.test(sto?.run ?? '') && !/--guard|--tree/.test(sto?.run ?? '') &&
        wsteps.indexOf(sto!) < wsteps.indexOf(passo(wsteps, 'Needs attention')!) &&
        wsteps.indexOf(sto!) > wsteps.indexOf(passo(wsteps, 'Images summary')!))
      const decide = passo(wsteps, 'Decide')?.run ?? ''
      const go = (env: Record<string, string>) => esegui(decide, env).env
      check('weekly Decide: col ripiego del datamine GO=false, anche con force e commit nuovo',
        /GO=false/.test(go({ DATAMINE_MODE: 'fallback', CHANGED: 'true', FORCE: 'true' })) &&
        !/GO=true/.test(go({ DATAMINE_MODE: 'fallback', CHANGED: 'true', FORCE: 'true' })))
      check('weekly Decide: senza ripiego, un commit nuovo da\' GO=true', /GO=true/.test(go({ CHANGED: 'true', FORCE: 'false' })))

      const gate = d.jobs.gate, img = d.jobs.images
      check('daily: il cancello non ha environment ne\' secret', !gate.environment && !JSON.stringify(gate).includes('secrets.'))
      check('daily: le immagini aspettano il cancello', img.needs === 'gate' && /needs\.gate\.outputs\.busy != 'true'/.test(img.if ?? ''))
      check('daily: stesso gruppo di concorrenza del settimanale, senza cancellare',
        img.concurrency?.group === 'prod-data' && img.concurrency?.['cancel-in-progress'] === false &&
        w.concurrency?.group === 'prod-data' && w.concurrency?.['cancel-in-progress'] === false)
      check('daily: APPLY e\' la stessa espressione del settimanale', !!img.env?.APPLY && img.env?.APPLY === w.jobs.update.env?.APPLY)
      const giorni = (cron: string) => {
        const out = new Set<number>()
        for (const part of cron.trim().split(/\s+/)[4].split(',')) {
          if (part === '*') { for (let i = 0; i < 7; i++) out.add(i); continue }
          const [a, b] = part.split('-').map(Number)
          for (let i = a; i <= (b ?? a); i++) out.add(i % 7)
        }
        return out
      }
      const crons = (d.on?.schedule as { cron: string }[] | undefined) ?? []
      check('daily: mai il venerdi\' (c\'e\' il settimanale)', crons.length > 0 && crons.every((x) => !giorni(x.cron).has(5) && giorni(x.cron).size === 6),
        crons.map((x) => x.cron).join())
      const dtext = testi[DAILY]
      check('daily: non scarica mai wiki, eventi o datamine', !/fetch-(wiki|events|datamine)\.mjs/.test(dtext))
      const dsteps = passi(d)
      check('daily: non salva mai la cache', !dsteps.some((s) => String(s.uses ?? '').startsWith('actions/cache/save')))
      check('daily: niente artifact di riserva (quello del settimanale non ha il datamine)', !/gh run download/.test(dtext))
      check('daily: carica solo il backup cifrato', dsteps.filter((s) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
        .every((s) => String(s.with?.path).trim().split('\n').every((p: string) => /\.dump\.age$|\.dump\.extensions\.json$/.test(p.trim()))))
      const upd = [...dtext.matchAll(/update\.mjs[^\n]*/g)].map((m) => m[0])
      check('daily: ogni update.mjs e\' --images-only', upd.length > 0 && upd.every((x) => x.includes('--images-only')), upd.join(' | '))
      const scrive = dsteps.filter((s) => /wrangler@|update\.mjs|dump\.mjs|fetch-assets\.mjs --missing --report/.test(s.run ?? ''))
      check('daily: backup, download, deploy e applicazione solo con APPLY', scrive.length >= 4 &&
        scrive.every((s) => (s.if ?? '').includes("env.APPLY == 'true'")), scrive.map((s) => s.name).join(', '))
      check('daily: il piano legge la produzione in sola lettura', /missing-assets\.mjs --prod[^\n]*/.test(dtext) &&
        dsteps.some((s) => /--plan/.test(s.run ?? '') && !!s.env?.PROD_DATABASE_URL))
      const ddecide = dsteps.find((s) => s.name === 'Decide')?.run ?? ''
      const dry = esegui(ddecide, { APPLY: 'false', FETCHABLE: '3', FETCHABLE_BYTES: '2500000', MISSING: '12', CHALLENGED: '0' }).env
      check('daily Decide: senza APPLY e\' una prova, e dice cosa scaricherebbe', /GO=false/.test(dry) &&
        /DRY_LINE=Dry run: would fetch 3 files \(up to 2\.5 MB\); 12 not on the wiki yet/.test(dry), dry.trim())
      check('daily Decide: con APPLY e niente da scaricare, GO=false',
        /GO=false/.test(esegui(ddecide, { APPLY: 'true', FETCHABLE: '0', FETCHABLE_BYTES: '0', MISSING: '12', CHALLENGED: '0' }).env))
      check('daily Decide: con APPLY e qualcosa da scaricare, GO=true',
        /GO=true/.test(esegui(ddecide, { APPLY: 'true', FETCHABLE: '2', FETCHABLE_BYTES: '9', MISSING: '0', CHALLENGED: '0' }).env))
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

await c.end()
await db.end()
console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
