// Verifica i dati della pagina della carta (migrazione 0022): i vincoli di
// card_skill, set_prefers_animated, e le skill che load-cards scrive dalla
// cache vera del wiki (testi puliti, EZA, note con nome, idempotenza).
//
// Gira sul database di test (npm run db:test), dopo gli import. Rilancia
// load-cards, poi load-game-cards e load-datamine come fa run.sh, perche'
// load-datamine ricostruisce link e categorie di tutte le carte. Crea solo
// gli utenti cardpagetest+...@example.invalid e la carta finta 1999990, e
// li toglie alla fine.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { skillsFromPage } from '../import/wiki-skills.mjs'
import { DOMINIO, check, esito, guardia, num, one, q, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'cardpagetest'
const FINTA = 1999990
const CACHE = new URL('../import/.cache/wiki-cards.json', import.meta.url)

async function vincoli() {
  console.log('\n  -- card_skill: vincoli')
  await db.query(`insert into card (id, type, class, rarity) values ($1, 'AGL', 'Super', 'SSR')`, [FINTA])
  const ins = (cols: string, vals: string) =>
    esito(`insert into card_skill (card_id, locale, kind, ${cols}) values (${FINTA}, 'en', 'leader', ${vals})`)
  check('una riga valida entra', await ins('description', "'Ki +3'") === 'ok')
  check('descrizione vuota: no', await ins('tier, description', "'eza', '  '") === '23514 card_skill_description')
  check('descrizione mancante: no', (await ins('tier, name', "'eza', 'x'")).startsWith('23502'))
  check('nome vuoto: no', await ins('tier, name, description', "'eza', ' ', 'x'") === '23514 card_skill_name')
  check('condizione vuota: no', await ins('tier, condition, description', "'eza', '', 'x'") === '23514 card_skill_condition')
  check('seq 0: no', await ins('seq, description', "0, 'x'") === '23514 card_skill_seq')
  check('seq 10: no', await ins('seq, description', "10, 'x'") === '23514 card_skill_seq')
  check('stessa (carta, lingua, tipo, livello, seq): no', await ins('description', "'doppia'") === '23505 card_skill_pkey')
  check('un tipo che non esiste: no', (await esito(
    `insert into card_skill (card_id, locale, kind, description) values (${FINTA}, 'en', 'nope', 'x')`)).startsWith('22P02'))
  const d = await one<{ details: string[]; tier: string; seq: number; source: string }>(
    `select details, tier::text, seq, source::text from card_skill where card_id = $1`, [FINTA])
  check('di base: livello base, seq 1, dettagli vuoti, fonte official',
    d?.tier === 'base' && d?.seq === 1 && Array.isArray(d?.details) && d.details.length === 0 && d?.source === 'official',
    JSON.stringify(d))
  await db.query('delete from card where id = $1', [FINTA])
  check('cancellare la carta porta via le sue skill',
    await num('select count(*) from card_skill where card_id = $1', [FINTA]) === 0)
}

async function preferenza() {
  console.log('\n  -- set_prefers_animated')
  const a = await utente(P, 'cardpage_a')
  const b = await utente(P, 'cardpage_b')
  const nuovo = await utente(P, 'cardpage_new', false)
  const val = async (id: string) =>
    (await one<{ v: boolean }>('select prefers_animated as v from app_user where id = $1', [id]))?.v
  const r = await one<{ v: boolean }>('select set_prefers_animated($1, true) as v', [a])
  check('torna il valore salvato', r?.v === true)
  check('cambia quell\'utente', await val(a) === true)
  check('...e solo lui', await val(b) === false)
  check('una seconda volta va bene uguale', await esito('select set_prefers_animated($1, true)', [a]) === 'ok' &&
    await val(a) === true)
  check('si torna allo statico', await esito('select set_prefers_animated($1, false)', [a]) === 'ok' &&
    await val(a) === false)
  // ogni rifiuto deve avere il suo vincolo: uno senza nome non si
  // tradurrebbe in un messaggio per l'utente
  const atteso = new Set(['P0002 user_not_found', '23514 prefers_animated_missing'])
  const rifiuti: [string, string, unknown[]][] = [
    ['un uuid sconosciuto', 'P0002 user_not_found', ['00000000-0000-0000-0000-000000000000', true]],
    ['un utente senza onboarding', 'P0002 user_not_found', [nuovo, true]],
    ['un valore null', '23514 prefers_animated_missing', [a, null]],
  ]
  for (const [nome, vuole, args] of rifiuti) {
    const got = await esito('select set_prefers_animated($1, $2)', args)
    check(`${nome}: ${vuole}`, got === vuole && atteso.has(got), got)
  }
  check('l\'utente senza onboarding non e\' cambiato', await val(nuovo) === false)
}

const importa = (nome: string) =>
  execFileSync(process.execPath, [new URL(`../import/${nome}`, import.meta.url).pathname],
    { env: { ...process.env }, encoding: 'utf8' })

type Riga = { kind: string; tier: string; seq: number; details: string[]; condition: string | null }

async function importate() {
  console.log('\n  -- le skill importate dalla cache vera')
  const { pages } = JSON.parse(readFileSync(CACHE, 'utf8')) as { pages: { title: string; wikitext: string }[] }
  const perTitolo = new Map(pages.map((p) => [p.title, p.wikitext]))
  const carte = await q<{ id: string; wiki_title: string }>(
    'select id::text, wiki_title from card where wiki_title is not null')
  const attese = carte.map((c) => ({ id: c.id, rows: skillsFromPage(perTitolo.get(c.wiki_title) ?? '') as Riga[] }))
  const totale = attese.reduce((n, c) => n + c.rows.length, 0)
  const righe = await num(`select count(*) from card_skill where locale = 'en' and source = 'official'`)
  check('una riga per ogni skill che il parser legge, ne\' piu\' ne\' meno', righe === totale && totale > 10000,
    `${righe} nel database, ${totale} dalla cache`)
  const conEza = attese.filter((c) => c.rows.some((r) => r.kind === 'leader' && r.tier === 'eza')).length
  const ezaDb = await num(`select count(distinct card_id) from card_skill where kind = 'leader' and tier = 'eza'`)
  check('leader EZA per ogni carta con "LS description Z"', ezaDb === conEza && conEza > 600, `${ezaDb} su ${conEza}`)
  check('le carte solo del datamine non hanno skill', await num(
    `select count(*) from card_skill s join card c on c.id = s.card_id where c.wiki_title is null`) === 0)
  check('ogni carta del wiki ha almeno la leader', await num(`
    select count(*) from card c where c.wiki_title is not null
       and not exists (select 1 from card_skill s where s.card_id = c.id and s.kind = 'leader')`) === 0)

  const t = await one<{ super_attack: string; passive: string }>(
    `select super_attack, passive from card_text where card_id = 1030680 and locale = 'en'`)
  check('1030680: super_attack senza la nota incollata', !!t && !/turnRaises/.test(t.super_attack), t?.super_attack)
  check('1030680: la passiva tiene i punti elenco', !!t && t.passive.includes('\n- '))

  const pan = await q<Riga>(`
    select s.kind::text, s.tier::text, s.seq, s.details, s.condition from card_skill s join card c on c.id = s.card_id
     where c.wiki_title = 'Wings Spread Out to the Cosmos Pan (GT) (Honey)'`)
  check('Pan (GT) (Honey): Ultra Super Attack EZA', pan.some((r) => r.kind === 'ultra' && r.tier === 'eza'))
  check('Pan (GT) (Honey): attiva con la condizione', pan.some((r) => r.kind === 'active' && !!r.condition))
  check('Pan (GT) (Honey): la nota con nome riusata nell\'EZA', pan.some((r) =>
    r.kind === 'ultra' && r.tier === 'eza' && r.details.some((d) => d.includes('30% chance to stun'))))

  // Idempotenza: un secondo giro non cambia una riga. Una riga della
  // community sopravvive al giro: load-cards cancella solo le 'official'.
  const impronta = () => one<{ n: string; h: string }>(`
    select count(*)::text n, md5(string_agg(concat_ws('|', card_id, locale, kind, tier, seq, name, description,
           array_to_string(details, '~'), condition, ki, source), E'\\n' order by card_id, kind, tier, seq)) h
      from card_skill`)
  const wiki = carte[0].id
  await db.query(`insert into card_skill (card_id, locale, kind, tier, seq, description, source)
                  values ($1, 'en', 'domain', 'seza', 9, 'community text', 'community')`, [wiki])
  const prima = await impronta()
  importa('load-cards.mjs')
  const dopo = await impronta()
  check('rilanciare load-cards non cambia niente', prima?.h === dopo?.h && prima?.n === dopo?.n, `${prima?.n} -> ${dopo?.n}`)
  check('la riga della community resta', await num(
    `select count(*) from card_skill where card_id = $1 and source = 'community'`, [wiki]) === 1)
  await db.query(`delete from card_skill where card_id = $1 and source = 'community' and seq = 9`, [wiki])
  // link e categorie tornano come dopo run.sh
  importa('load-game-cards.mjs')
  importa('load-datamine.mjs')
}

try {
  await vincoli()
  await preferenza()
  await importate()
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  // gli utenti della suite per email esatta, e la carta finta
  const emails = ['cardpage_a', 'cardpage_b', 'cardpage_new'].map((h) => `${P}+${h}${DOMINIO}`)
  await db.query('delete from app_user where email = any($1::text[])', [emails])
  await db.query('delete from card where id = $1', [FINTA])
  check('pulizia: nessun utente di prova rimasto',
    (await q('select 1 from app_user where email = any($1::text[])', [emails])).length === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
