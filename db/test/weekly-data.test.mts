// L'aggiornamento settimanale (.github/workflows/weekly-data.yml e
// db/prod/*): il confronto fra fotografie e i limiti, i controlli sulle
// sorgenti, il commit del datamine, la scelta delle immagini, il mirror,
// le maschere dei log; poi sul database di test lo snapshot vero, il
// confronto dopo un import che non deve toccare i dati degli utenti,
// migrate --check, import_run, e la forma del workflow.
//
// Crea solo l'utente weeklytest+author@example.invalid (e lo toglie) e un
// database usa e getta <test>_mc_test per migrate --check (e lo cancella).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { allowedRemovals, compare, md, sameChanges } from '../prod/compare.mjs'
import { maskValues } from '../prod/ci-mask.mjs'
import { hasChanged } from '../prod/last-run.mjs'
import { treeGuard, verifyFile, safePath } from '../prod/mirror-assets.mjs'
import { checkDatamine, checkPages } from '../prod/sanity.mjs'
import { TABLES, unclassified } from '../prod/tables.mjs'
import { headersFor, resolveCommit } from '../import/datamine-source.mjs'
import { selectJobs } from '../import/asset-select.mjs'
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
type Step = { name?: string, uses?: string, run?: string, env?: Record<string, string>, with?: Record<string, string> }
type Workflow = { on?: Record<string, unknown>, env?: Record<string, string>, permissions?: Record<string, string>,
                  jobs: { update: { env?: Record<string, string>, permissions?: unknown, steps: Step[] } } }
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

console.log('il workflow')
{
  const text = readFileSync('.github/workflows/weekly-data.yml', 'utf8')
  let wf: Workflow | null = null
  // js-yaml arriva con eslint, non e' una dipendenza nostra: se manca, solo testo
  const YAML_MOD: string = 'js-yaml'
  try { wf = (await import(YAML_MOD)).load(text) } catch { console.log('  (js-yaml non disponibile: solo controlli sul testo)') }
  const on = wf ? Object.keys(wf.on ?? {}) : []
  check('nessun trigger pull_request o pull_request_target', !/^\s*pull_request(_target)?\s*:/m.test(text) && !on.some((k) => k.startsWith('pull_request')))
  check('environment: production', /^\s+environment:\s*production\s*$/m.test(text))
  check('persist-credentials: false', /persist-credentials:\s*false/.test(text))
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1])
  check('ogni uses: fissato a uno sha di 40 caratteri', uses.length >= 5 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), uses.filter((u) => !/@[0-9a-f]{40}$/.test(u)).join(', '))
  check('niente set -x', !/set\s+-[a-z]*x/.test(text))
  check('npm ci --ignore-scripts', /npm ci --ignore-scripts/.test(text))
  check('wrangler a una versione esatta', /wrangler@\d+\.\d+\.\d+ /.test(text))
  if (wf) {
    const job = wf.jobs.update
    check('PROD_DATABASE_URL mai nell\'env del workflow o del job', !('PROD_DATABASE_URL' in (wf.env ?? {})) && !('PROD_DATABASE_URL' in (job.env ?? {})))
    const inSteps = job.steps.filter((s: Step) => String(s.env?.PROD_DATABASE_URL ?? '').includes('secrets.PROD_DATABASE_URL')).length
    check('il secret PROD_DATABASE_URL compare solo nell\'env dei passi', inSteps >= 3 && (text.match(/secrets\.PROD_DATABASE_URL/g) ?? []).length === inSteps, `${inSteps} passi`)
    check('nessun secret dentro uno script run:', !job.steps.some((s: Step) => /\$\{\{\s*secrets\./.test(s.run ?? '')))
    const perms = wf.permissions ?? {}
    check('permessi minimi (contents e actions in lettura)', Object.keys(perms).sort().join() === 'actions,contents' &&
      Object.values(perms).every((v) => v === 'read') && !job.permissions)
    check('il backup si carica solo cifrato', job.steps.filter((s: Step) => String(s.uses ?? '').startsWith('actions/upload-artifact'))
      .every((s: Step) => s.with?.name === 'import-cache' ||
        String(s.with?.path).trim().split('\n').every((p: string) => /\.dump\.age$|\.dump\.extensions\.json$/.test(p.trim()))))
  }
  const al = spawnSync('actionlint', ['.github/workflows/weekly-data.yml'], { encoding: 'utf8' })
  if (al.error) console.log('  (actionlint non installato: salto il lint)')
  else check('actionlint', al.status === 0, (al.stdout + al.stderr).slice(0, 400))
}

await c.end()
await db.end()
console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
