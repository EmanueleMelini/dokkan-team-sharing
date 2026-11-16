#!/usr/bin/env node
// Le date Japan da D in poi, copiate da Global: lo specchio (migrazione 0036).
//
// Il wiki era l'unica fonte delle run Japan (JPdate, load-events) e ha
// smesso di creare pagine evento a gennaio 2025. Da allora Japan e Global
// escono con lo stesso calendario (le prove in japan-mirror/rules.mjs),
// quindi le finestre Global del gioco valgono anche per Japan. Questo
// script, dopo load-windows (le finestre Global sono gia' quelle del giro:
// fusioni, riassorbimenti e scambi fatti) e prima di load-missions:
//
//   1. copia su Japan ogni run Global del gioco o a mano (set-event-window
//      --reg global) da D in poi, con le regole di japan-mirror/plan.mjs
//      (la run Japan a mano vince, la run del wiki della stessa uscita
//      diventa la copia sul posto, anche se la copia c'era gia', quella piu'
//      vecchia si chiude, la data del wiki da D in poi vince, e la run del
//      wiki va alla data del wiki, qualunque sia, in questo stesso giro).
//      Le copie hanno source = 'mirror': si ricalcolano a ogni giro, e solo
//      loro;
//   2. tiene i clear Japan dentro la loro corsa: se il piano ha appena
//      chiuso o accorciato una run del wiki (o una copia) lasciando fuori
//      dei clear della sua corsa, e i suoi clear stanno tutti dentro una
//      copia senza clear, le due righe si scambiano, come al passo 4 di
//      load-windows (e al contrario, una copia con clear chiusa alla data
//      del wiki diventa la run del wiki che la segue, se i clear stanno
//      tutti li'). Il piano non sposta e non chiude una run del wiki se i
//      clear della sua corsa ne resterebbero fuori senza uno scambio. Una
//      copia invece segue sempre la sua finestra Global, come una run del
//      gioco in load-windows: i clear che cosi' restano fuori si contano
//      ("clear Japan scritti fuori dalla loro run"), da rivedere a mano;
//   3. da' alle carte uscite su Global da D senza una data Japan lo stesso
//      giorno sul calendario giapponese (card_release, source = 'mirror';
//      per le carte del gioco dall'istante di open_at del datamine: dalle
//      15:00 UTC e' gia' il giorno dopo): senza, il picker di un clear
//      Japan non le trova. Qui e non in uno script a parte perche' la
//      regola e' la stessa (lo stesso D, lo stesso calendario), e un giro
//      solo, in una transazione sola, non lascia le run copiate e le carte
//      no. Le carte sono gia' tutte caricate: load-cards e load-game-cards
//      girano prima.
//
// Una copia che la regola non vuole piu' si toglie, tranne quando ci sono
// dei clear sopra: allora resta, e lo si dice con "  tengo la run" (il
// giro settimanale conta quelle righe). Un'uscita Japan del wiki o scritta
// a mano non si tocca mai.
//
// I passi 1 e 2 si ripetono, nella stessa transazione, sugli eventi che
// hanno appena cambiato (al piu' tre passi in tutto): il giro arriva allo
// stato fermo in una volta, e il giro dopo non cambia niente. Se al terzo
// cambia ancora lo dice ("  attenzione: lo specchio cambia ancora").
//
//   node db/import/mirror-japan.mjs [--dry-run] [--verbose] [--rules regole.json]
//
// --rules: un JSON che sostituisce le chiavi di RULES (since, globalOnly,
// skipWindows, globalOnlyCards), per provare un'eccezione con --dry-run
// prima di scriverla in rules.mjs. Lo usano anche i test.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { connectionString, describeTarget } from '../env.mjs'
import { gameStart, isSentinel, loadTable, snapshotInfo } from './datamine.mjs'
import { wikiJapanRelease } from './game-map.mjs'
import { RULES, checkRules } from './japan-mirror/rules.mjs'
import { planCardMirror, planJapanMirror } from './japan-mirror/plan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const VERBOSE = argv.includes('--verbose')
const RULES_FILE = argv.includes('--rules') ? argv[argv.indexOf('--rules') + 1] : null
// WIKI_EVENTS_CACHE solo per i test, come WIKI_CARDS_CACHE di load-cards:
// japan-mirror.test.mts gli passa una copia con una data Japan cambiata
const CACHE = process.env.WIKI_EVENTS_CACHE ?? join(HERE, '.cache', 'wiki-events.json')

