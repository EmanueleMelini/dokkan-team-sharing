#!/usr/bin/env node
// Carica gli eventi dal wikitext in cache dentro il database.
//
// Cosa il wiki da' davvero, e cosa no. Vale la pena scriverlo perche' le
// assenze sono la parte importante:
//
//   c'e'    nome, descrizione ufficiale, immagine del banner, tipo,
//           data di prima uscita per regione, gli stage con il loro
//           nome, e per ogni stage le difficolta' con il costo in
//           stamina — tutto da {{STA|difficolta'|STA|costo}}
//
//   non c'e' le MISSIONI. Solo 3 pagine su 608 hanno una sezione
//           dedicata, e il wiki stesso rimanda al gioco. mission resta
//           vuota: serve un'altra fonte.
//
//   non c'e' zeni, exp e drop per difficolta'. Ci sono nelle tabelle, ma
//           l'intestazione delle colonne e' riconoscibile solo in 78
//           pagine su 448: l'ordine cambia da pagina a pagina e leggere
//           la colonna sbagliata darebbe numeri plausibili e falsi.
//
//   non c'e' le ricorrenze. Il wiki da' una data di prima uscita, non le
//           finestre. Vedi ends_at_known nella migrazione 0007; le
//           finestre vere le porta load-windows, dal datamine Global.
//
//   node db/import/load-events.mjs [--dry-run]
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, '.cache', 'wiki-events.json')
const DRY = process.argv.includes('--dry-run')
const LOCALE = 'en'

// ---------------------------------------------------------------- parsing