const jst = (t) => new Date(new Date(t).getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' JST'
const day = (d) => (d == null ? 'aperta' : new Date(d).toISOString().slice(0, 16).replace('T', ' '))
const finestra = (x) => `${day(x.starts_at)} → ${x.ends_at ? day(x.ends_at) : x.ends_at_known ? 'permanente' : 'fine non nota'}`

console.log(`  database: ${describeTarget()}`)
let rules = RULES
if (RULES_FILE) {
  try { rules = { ...RULES, ...JSON.parse(readFileSync(RULES_FILE, 'utf8')) } } catch (err) {
    console.error(`\n  non riesco a leggere le regole di ${RULES_FILE}: ${err.message}\n`); process.exit(1)
  }
}
const problemi = checkRules(rules)
if (problemi.length) {
  console.error(`\n  regole sbagliate${RULES_FILE ? ` (${RULES_FILE})` : ' (japan-mirror/rules.mjs)'}, non scrivo niente:`)
  for (const p of problemi) console.error(`    ${p}`)
  console.error('')
  process.exit(1)
}
console.log(`  regole: da ${jst(rules.since)} (${rules.since}), solo Global ${rules.globalOnly.length} eventi e ` +
            `${rules.globalOnlyCards.length} carte, finestre saltate a mano ${rules.skipWindows.length}` +
            (RULES_FILE ? `  (da ${RULES_FILE})` : ''))

console.log(`  sorgente: datamine, ${snapshotInfo()}${process.env.WIKI_EVENTS_CACHE ? '; wiki da WIKI_EVENTS_CACHE' : ''}`)
const wiki = JSON.parse(readFileSync(CACHE, 'utf8'))
const pages = new Map(wiki.pages.map((p) => [p.pageid, p.wikitext]))
// l'istante di uscita Global di ogni carta del datamine (per il giorno
// giapponese delle carte che solo il gioco conosce, passo 3)
const openAt = new Map()
for (const r of loadTable('cards')) {
  if (r.open_at && !isSentinel(r.open_at)) openAt.set(Number(r.id), gameStart(r.open_at))
}

const client = new pg.Client({ connectionString: connectionString() })
await client.connect()

// Lo stato di ogni evento su Japan come lo mostra la lista del sito: la
// ricorrenza in corso, se no la prossima, se no l'ultima conclusa.
const STATUS_SQL = `
  with u as (
    select distinct on (es.event_id) es.event_id, es.status, r.ends_at_known, r.source
    from event_status es join event_run r on r.id = es.run_id
    where es.reg = 'japan'
    order by es.event_id,
             case es.status when 'active' then 0 when 'upcoming' then 1 else 2 end,
             case when es.status = 'upcoming' then es.starts_at end asc nulls last,
             es.starts_at desc)
  select status, ends_at_known as known, source, count(*)::int as n from u group by 1, 2, 3`
async function statusNow() {
  const { rows } = await client.query(STATUS_SQL)
  const n = (f) => rows.filter(f).reduce((a, r) => a + r.n, 0)
  return `eventi ${n(() => true)} (dallo specchio ${n((r) => r.source === 'mirror')}): attivi ${n((r) => r.status === 'active')}` +
         ` (fine nota ${n((r) => r.status === 'active' && r.known)}), in arrivo ${n((r) => r.status === 'upcoming')},` +
         ` conclusi ${n((r) => r.status === 'past')}`
}

// I passi dello specchio dentro la transazione: dopo le scritture e gli
// scambi del primo, gli eventi toccati si rileggono e si ripianificano, al
// piu' PASSI volte in tutto (vedi sotto).
const PASSI = 3

try {
  await client.query('begin')
  const before = await statusNow()

  // ------------------------------------------------------------ le run
  // Gli istanti come testo ISO con i microsecondi (US): una Date di JS si
  // ferma al millisecondo, e la copia deve essere uguale alla run Global
  // (le run a mano scritte con now() hanno i microsecondi)
  const iso = (c) => `to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
  // la data Japan del wiki degli eventi presi dal wiki: per i conflitti, e
  // per riconoscere la run del wiki che lo specchio ha adottato
  const { rows: wikiEvents } = await client.query(`select id::text from event where imported_from = 'wiki'`)
  const wikiJapan = new Map()
  const daWiki = new Set(wikiEvents.map((r) => Number(r.id)))
  for (const { id } of wikiEvents) {
    const d = wikiJapanRelease(pages.get(Number(id)))
    if (d) wikiJapan.set(Number(id), d)
  }
  const { rows: nomi } = await client.query(`select event_id::text as id, name from event_text where locale = 'en'`)
  const nome = new Map(nomi.map((r) => [Number(r.id), r.name]))
  const label = (id) => `${id} ${nome.get(Number(id)) ?? '(senza nome)'}`

  // Lo stato di un passo, per gli eventi dati (null: tutti).
  async function leggi(eventi) {
    const di = (rows) => (eventi ? rows.filter((r) => eventi.has(Number(r.event_id))) : rows)
    // le finestre Global del gioco e quelle a mano (set-event-window --reg
    // global corregge una data Global: vale anche per Japan)
    const { rows: globalRuns } = await client.query(`
      select id::text, event_id::text, source, ${iso('starts_at')} as starts_at, ${iso('ends_at')} as ends_at, ends_at_known
      from event_run where reg = 'global' and source in ('game', 'manual') and starts_at >= $1::timestamptz
      order by event_id, event_run.starts_at`, [rules.since])
    const { rows: japanRuns } = await client.query(`
      select id::text, event_id::text, source, ${iso('starts_at')} as starts_at, ${iso('ends_at')} as ends_at, ends_at_known
      from event_run where reg = 'japan' order by event_id, event_run.starts_at`)
    // le run che un clear (senza cascata) o una missione (con) puntano: non si cancellano
    const { rows: pinnedRows } = await client.query(`
      select run_id::text as id from clear where run_id is not null
      union select run_id::text from mission where run_id is not null`)
    // gli istanti dei clear Japan, per la regola dei clear del piano: una run
    // del wiki non si sposta ne' si chiude se i clear della sua corsa ne
    // resterebbero fuori (con i microsecondi, come le run)
    const { rows: clearRows } = await client.query(`
      select c.run_id::text as id, ${iso('c.created_at')} as at
      from clear c join event_run r on r.id = c.run_id where r.reg = 'japan'`)
    const clears = new Map()
    for (const c of clearRows) clears.set(c.id, [...(clears.get(c.id) ?? []), c.at])
    return { globalRuns: di(globalRuns), japanRuns: di(japanRuns), pinned: new Set(pinnedRows.map((r) => r.id)), clears }
  }

  // Un passo: il piano, le sue scritture, poi gli scambi.
  // spinte: le righe che i piani hanno accorciato lasciando fuori dei clear
  // della loro corsa, in questo passo o in uno prima (le sole che si
  // scambiano).
  async function passo(eventi, spinte) {
    const input = await leggi(eventi)
    const plan = planJapanMirror({ ...input, wikiJapan, rules })

    // 1. le scritture, nell'ordine del piano (il vincolo non e' differibile)
    for (const p of plan.steps) {
      if (p.kind === 'delete') {
        // una copia che la regola non vuole piu', o una run del wiki in piu'
        // (della stessa uscita di una copia con dei clear, il passo 3b del
        // piano, o accanto a quella della data del wiki, il 7c): mai una run
        // con dei clear o delle missioni (queste andrebbero via con lei, in
        // cascata)
        const { rowCount } = await client.query(`
          delete from event_run r where r.id = $1 and r.reg = 'japan' and r.source = $2 and r.source in ('mirror', 'wiki')
            and not exists (select 1 from clear c where c.run_id = r.id)
            and not exists (select 1 from mission m where m.run_id = r.id)`, [p.id, p.was.source])
        if (rowCount !== 1) throw new Error(`la run ${p.id} non e' piu' una ${p.was.source === 'wiki' ? 'run del wiki' : 'copia dello specchio'} senza clear`)
      } else if (p.kind === 'update') {
        const { rowCount } = await client.query(`
          update event_run set source = $2, starts_at = $3, ends_at = $4, ends_at_known = $5
          where id = $1 and reg = 'japan' and source = $6 and source in ('wiki', 'mirror')`,
          [p.id, p.source, p.starts_at, p.ends_at, p.ends_at_known, p.was.source])
        if (rowCount !== 1) throw new Error(`la run ${p.id} e' cambiata sotto i piedi (era ${p.was.source})`)
      } else {
        // una copia nuova, o la run del wiki messa alla data Japan del wiki
        if (p.source !== 'mirror' && p.source !== 'wiki') throw new Error(`una run nuova con source ${p.source}`)
        await client.query(`
          insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
          values ($1, 'japan', $2, $3, $4, $5)`, [p.event_id, p.starts_at, p.ends_at, p.ends_at_known, p.source])
      }
    }

    // 2. Il sito aggancia un clear alla run attiva quando lo si scrive.
    // Chiudere la run del wiki all'inizio della copia lascia fuori i clear
    // Japan scritti dopo: allora, come in load-windows, le due righe si
    // scambiano. La run dei clear diventa la copia (stesso id, nessun clear
    // si tocca) e il suo tratto di prima rientra come run nuova, della sua
    // provenienza. La copia che si toglie non ha clear ne' missioni.
    // Solo per le righe che il piano ha appena accorciato lasciando fuori dei
    // clear che stavano dentro la loro corsa (plan.spinte), e solo se i clear
    // stanno tutti nella copia. Una run gia' chiusa che si sceglie nel
    // builder ("When you cleared it") per un clear scritto oggi non si
    // scambia mai: il clear resta sulla corsa che si e' scelta, fuori, e il
    // giro lo conta qui sotto. Prima lo scambio guardava ogni run chiusa con
    // la fine non nota, a ogni giro, e la portava nella copia in corso.
    // Le righe spinte sono:
    //   - la run del wiki chiusa all'inizio di una copia, anche non quella
    //     subito dopo: al primo giro i clear Japan stanno sulle run del wiki
    //     aperte, e quelli di una replica successiva stanno nella sua copia;
    //   - una copia chiusa con la fine non nota: set-event-window --reg global
    //     con il --dal dentro una finestra in corso chiude la run Global al
    //     --dal e la segue una run a mano; la copia con i clear va alla
    //     finestra chiusa (stesso inizio), e i clear scritti dopo il --dal
    //     stanno nella copia della run a mano.
    // Una copia che segue la sua finestra e non si puo' scambiare (la fine
    // nota, o nessuna copia senza clear li contiene tutti) li lascia fuori:
    // si contano qui sotto, da rivedere a mano, come su Global.
    // Il tratto di prima non rientra quando e' la run del wiki della stessa
    // uscita della copia che la chiudeva (finiva dove quella comincia, ed e'
    // cominciata meno di due giorni prima: un import da zero ha una run sola,
    // quella adottata, e il giro dopo lo riunirebbe, il passo 3b del piano), o
    // quando il wiki non da' piu' la data Japan dell'evento (load-events lo
    // toglierebbe al giro dopo: un import da zero non ha la run del wiki).
    // Gli istanti passano come testo con i microsecondi (iso): una Date di JS
    // si ferma al millisecondo, e la copia deve restare uguale alla sua run
    // Global (quelle a mano scritte con now() hanno i microsecondi).
    // Uno scambio puo' liberarne un altro (la riga rientrata e' una copia
    // senza clear): si ripete finche' ce n'e'.
    for (const x of plan.spinte) spinte.add(x.id)
    const swaps = []
    for (let giro = 0; giro < 20 && spinte.size; giro++) {
      const { rows: coppie } = await client.query(`
        select r.id::text as rid, g.id::text as gid, r.event_id::text, r.source as rsource
        from event_run r
        join event_run g on g.event_id = r.event_id and g.reg = r.reg and g.source = 'mirror' and g.id <> r.id
        where r.id = any($1::bigint[]) and r.reg = 'japan' and r.source in ('wiki', 'mirror')
          and r.ends_at is not null and not r.ends_at_known
          and exists (select 1 from clear c where c.run_id = r.id)
          and not exists (select 1 from clear c where c.run_id = r.id
                          and not (c.created_at >= g.starts_at and c.created_at < coalesce(g.ends_at, 'infinity')))
          and not exists (select 1 from clear c where c.run_id = g.id)
          and not exists (select 1 from mission m where m.run_id in (r.id, g.id))
        order by r.id`, [[...spinte]])
      const usate = new Set()
      const ora = coppie.filter((x) => !usate.has(x.gid) && usate.add(x.gid))
      if (!ora.length) break
      for (const x of ora) {
        const { rows: [g] } = await client.query(`
          delete from event_run where id = $1 and source = 'mirror'
          returning ${iso('starts_at')} as starts_at, ${iso('ends_at')} as ends_at, ends_at_known`, [x.gid])
        const { rows: [w] } = await client.query(`
          update event_run r set source = 'mirror', starts_at = $2, ends_at = $3, ends_at_known = $4
          from (select starts_at, ends_at from event_run where id = $1) old
          where r.id = $1 returning ${iso('old.starts_at')} as starts_at, ${iso('old.ends_at')} as ends_at`,
          [x.rid, g.starts_at, g.ends_at, g.ends_at_known])
        const { rows: [{ stessa }] } = await client.query(`
          select exists (select 1 from event_run c where c.event_id = $1 and c.reg = 'japan' and c.source = 'mirror'
                           and c.starts_at = $3::timestamptz and $2::timestamptz >= c.starts_at - interval '2 days') as stessa`,
          [x.event_id, w.starts_at, w.ends_at])
        const senzaData = daWiki.has(Number(x.event_id)) && !wikiJapan.has(Number(x.event_id))
        if (x.rsource !== 'wiki' || (!stessa && !senzaData)) {
          await client.query(`
            insert into event_run (event_id, reg, starts_at, ends_at, ends_at_known, source)
            values ($1, 'japan', $2, $3, false, $4)`, [x.event_id, w.starts_at, w.ends_at, x.rsource])
        }
        spinte.delete(x.rid)
        swaps.push(x)
      }
    }
    // Al contrario: una copia tenuta per i clear e chiusa alla data Japan del
    // wiki (il passo 6 del piano: vince il wiki) in questo giro, con i clear
    // della sua corsa lasciati fuori e scritti tutti da quella data in poi,
    // cioe' dentro la run del wiki che la segue. La riga della copia diventa
    // la run del wiki (stesso id, nessun clear si tocca), e l'altra si toglie:
    // il tratto della copia prima della data non lo vuole nessuno (la sua
    // finestra e' in conflitto col wiki), restava solo per i clear, e un giro
    // dopo se ne andrebbe comunque. La riga che si toglie non ha ne' clear ne'
    // missioni. La run del wiki che finiva dove cominciava la copia arriva
    // fino alla run del wiki, come la riaprirebbe il passo 7 del piano al giro
    // dopo (fra le due non c'e' piu' niente). Anche questo solo per le righe
    // spinte.
    const { rows: rovesci } = await client.query(`
      select r.id::text as rid, g.id::text as gid, r.event_id::text
      from event_run r
      join event_run g on g.event_id = r.event_id and g.reg = r.reg and g.source = 'wiki' and g.starts_at = r.ends_at
      where r.id = any($1::bigint[]) and r.reg = 'japan' and r.source = 'mirror' and r.ends_at is not null and not r.ends_at_known
        and exists (select 1 from clear c where c.run_id = r.id)
        and not exists (select 1 from clear c where c.run_id = r.id
                        and not (c.created_at >= g.starts_at and c.created_at < coalesce(g.ends_at, 'infinity')))
        and not exists (select 1 from clear c where c.run_id = g.id)
        and not exists (select 1 from mission m where m.run_id in (r.id, g.id))
      order by r.id`, [[...spinte]])
    for (const x of rovesci) {
      const { rows: [g] } = await client.query(`
        delete from event_run where id = $1
        returning ${iso('starts_at')} as starts_at, ${iso('ends_at')} as ends_at, ends_at_known`, [x.gid])
      const { rows: [w] } = await client.query(`
        update event_run r set source = 'wiki', starts_at = $2, ends_at = $3, ends_at_known = $4
        from (select starts_at from event_run where id = $1) old
        where r.id = $1 returning ${iso('old.starts_at')} as starts_at`, [x.rid, g.starts_at, g.ends_at, g.ends_at_known])
      await client.query(`
        update event_run set ends_at = $3
        where event_id = $1 and reg = 'japan' and source = 'wiki' and not ends_at_known and ends_at = $2`,
        [x.event_id, w.starts_at, g.starts_at])
      spinte.delete(x.rid)
    }
    const toccati = new Set([...plan.steps, ...swaps, ...rovesci].map((x) => Number(x.event_id)))
    return { plan, input, swaps, rovesci, toccati }
  }

  // I passi. Il piano di un evento arriva quasi sempre allo stato fermo in
  // una volta, ma non sempre: gli scambi li fa questo script dopo il piano
  // (il tratto della run del wiki che rientra lo adotta la finestra della
  // stessa uscita solo al piano dopo), e una run del wiki ferma per i clear
  // che il piano chiude dopo aver bloccato una finestra la libera solo al
  // piano dopo. Prima quei casi finivano il lavoro la settimana dopo: un
  // giro non era idempotente, e Japan per una settimana diceva un'altra
  // cosa. Ora, nella stessa transazione, gli eventi che un passo ha
  // toccato si rileggono e si ripianificano, fino a PASSI passi; se
  // all'ultimo cambiano ancora lo si dice (la settimana dopo cambierebbe
  // ancora). Con --dry-run tutti i passi si annullano alla fine, insieme.
  const spinte = new Set()
  const passi = []
  let eventi = null
  for (let n = 1; n <= PASSI; n++) {
    const p = await passo(eventi, spinte)
    passi.push({ ...p, eventi })
    if (!p.toccati.size) break
    eventi = p.toccati
  }
  const [primo] = passi
  const ancora = passi.length === PASSI && passi[PASSI - 1].toccati.size ? [...passi[PASSI - 1].toccati] : []
  const { globalRuns } = primo.input
  const aMano = globalRuns.filter((r) => r.source === 'manual').length
  console.log(`\n  finestre Global del gioco da D: ${globalRuns.length} su ${new Set(globalRuns.map((r) => r.event_id)).size} eventi` +
              `${aMano ? ` (${aMano} a mano)` : ''}, da copiare ${primo.plan.windows}`)

  // Il riepilogo dei passi: le scritture si sommano; lo stato (conflitti,
  // finestre saltate, run tenute, eccezioni) e' quello dell'ultimo passo
  // che ha ripianificato l'evento.
  const ultimo = new Map()
  for (const [k, p] of passi.entries()) for (const ev of p.eventi ?? []) ultimo.set(ev, k)
  const stato = (chiave) => passi.flatMap((p, k) => p.plan[chiave].filter((x) => (ultimo.get(Number(x.event_id)) ?? 0) === k))
  const somma = (chiave) => passi.flatMap((p) => p.plan[chiave])
  const plan = {
    insert: somma('insert'), adopt: somma('adopt'), fold: somma('fold'), dropWiki: somma('dropWiki'), dropStray: somma('dropStray'),
    close: somma('close'), update: somma('update'), delete: somma('delete'), restore: somma('restore'), reopen: somma('reopen'),
    place: somma('place'), riprese: somma('riprese'), firstJapan: somma('firstJapan'),
    excluded: stato('excluded'), skip: stato('skip'), conflict: stato('conflict'), keep: stato('keep'),
  }
  // invariate: le copie che il primo passo ha trovato giuste e che nessuna
  // scrittura dopo ha toccato (uno scambio toglie la copia di cui la riga
  // dei clear prende il posto)
  const toccate = new Set([
    ...passi.slice(1).flatMap((p) => p.plan.steps.map((s) => s.id)),
    ...passi.flatMap((p) => [...p.swaps, ...p.rovesci].flatMap((x) => [x.rid, x.gid])),
  ])
  const invariate = primo.plan.invariate.filter((id) => !toccate.has(id)).length
  const swaps = passi.flatMap((p) => p.swaps), rovesci = passi.flatMap((p) => p.rovesci)
  for (const x of plan.excluded) console.log(`    esclusa (${x.rule}): ${label(x.event_id)}, ${finestra(x.window)} — ${x.why}`)

  const { rows: [fuori] } = await client.query(`
    select count(*)::int as n from clear c join event_run r on r.id = c.run_id
    where r.reg = 'japan' and (c.created_at < r.starts_at or c.created_at >= coalesce(r.ends_at, 'infinity'))`)

  const tengo = plan.keep.filter((k) => k.why === 'clear')
  const tengoWiki = plan.keep.filter((k) => k.why === 'wiki')
  const tengoFisse = plan.keep.filter((k) => k.why === 'fissa')
  const tenute = plan.keep.filter((k) => k.why !== 'clear' && k.why !== 'wiki' && k.why !== 'fissa')
  // le copie che lasciano il posto alla run del wiki della stessa uscita
  // (3b del piano) non sono copie che la regola non vuole piu', e nemmeno
  // le run del wiki che lo lasciano a una copia con dei clear, ne' i
  // pezzetti senza clear che lasciano la finestra alla copia dei clear
  const riunite = new Set([...plan.fold.map((x) => x.copy), ...plan.riprese.map((x) => x.copy)])
  const tolte = plan.delete.filter((x) => x.source === 'mirror' && !riunite.has(x.id))
  console.log(`\n  ricorrenze Japan:`)
  console.log(`    nuove dallo specchio                          ${plan.insert.length}   (su ${new Set(plan.insert.map((x) => x.event_id)).size} eventi, ${plan.firstJapan.length} alla prima run Japan)`)
  console.log(`    del wiki diventate copie (stessa uscita)      ${plan.adopt.length}`)
  console.log(`      di cui al posto della copia che c'era      ${plan.fold.length}`)
  console.log(`    del wiki tolte, la copia ha dei clear         ${plan.dropWiki.length}`)
  console.log(`    del wiki tolte, un'altra e' alla data         ${plan.dropStray.length}`)
  console.log(`    del wiki chiuse all'inizio di una copia       ${plan.close.filter((x) => x.was.source === 'wiki').length}`)
  console.log(`    copie aggiornate                              ${plan.update.length}`)
  console.log(`    invariate                                     ${invariate}`)
  console.log(`    saltate, c'e' una finestra a mano             ${plan.skip.length}`)
  console.log(`    finestre in conflitto, non copiate            ${plan.conflict.length}`)
  console.log(`    copie tolte, la regola non le vuole piu'      ${tolte.length}`)
  console.log(`    copie tornate run del wiki                    ${plan.restore.length}`)
  console.log(`    del wiki riaperte (non comincia piu' niente)  ${plan.reopen.length}`)
  console.log(`    del wiki messe alla data Japan del wiki       ${plan.place.length}`)
  console.log(`    copie con clear chiuse prima di un'altra run  ${plan.close.filter((x) => x.was.source === 'mirror').length}`)
  console.log(`    copie con clear che riprendono la finestra    ${plan.riprese.length}`)
  console.log(`    copie lasciate com'erano (a mano, conflitto)  ${tenute.length}`)
  console.log(`    scambiate per tenere i clear nella loro corsa ${swaps.length + rovesci.length}`)
  for (const x of swaps) console.log(`      ${label(x.event_id)}: la run ${x.rid} diventa la copia (era la ${x.gid})`)
  for (const x of rovesci) console.log(`      ${label(x.event_id)}: la run ${x.rid} diventa la run del wiki alla sua data (era la ${x.gid})`)
  if (passi.length > 1) {
    console.log(`    passi (gli eventi toccati si ripianificano)   ${passi.length}   (${passi.slice(1).map((p, k) => `${k + 2}° passo ${p.eventi.size} eventi, ${p.plan.steps.length + p.swaps.length + p.rovesci.length} scritture`).join('; ')})`)
  }
  if (fuori.n) console.log(`    clear Japan scritti fuori dalla loro run       ${fuori.n}   (da rivedere a mano)`)
  for (const k of tengo) {
    console.log(`  tengo la run ${k.id} (evento ${k.event_id}, japan): lo specchio non la vuole piu' ma ci sono dei clear`)
  }
  for (const k of tengoWiki) {
    console.log(`  tengo la run ${k.id} (evento ${k.event_id}, japan): la run del wiki non e' piu' alla data Japan del wiki ma ci sono dei clear`)
  }
  for (const k of tengoFisse) {
    console.log(`  tengo la run ${k.id} (evento ${k.event_id}, japan): resta com'era, spostarla o chiuderla lascerebbe dei clear fuori dalla loro corsa`)
  }
  if (ancora.length) {
    console.log(`  attenzione: lo specchio cambia ancora al passo ${PASSI} (eventi ${ancora.join(', ')}): ` +
                `il giro dopo potrebbe cambiarli ancora, da rivedere`)
  }
  for (const s of plan.skip) console.log(`      ${label(s.event_id)}: ${finestra(s.window)} tocca la run a mano ${s.manual}`)
  for (const c of plan.conflict) {
    const perche = c.why === 'wiki' ? `il wiki dice uscito su Japan il ${day(c.wiki).slice(0, 10)}: vince il wiki`
      : c.why === 'run' ? `contro la run ${c.run} (${c.source})` : `piano non applicabile, ${c.detail}`
    console.log(`      conflitto ${label(c.event_id)}: ${c.window ? `${finestra(c.window)} ` : ''}${perche}`)
  }
  const elenco = (titolo, xs, riga) => {
    if (!xs.length) return
    console.log(`    ${titolo}: ${xs.length}`)
    for (const x of VERBOSE ? xs : xs.slice(0, 5)) console.log(`      ${riga(x)}`)
    if (!VERBOSE && xs.length > 5) console.log(`      ... (--verbose per tutte)`)
  }
  elenco('eventi alla prima run Japan (da rivedere per globalOnly)', plan.firstJapan, (id) => label(id))
  elenco('chiuse all\'inizio di una copia', plan.close, (x) => `${label(x.event_id)}: la run ${x.id} (${x.was.source}) chiusa al ${day(x.ends_at)}`)
  const alPosto = new Map(plan.fold.map((f) => [f.id, f.copy]))
  elenco('adottate', plan.adopt, (x) => `${label(x.event_id)}: la run ${x.id} del ${day(x.was.starts_at)} ora ${finestra(x)}`
    + (alPosto.has(x.id) ? ` (al posto della copia ${alPosto.get(x.id)})` : ''))
  elenco('tolte', tolte, (x) => `${label(x.event_id)}: la run ${x.id}, ${finestra(x)}`)
  elenco('del wiki tolte accanto a una copia con clear', plan.dropWiki, (x) => `${label(x.event_id)}: la run ${x.id} (resta la copia ${x.copy})`)
  elenco('del wiki tolte, un\'altra e\' alla data del wiki', plan.dropStray, (x) => `${label(x.event_id)}: la run ${x.id} (alla data c'e' la ${x.at ?? 'nuova'})`)
  elenco('copie con clear che riprendono la finestra', plan.riprese, (x) => `${label(x.event_id)}: la run ${x.id}${x.copy ? ` (al posto della copia ${x.copy})` : ''}`)
  elenco('tornate del wiki', plan.restore, (x) => `${label(x.event_id)}: la run ${x.id} dal ${day(x.starts_at)}`)
  elenco('riaperte', plan.reopen, (x) => `${label(x.event_id)}: la run ${x.id} ${x.ends_at ? `fino al ${day(x.ends_at)}` : 'aperta'}`)
  elenco('messe alla data del wiki', plan.place, (x) => `${label(x.event_id)}: ${x.id ? `la run ${x.id} (era ${x.was.source}, ${finestra(x.was)})` : 'una run nuova'} ora ${finestra(x)}`)

  // 3. le carte. Per quelle che solo il gioco conosce la data Global e' il
  // giorno UTC di open_at: l'istante del datamine dice il giorno giapponese
  const { rows: rel } = await client.query(`
    select card_id::text, reg::text, released_at::text, source from card_release`)
  const cards = planCardMirror({
    globalReleases: rel.filter((r) => r.reg === 'global'),
    japanReleases: rel.filter((r) => r.reg === 'japan'),
    openAt,
    rules,
  })
  if (cards.delete.length) {
    await client.query(`delete from card_release where reg = 'japan' and source = 'mirror' and card_id = any($1::bigint[])`,
      [cards.delete.map((x) => x.card_id)])
  }
  const scrivi = [...cards.insert, ...cards.update]
  if (scrivi.length) {
    // "where source = 'mirror'": un'uscita Japan del wiki o a mano non si
    // sovrascrive mai, anche se il piano sbagliasse
    await client.query(`
      insert into card_release (card_id, reg, released_at, source)
      select d.card_id, 'japan', d.released_at, 'mirror' from unnest($1::bigint[], $2::date[]) as d(card_id, released_at)
      on conflict (card_id, reg) do update set released_at = excluded.released_at
      where card_release.source = 'mirror'`, [scrivi.map((x) => x.card_id), scrivi.map((x) => x.released_at)])
  }
  console.log(`\n  uscite Japan delle carte (uscite su Global dal ${cards.since}):`)
  console.log(`    nuove dallo specchio                          ${cards.insert.length}`)
  console.log(`    aggiornate                                    ${cards.update.length}`)
  console.log(`    invariate                                     ${cards.unchanged}`)
  console.log(`    tolte, la regola non le vuole piu'            ${cards.delete.length}`)
  console.log(`    con la data Japan del wiki o a mano           ${cards.skip.length}`)
  console.log(`    il giorno dopo Global (dalle 15:00 UTC)       ${cards.shifted.length}`)
  for (const x of cards.shifted) console.log(`      ${x.card_id}: Global ${x.global}, Japan ${x.japan}`)
  if (cards.excluded.length) console.log(`    solo Global (regole)                          ${cards.excluded.length}`)
  for (const x of VERBOSE ? cards.insert : []) console.log(`      ${x.card_id} dal ${x.released_at}`)

  const after = await statusNow()
  console.log(`\n  stato su Japan (una ricorrenza per evento, come la lista del sito):`)
  console.log(`    prima  ${before}`)
  console.log(`    dopo   ${after}`)

  if (DRY) {
    await client.query('rollback')
    console.log('\n  --dry-run: niente e\' stato scritto')
  } else {
    await client.query('commit')
    console.log('\n  fatto.')
  }
} catch (err) {
  await client.query('rollback')
  console.error(`\n  specchio fallito, niente e' stato scritto: ${err.message}\n`)
  await client.end(); process.exit(1)
}
await client.end()