const field = (txt, key) => {
  const m = txt.match(new RegExp(
    '^\\|\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.*)$', 'mi'))
  const v = m ? m[1].trim() : null
  return v || null
}
const scalar = (txt, key) => {
  const v = field(txt, key)
  if (!v) return null
  const t = v.replace(/\}\}.*$/, '').replace(/\|\s*[A-Za-z][\w ]*=.*$/, '').trim()
  return t || null
}
const clean = (s) => (s ?? '')
  .replace(/\[\[File:[^\]]*\]\]/gi, '')
  .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  .replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/'''?/g, '')
  .replace(/\s+/g, ' ')
  .trim()

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
function parseDate(raw) {
  if (!raw) return null
  const t = raw.replace(/^prior to\s+/i, '').trim()
  if (/^(n\/?a|unknown|tbd|\?+)$/i.test(t)) return null
  const m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/)
  if (!m) return null
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
  if (!mo) return null
  // Il giorno e' quello UTC (GLBdate e' la data UTC del primo inizio delle
  // quest in 253 eventi su 291): mezzanotte UTC esplicita, perche' una data
  // nuda Postgres la mette a mezzanotte del fuso della sessione (Europe/Rome
  // su dokkan_dev, un'ora o due prima, e in UTC il giorno prima).
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}T00:00:00Z`
}

// La classificazione viene dal template di navigazione in fondo alla
// pagina: e' il wiki stesso a dire in che elenco sta l'evento.
const NAV = {
  'Extreme Z-Battle Events Nav': 'zbattle',
  'Super EZA Events': 'zbattle',
  'LR EZA Events': 'zbattle',
  'EZA Events': 'zbattle',
  'Dokkan Events Nav': 'challenge',
  'Challenge Events Nav': 'challenge',
  'Prime Battle Events Nav': 'challenge',
  'Story Events Nav': 'story',
  'Special Events Nav': 'limited',
  'Limited-Attempts Events Nav': 'limited',
  'Limited Events Nav': 'limited',
  'Strike Events Nav': 'limited',
  'Weekly Events Nav': 'bonus',
  'Bonus Events Nav': 'bonus',
  'Battle for Awakening Medals Navigation': 'growth',
  'Quest Navigation': 'quest',
}
// ripiego sul titolo, per le pagine senza template di navigazione
const BY_TITLE = [
  [/^extreme z-battle/i, 'zbattle'],
  [/world tournament/i, 'world_tournament'],
  [/ultimate clash/i, 'ultimate_clash'],
  [/dokkan frontier/i, 'dokkan_frontier'],
  [/pettan|sd battle/i, 'pettan'],
  [/super battle road|red zone|battlefield/i, 'challenge'],
  [/awakening medals/i, 'growth'],
]

function kindOf(page) {
  for (const [tpl, k] of Object.entries(NAV)) {
    const re = new RegExp('\\{\\{\\s*' + tpl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (re.test(page.wikitext)) return k
  }
  for (const [re, k] of BY_TITLE) if (re.test(page.title)) return k
  return 'other'
}

const DIFF = { 'normal':'normal', 'hard':'hard', 'z-hard':'z_hard',
               'super':'super', 'super2':'super2', 'super3':'super3' }

// Le Extreme Z-Battle non hanno difficolta' ma livelli nemico, in una
// tabella con la colonna "Enemy Lv.". Ogni riga e' un livello: numero,
// boss, abilita' a cui e' immune, riduzione danni. Il livello diventa
// uno stage con una sola riga in stage_tier (difficolta' eza_level), e
// le note sul boss finiscono in stage_tier_text, che esiste per questo.

// Le immunita' si riconoscono dal NOME DEL FILE dell'icona, non dal
// link=: nel formato vecchio il link punta sempre alla pagina generica
// "Immunity", e la nota diventava "Immune to: Immunity" su 3258 livelli.
// Le etichette sono quelle che il formato nuovo mette gia' nel link=.
// Le altre icone St (St 0012 "il super del boss abbassa la DEF", St 0100)
// non sono immunita': stanno nelle note dell'evento, non nella colonna.
// L'ordine e' fisso perche' le pagine vecchie mettono le icone in ordine
// sparso, e lo stesso boss si leggerebbe diverso da una pagina all'altra.
const IMMUNITY = [
  [/^St (?:immune stun|1005)$/i, 'Stun'],
  [/^St (?:immune seal|1007)$/i, 'Seal Super Attack'],
  [/^St (?:immune reduce ATK|1006)$/i, 'Lower ATK'],
  [/^St (?:immune lower defense|1008)$/i, 'Lower DEF'],
  [/^St 1010$/i, 'Disable Action'],
]
const stUnknown = new Map()   // icone St nella colonna Skills che non so leggere

// "rowspan=2|[[File:...|50px]]": attributi, poi il contenuto. Il primo |
// separa solo se prima non c'e' un [[ o un {{, che hanno i loro |.
const cellOf = (c) => {
  const m = c.match(/^([^[{|]*)\|/)
  return m ? { attrs: m[1], body: c.slice(m[0].length).trim() } : { attrs: '', body: c }
}

function parseEnemyLevels(page) {
  const w = page.wikitext
  const stages = []
  const seen = new Set()
  // Solo le tabelle dei livelli: dall'intestazione "Enemy Lv." al primo
  // \n|}. Fuori ci sono note e premi, che hanno numeri e carte e prima
  // facevano passare righe per livelli. Una pagina puo' averne piu' d'una
  // (le tab di Dokkan All-Stars sono 19).
  for (let at = w.search(/Enemy Lv/i); at >= 0; ) {
    let end = w.indexOf('\n|}', at)
    if (end < 0) end = w.length
    const rows = w.slice(w.lastIndexOf('\n', at) + 1, end).split(/^\|-.*$/m)
    const next = w.slice(end).search(/Enemy Lv/i)
    at = next < 0 ? -1 : end + next

    // le colonne si cercano per nome nell'intestazione
    const head = rows[0].split(/^[!|]/m).slice(1).map((c) => cellOf(c.trim()).body)
    const col = (re, d) => { const i = head.findIndex((h) => re.test(h)); return i < 0 ? d : i }
    const cSkills = col(/^Skills/i, 2), cDr = col(/^Damage/i, 3)

    // Una cella con rowspan=N vale anche per le N-1 righe sotto, che
    // quella colonna non la scrivono: senza riportarla, in Dokkan
    // All-Stars i livelli pari restano senza boss, immunita' e riduzione.
    let carry = []
    for (const row of rows.slice(1)) {
      // celle per posizione: anche quelle vuote contano, o le colonne
      // dopo scivolano. "!\n5" e' una cella sola (i checkpoint 5 e 10).
      const cells = row.split(/^[!|]/m).slice(1).map((c) => cellOf(c.trim()))
      const r = [], down = []
      let c = 0
      const fromAbove = () => {
        const k = carry[c]
        r[c] = k.body
        if (k.left > 1) down[c] = { body: k.body, left: k.left - 1 }
        c++
      }
      for (const { attrs, body } of cells) {
        while (carry[c]) fromAbove()
        const rs = Number(attrs.match(/rowspan\s*=\s*"?(\d+)/i)?.[1] ?? 1)
        const cs = Number(attrs.match(/colspan\s*=\s*"?(\d+)/i)?.[1] ?? 1)
        for (let k = 0; k < cs; k++, c++) {
          r[c] = body
          if (rs > 1) down[c] = { body, left: rs - 1 }
        }
      }
      while (c < carry.length) { if (carry[c]) fromAbove(); else c++ }
      carry = down

      // una riga e' un livello se la prima cella e' il numero e basta:
      // "31+", l'icona dei livelli Super e le righe di testo restano fuori
      const lv = (r[0] ?? '').replace(/\s+/g, '')
      if (!/^\d+$/.test(lv)) continue
      const lvl = Number(lv)
      // 999 e non 200: Dokkan All-Stars ha davvero 999 livelli, ognuno con
      // il suo boss, e altri eventi chiudono con un livello 999
      if (lvl < 1 || lvl > 999 || seen.has(lvl)) continue
      seen.add(lvl)

      const dr = (r[cDr] ?? '').match(/-\s*(\d+)\s*%/)?.[1]
      const found = new Set()
      for (const m of (r[cSkills] ?? '').matchAll(/\[\[File:\s*(St[ _][^|\]]+?)\s*(?:\|[^\]]*)?\]\]/gi)) {
        const file = m[1].replace(/_/g, ' ').replace(/\.\w+$/, '').trim()
        const hit = IMMUNITY.find(([re]) => re.test(file))
        if (hit) found.add(hit[1])
        else stUnknown.set(file, (stUnknown.get(file) ?? 0) + 1)
      }
      const immune = IMMUNITY.map(([, label]) => label).filter((l) => found.has(l))
      const bits = []
      if (dr) bits.push(`Damage reduction -${dr}%`)
      if (immune.length) bits.push(`Immune to: ${immune.join(', ')}`)
      stages.push({ seq: lvl, name: `Level ${lvl}`, note: bits.join('; ') || null,
                    tiers: [{ difficulty: 'eza_level', sta_cost: null }] })
    }
  }
  return stages.sort((a, b) => a.seq - b.seq)
}

// Gli stage: le righe con colspan che dicono "Level N: Nome" aprono un
// gruppo, e i {{STA}} che seguono sono le sue difficolta'. Se una pagina
// ha dei {{STA}} ma nessun gruppo, l'evento e' a stage singolo.
function parseStages(page) {
  const stages = []
  let cur = null
  for (const line of page.wikitext.split('\n')) {
    const g = line.match(/^!\s*colspan="?\d+"?[^|]*\|\s*(?:'''?)?\s*(?:Level|Stage|Area|Part)\s*([0-9]+)\s*(?:[:\-–]\s*(.*?))?\s*(?:'''?)?\s*$/i)
    if (g) {
      cur = { seq: Number(g[1]), name: clean(g[2]) || null, tiers: [] }
      stages.push(cur)
      continue
    }
    for (const m of line.matchAll(/\{\{STA\s*\|\s*([A-Za-z0-9-]+)\s*\|\s*STA\s*\|\s*(\d+)\s*\}\}/g)) {
      const d = DIFF[m[1].toLowerCase()]
      if (!d) continue
      if (!cur) { cur = { seq: 1, name: null, tiers: [] }; stages.push(cur) }
      if (!cur.tiers.some((t) => t.difficulty === d)) {
        cur.tiers.push({ difficulty: d, sta_cost: Number(m[2]) })
      }
    }
  }
  // seq duplicati (tabelle ripetute per regione): si tiene il primo
  const seen = new Set()
  return stages.filter((s) => s.tiers.length && !seen.has(s.seq) && seen.add(s.seq))
}

function parseEvent(page) {
  const w = page.wikitext
  const bad = (why) => ({ skipped: { title: page.title, why } })
  if (!w.includes('{{Events')) return bad('non usa il template Events')
  const stages = parseStages(page).length ? parseStages(page) : parseEnemyLevels(page)
  if (!stages.length) return bad("nessuno stage riconoscibile (guida o modalita' di gioco, non un evento giocabile)")

  const bannerFile = (field(w, 'Event Image') ?? '')
    .replace(/\[\[File:/i, '').replace(/[|\]].*$/, '').trim() || null

  return {
    event: {
      id: page.pageid,               // il pageid del wiki: stabile, non l'id di gioco
      kind: kindOf(page),
      wiki_title: page.title,
    },
    bannerFile,
    text: {
      name: page.title.replace(/\s*\((?:Discontinued|Unavailable|Old)\)\s*$/i, '').trim(),
      description: clean(field(w, 'Event Info')) || null,
    },
    releases: [
      { reg: 'japan',  released_at: parseDate(scalar(w, 'JPdate')) },
      { reg: 'global', released_at: parseDate(scalar(w, 'GLBdate')) },
    ].filter((r) => r.released_at),
    stages,
  }
}

// ---------------------------------------------------------------- analisi

const raw = JSON.parse(readFileSync(CACHE, 'utf8'))
console.log(`  sorgente: ${raw.source}`)
console.log(`  scaricata il ${raw.fetched_at}, ${raw.pages.length} pagine\n`)

const parsed = raw.pages.map(parseEvent)
const skipped = parsed.filter((p) => p.skipped).map((p) => p.skipped)
const events = parsed.filter((p) => p.event)

const tally = (a) => { const m = new Map(); for (const v of a) m.set(v, (m.get(v) ?? 0) + 1); return [...m].sort((x, y) => y[1] - x[1]) }
console.log(`  eventi utilizzabili: ${events.length}`)
console.log(`  scartati: ${skipped.length}`)
for (const [why, n] of tally(skipped.map((s) => s.why))) console.log(`    ${String(n).padStart(4)}  ${why}`)
console.log(`\n  per tipo:  ${tally(events.map((e) => e.event.kind)).map(([k, n]) => `${k}:${n}`).join('  ')}`)
console.log(`  stage: ${events.reduce((a, e) => a + e.stages.length, 0)}`)
console.log(`  difficolta': ${events.reduce((a, e) => a + e.stages.reduce((b, s) => b + s.tiers.length, 0), 0)}`)
console.log(`  difficolta' usate:  ${tally(events.flatMap((e) => e.stages.flatMap((s) => s.tiers.map((t) => t.difficulty)))).map(([k, n]) => `${k}:${n}`).join('  ')}`)
if (stUnknown.size) console.log(`  icone St non riconosciute fra le immunita': ${[...stUnknown].map(([f, n]) => `${f}:${n}`).join('  ')}`)
console.log(`  con descrizione: ${events.filter((e) => e.text.description).length}`)
console.log(`  con banner:      ${events.filter((e) => e.bannerFile).length}`)
console.log(`  uscite su Global: ${events.filter((e) => e.releases.some((r) => r.reg === 'global')).length}`)
console.log(`  solo su Japan:    ${events.filter((e) => e.releases.length && !e.releases.some((r) => r.reg === 'global')).length}`)
console.log(`  senza nessuna data: ${events.filter((e) => !e.releases.length).length}`)

if (DRY) {
  const s = events.find((e) => e.stages.length > 3) ?? events[0]
  console.log('\n  campione:')
  console.log('   ', JSON.stringify({ ...s.event, ...s.text, banner: s.bannerFile,
    releases: s.releases, stages: s.stages.slice(0, 3) }, null, 1).replace(/\n/g, '\n    ').slice(0, 1100))
  console.log('\n  --dry-run: non ho scritto niente')
  process.exit(0)
}

// ---------------------------------------------------------------- scrittura

// Il reimport aggiorna sul posto, per chiave naturale, e non cancella e
// reinserisce piu' niente. Il motivo sono i clear: puntano a stage_tier
// e a event_run con FK senza cascata, quindi con un solo clear la
// cancellazione falliva e l'import tornava indietro; e anche riuscendo,
// gli id nuovi avrebbero rotto i link ?tier= gia' in giro. Cosi' gli id
// restano quelli, e si toglie solo cio' che il wiki non da' piu' e su
// cui nessuno ha scritto niente.

console.log(`  database: ${describeTarget()}`)
const client = new pg.Client({ connectionString: connectionString() })
await client.connect()
const used = (r) => r.used

try {
  await client.query('begin')

  // Un pageid che coincide con un evento non preso dal wiki (la fixture,
  // uno inserito a mano) non si sovrascrive: si salta, e lo si dice.
  const { rows: notWiki } = await client.query(`
    select id from event where id = any($1::bigint[]) and imported_from <> 'wiki'`,
    [events.map((x) => x.event.id)])
  const notWikiIds = new Set(notWiki.map((r) => Number(r.id)))
  for (const id of notWikiIds) console.log(`  salto ${id}: c'e' gia' un evento con questo id che non viene dal wiki`)
  const load = events.filter((x) => !notWikiIds.has(x.event.id))

  const e = load.map((x) => x.event)
  await client.query(`
    insert into event (id, kind, wiki_title, imported_from, imported_at)
    select * from unnest($1::bigint[], $2::event_kind[], $3::text[], $4::data_source[], $5::timestamptz[])
    on conflict (id) do update set
      kind = excluded.kind, wiki_title = excluded.wiki_title,
      imported_from = excluded.imported_from, imported_at = excluded.imported_at`,
    [e.map(x=>x.id), e.map(x=>x.kind), e.map(x=>x.wiki_title),
     e.map(()=>'wiki'), e.map(()=>new Date())])
  console.log(`  eventi scritti: ${e.length}`)

  const t = load.map((x) => ({ id: x.event.id, ...x.text }))
  await client.query(`
    insert into event_text (event_id, locale, name, official_description, source)
    select * from unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text_source[])
    on conflict (event_id, locale) do update set
      name = excluded.name, official_description = excluded.official_description,
      source = excluded.source`,
    [t.map(x=>x.id), t.map(()=>LOCALE), t.map(x=>x.name), t.map(x=>x.description), t.map(()=>'official')])

  // Le ricorrenze del wiki: una per regione, aperta, con la fine
  // dichiarata non nota (ends_at_known = false). Si aggiornano per
  // (evento, regione), tenendo l'id. Si toccano solo quelle con
  // source = 'wiki' (migrazione 0010): le finestre di set-event-window e
  // quelle del gioco no — anche una del gioco puo' avere la fine non nota,
  // quindi ends_at_known non basta piu' a riconoscerle. E quando una di
  // quelle ha preso il posto della run del wiki, la run non si ricrea: si
  // sovrapporrebbe, ed e' proprio quella che e' stata tolta o adottata. Una
  // del gioco basta da sola: puo' aver smentito la data del wiki, e allora
  // non si sovrappone a niente.
  const ids = e.map((x) => x.id)
  const runs = load.flatMap((x) => x.releases.map((r) => ({ id: x.event.id, ...r })))
  const runArgs = [runs.map(x=>x.id), runs.map(x=>x.reg), runs.map(x=>x.released_at)]
  const { rowCount: runMoved } = await client.query(`
    update event_run r set starts_at = d.starts_at
    from unnest($1::bigint[], $2::region[], $3::timestamptz[]) as d(event_id, reg, starts_at)
    where r.event_id = d.event_id and r.reg = d.reg and r.source = 'wiki'
      and r.starts_at <> d.starts_at
      -- una run del wiki chiusa dal gioco ha ends_at: non si sposta oltre
      and (r.ends_at is null or r.ends_at > d.starts_at)
      and not exists (select 1 from event_run o
        where o.event_id = r.event_id and o.reg = r.reg and o.id <> r.id
          and tstzrange(o.starts_at, coalesce(o.ends_at, 'infinity'))
              && tstzrange(d.starts_at, coalesce(r.ends_at, 'infinity')))`, runArgs)
  const { rowCount: runNew } = await client.query(`
    insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
    select d.event_id, d.reg, d.starts_at, null::timestamptz, false, 'wiki'
    from unnest($1::bigint[], $2::region[], $3::timestamptz[]) as d(event_id, reg, starts_at)
    where not exists (select 1 from event_run r
      where r.event_id = d.event_id and r.reg = d.reg
        and (r.source in ('wiki', 'game')
             or tstzrange(r.starts_at, coalesce(r.ends_at, 'infinity'))
                && tstzrange(d.starts_at, 'infinity')))`, runArgs)
  // una run del wiki che il wiki non da' piu' se ne va, a meno che non
  // ci sia sopra un clear
  const { rows: runOld } = await client.query(`
    select r.id, r.event_id, r.reg::text as reg,
           exists (select 1 from clear c where c.run_id = r.id) as used
    from event_run r
    where r.event_id = any($1::bigint[]) and r.source = 'wiki'
      and not exists (select 1 from unnest($2::bigint[], $3::region[]) as d(event_id, reg)
                      where d.event_id = r.event_id and d.reg = r.reg)`,
    [ids, runArgs[0], runArgs[1]])
  await client.query('delete from event_run where id = any($1::bigint[])',
    [runOld.filter((r) => !used(r)).map((r) => r.id)])
  for (const r of runOld.filter(used)) {
    console.log(`  tengo la run ${r.id} (evento ${r.event_id}, ${r.reg}): il wiki non la da' piu' ma ci sono dei clear`)
  }
  console.log(`  ricorrenze (prima uscita, fine non nota): ${runs.length}` +
              `   nuove ${runNew}, spostate ${runMoved}, tolte ${runOld.length - runOld.filter(used).length}`)

  // Gli stage, per (evento, seq): quelli che ci sono gia' restano come sono
  const st = load.flatMap((x) => x.stages.map((s) => ({ ev: x.event.id, ...s })))
  const { rowCount: stageNew } = await client.query(`
    insert into stage (event_id, seq)
    select * from unnest($1::bigint[], $2::smallint[])
    on conflict (event_id, seq) do nothing`,
    [st.map(x=>x.ev), st.map(x=>x.seq)])
  const { rows: stageRows } = await client.query(
    'select id, event_id, seq from stage where event_id = any($1::bigint[])', [ids])
  const stageId = new Map(stageRows.map((r) => [`${r.event_id}:${r.seq}`, r.id]))
  for (const s of st) s.id = stageId.get(`${s.ev}:${s.seq}`)

  // solo la nostra lingua: e' l'unica che l'import scrive
  const named = st.filter((s) => s.name)
  await client.query(`
    insert into stage_text (stage_id, locale, name, source)
    select d.s, $2::text, d.n, 'official' from unnest($1::bigint[], $3::text[]) as d(s, n)
    on conflict (stage_id, locale) do update set name = excluded.name, source = excluded.source`,
    [named.map(s=>s.id), LOCALE, named.map(s=>s.name)])
  await client.query('delete from stage_text where stage_id = any($1::bigint[]) and locale = $2',
    [st.filter((s) => !s.name).map((s) => s.id), LOCALE])

  // Le difficolta', per (stage, difficolta'). zeni, exp e ll_rate l'import
  // non li scrive, quindi un update non deve azzerarli.
  const tr = st.flatMap((s) => s.tiers.map((x) => ({ stage: s.id, ev: s.ev, note: s.note, ...x })))
  const { rows: tierRows } = await client.query(`
    insert into stage_tier (stage_id, event_id, difficulty, sta_cost)
    select * from unnest($1::bigint[], $2::bigint[], $3::difficulty[], $4::smallint[])
    on conflict (stage_id, difficulty) do update set sta_cost = excluded.sta_cost
    returning id, stage_id, difficulty::text as difficulty, (xmax = 0) as inserted`,
    [tr.map(x=>x.stage), tr.map(x=>x.ev), tr.map(x=>x.difficulty), tr.map(x=>x.sta_cost)])
  const tierId = new Map(tierRows.map((r) => [`${r.stage_id}:${r.difficulty}`, r.id]))
  for (const x of tr) x.id = tierId.get(`${x.stage}:${x.difficulty}`)

  const noted = tr.filter((x) => x.note)
  await client.query(`
    insert into stage_tier_text (stage_tier_id, locale, boss_note, source)
    select d.t, $2::text, d.n, 'community' from unnest($1::bigint[], $3::text[]) as d(t, n)
    on conflict (stage_tier_id, locale) do update set
      boss_note = excluded.boss_note, source = excluded.source`,
    [noted.map(x=>x.id), LOCALE, noted.map(x=>x.note)])
  // una nota che il wiki non da' piu' non deve restare quella vecchia
  await client.query('delete from stage_tier_text where stage_tier_id = any($1::bigint[]) and locale = $2',
    [tr.filter((x) => !x.note).map((x) => x.id), LOCALE])

  // Quello che il wiki non da' piu' si toglie, tranne dove gli utenti
  // hanno scritto: un clear (FK senza cascata) o un tip (che la cascata
  // porterebbe via in silenzio). Quelli restano, e si elencano.
  const { rows: tierOld } = await client.query(`
    select t.id, t.event_id, s.seq, t.difficulty::text as difficulty,
           exists (select 1 from clear c where c.stage_tier_id = t.id)
             or exists (select 1 from tip p where p.stage_tier_id = t.id) as used
    from stage_tier t join stage s on s.id = t.stage_id
    where t.event_id = any($1::bigint[]) and not (t.id = any($2::bigint[]))`,
    [ids, tr.map((x) => x.id)])
  await client.query('delete from stage_tier where id = any($1::bigint[])',
    [tierOld.filter((x) => !used(x)).map((x) => x.id)])
  for (const x of tierOld.filter(used)) {
    console.log(`  tengo evento ${x.event_id} stage ${x.seq} ${x.difficulty} (id ${x.id}): il wiki non lo da' piu' ma ci sono clear o tip`)
  }
  // uno stage sparito se ne va solo se non gli resta nessuna difficolta'
  const { rowCount: stageGone } = await client.query(`
    delete from stage s
    where s.event_id = any($1::bigint[]) and not (s.id = any($2::bigint[]))
      and not exists (select 1 from stage_tier t where t.stage_id = s.id)`,
    [ids, st.map((s) => s.id)])

  console.log(`  stage: ${st.length}   nuovi ${stageNew}, tolti ${stageGone}`)
  console.log(`  difficolta': ${tr.length}   nuove ${tierRows.filter((r) => r.inserted).length}, ` +
              `tolte ${tierOld.length - tierOld.filter(used).length}`)

  await client.query('commit')
  console.log('\n  fatto.')
} catch (err) {
  await client.query('rollback')
  console.error(`\n  import fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()
