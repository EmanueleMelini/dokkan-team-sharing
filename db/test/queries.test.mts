// Verifica le query che alimentano le pagine, chiamando le funzioni VERE
// di lib/queries.ts sui dati veri importati — non che compilino, che e'
// un'altra cosa.
//
// La versione precedente teneva una copia a mano dell'SQL: una regressione
// in lib/queries.ts (lo spareggio tolto dall'ordine, il totale sparito)
// restava verde, perche' il test provava la copia e non il codice.
//
// Gira solo su un database di test (nome che finisce per _test) con la
// fixture e i dati importati: lo prepara npm run db:test. Da solo, dopo un
// db:test, con  npm run db:test:queries.
//
// I valori attesi si ricavano con SQL scritto qui, indipendente da quello
// sotto prova. E i casi che la fixture non ha (repliche annunciate, nomi
// con _ e %, clear a pari merito) li crea qui, sul database di test, e li
// toglie alla fine.
import type { ClearRow, EventKind, EventRow, Region, StageRow } from '@/lib/queries'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = ''): boolean {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
  return ok
}
// Una lista vuota non prova niente: [].every() e' sempre vero. Ogni
// verifica "per tutte le righe" passa da qui, e senza righe e' rossa.
function tutte<T>(nome: string, righe: T[], ok: (x: T) => boolean, dettaglio = ''): boolean {
  if (righe.length === 0) return check(nome, false, 'nessuna riga da verificare')
  const male = righe.filter((x) => !ok(x)).length
  return check(nome, male === 0, male ? `${male} righe su ${righe.length} non tornano` : dettaglio)
}
const stessi = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const quando = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d))

// ------------------------------------------------------------ il bersaglio

// La stessa regola delle suite shell (db/test/common.sh): TEST_DATABASE_URL,
// e solo se il nome finisce per _test. lib/db.ts legge DATABASE_URL quando
// viene importato, quindi la si imposta prima, e l'import e' dinamico.
const url = process.env.TEST_DATABASE_URL ?? ''
let nomeDb = ''
try { nomeDb = decodeURIComponent(new URL(url).pathname.slice(1)) } catch { /* resta vuoto */ }
if (!nomeDb.endsWith('_test')) {
  console.error('\n  mi fermo: TEST_DATABASE_URL deve puntare a un database il cui nome finisce per _test')
  console.error('  (lancialo con  npm run db:test:queries,  o dentro  npm run db:test)\n')
  process.exit(2)
}
process.env.DATABASE_URL = url
{
  const u = new URL(url)
  console.log(`  database: ${u.hostname}:${u.port || 5432}/${nomeDb} come ${u.username || '(default)'}`)
}

const { db } = await import('@/lib/db')
const Q = await import('@/lib/queries')

async function righe<T>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[]
}
async function valore<T>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const r = (await db.query(text, params)).rows[0] as Record<string, unknown> | undefined
  return r ? (Object.values(r)[0] as T) : undefined
}

// Una sezione che si rompe (un'eccezione dalla query sotto prova, un dato
// che manca) e' una verifica rossa, e le altre girano comunque.
async function sezione(titolo: string, fn: () => Promise<void>) {
  console.log(`\n${titolo}`)
  try {
    await fn()
  } catch (err) {
    check(`${titolo}: interrotta da un errore`, false, (err as Error).message)
  }
}

const GRANDE = 100_000   // un limit che contiene tutto, per avere la lista intera
const FRIEZA = 'Ultimate Red Zone: Frieza'
// Eventi di prova: id lontani dai pageid del wiki (oggi sotto il milione)
const T = {
  ricerca: '900000001',    // nome con _ e %, una run Global in corso
  esca: '900000002',       // nome che un _ o un % "jolly" confonderebbero col primo
  inArrivo: '900000003',   // Japan: due run future
  concluse: '900000004',   // Japan: due run concluse
  miste: '900000005',      // Japan: una conclusa e una futura
  chiudePresto: '900000006', // Global: in corso, chiude fra 3 giorni
  chiudeTardi: '900000007',  // Global: in corso, chiude fra 30 giorni
}
const NOMI: Record<string, string> = {
  [T.ricerca]: 'Prova ricerca_letterale 100% [test]',
  [T.esca]: 'Prova ricercaXletterale 1000 [test]',
  [T.inArrivo]: 'Prova run: due in arrivo [test]',
  [T.concluse]: 'Prova run: solo concluse [test]',
  [T.miste]: 'Prova run: conclusa e in arrivo [test]',
  [T.chiudePresto]: 'Prova run: chiude presto [test]',
  [T.chiudeTardi]: 'Prova run: chiude tardi [test]',
}
const NOTA_PAREGGIO = '[test] pareggio'

// cio' che la preparazione crea, per toglierlo alla fine
const creati = { eventi: Object.values(T), runs: [] as string[], clear: [] as string[] }
const inizio = new Map<string, Date>()   // chiave: evento|etichetta della run

async function pulisci() {
  await db.query(`delete from clear where id in
                    (select clear_id from clear_version where note = $1)`, [NOTA_PAREGGIO])
  await db.query('delete from event_run where id = any($1::bigint[])', [creati.runs])
  await db.query('delete from event where id = any($1::bigint[])', [creati.eventi])
}

let connesso = false
let pronto = false
let TIER1 = ''   // 5001, stage 1, z_hard: i clear a pari merito creati qui
let TIER3 = ''   // 5001, stage 3, ultra: i clear della fixture

try {
  await sezione('preparazione', async () => {
    const corrente = await valore<string>('select current_database()')
    connesso = check('il server conferma il database di test', corrente === nomeDb, `${corrente}`)
    if (!connesso) throw new Error('database diverso da quello atteso')
    check('la fixture c\'e\' (evento 5001)',
          (await valore<string>(`select name from event_text where event_id = 5001 and locale = 'en'`)) === FRIEZA)
    const importati = Number(await valore('select count(*) from event where wiki_title is not null'))
    check('i dati importati ci sono (piu\' di una pagina di eventi)', importati > Q.EVENTI_PER_PAGINA,
          `${importati} eventi dal wiki`)

    // i resti di un giro interrotto, se ce ne sono
    await db.query(`delete from event_run where event_id = 5001 and reg = 'japan'
                      and starts_at > now() + interval '100 days'`)
    await pulisci()

    await db.query(`insert into event (id, kind, imported_from)
                    select unnest($1::bigint[]), 'other', 'manual'`, [creati.eventi])
    await db.query(`insert into event_text (event_id, locale, name, source)
                    select unnest($1::bigint[]), 'en', unnest($2::text[]), 'official'`,
                   [creati.eventi, creati.eventi.map((id) => NOMI[id])])
    // l'inizio atteso e' quello che il database restituisce, non uno ricalcolato
    const piano: [string, Region, string, string | null, string][] = [
      [T.ricerca, 'global', '-1 day', null, 'in corso'],
      [T.esca, 'global', '-1 day', null, 'in corso'],
      // fine nota e relativa a now(): l'ordine di Ongoing si prova senza
      // dipendere da quali finestre vere del gioco sono aperte oggi
      [T.chiudePresto, 'global', '-1 day', '3 days', 'presto'],
      [T.chiudeTardi, 'global', '-1 day', '30 days', 'tardi'],
      [T.inArrivo, 'japan', '10 days', '12 days', 'vicina'],
      [T.inArrivo, 'japan', '50 days', '52 days', 'lontana'],
      [T.concluse, 'japan', '-100 days', '-90 days', 'vecchia'],
      [T.concluse, 'japan', '-50 days', '-40 days', 'recente'],
      [T.miste, 'japan', '-30 days', '-20 days', 'conclusa'],
      [T.miste, 'japan', '40 days', '45 days', 'futura'],
      // la replica annunciata di 5001 su Japan, dopo quella in corso
      ['5001', 'japan', '120 days', '127 days', 'replica'],
    ]
    for (const [ev, reg, da, a, etichetta] of piano) {
      const [r] = await righe<{ id: string; starts_at: Date }>(`
        insert into event_run (event_id, reg, starts_at, ends_at)
        values ($1::bigint, $2::region, now() + $3::interval, now() + $4::interval)
        returning id::text, starts_at`, [ev, reg, da, a])
      creati.runs.push(r.id)
      inizio.set(`${ev}|${etichetta}`, r.starts_at)
    }
    check('create le ricorrenze di prova', creati.runs.length === piano.length, `${creati.runs.length}`)

    TIER1 = (await valore<string>(`select st.id::text from stage_tier st join stage s on s.id = st.stage_id
                                   where s.event_id = 5001 and s.seq = 1 and st.difficulty = 'z_hard'`)) ?? ''
    TIER3 = (await valore<string>(`select st.id::text from stage_tier st join stage s on s.id = st.stage_id
                                   where s.event_id = 5001 and s.seq = 3 and st.difficulty = 'ultra'`)) ?? ''
    check('le difficolta\' della fixture', TIER1 !== '' && TIER3 !== '', `${TIER1}, ${TIER3}`)
    check('lo stage 1 di 5001 parte senza clear',
          Number(await valore('select count(*) from clear where stage_tier_id = $1', [TIER1])) === 0)

    // Tre clear identici per ordine (nessuna prova, punteggio 0, 20 turni):
    // decide solo lo spareggio sull'id. Passano da submit_clear, come i veri.
    const runGl = await valore<string>(`select id::text from event_run where event_id = 5001 and reg = 'global'
                                          and starts_at <= now() and (ends_at is null or ends_at > now())`)
    const assetti = new Map([
      ['11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000001'],
      ['22222222-2222-2222-2222-222222222222', 'b1b1b1b1-0000-0000-0000-000000000001'],
      ['33333333-3333-3333-3333-333333333333', 'c1c1c1c1-0000-0000-0000-000000000001'],
    ])
    const invia = async (autore: string) => {
      const id = await valore<string>(
        `select submit_clear($1::uuid, $2::bigint, $3::bigint, $4::uuid,
                             false, false, 20::smallint, $5, 'en')::text`,
        [autore, runGl, TIER1, assetti.get(autore), NOTA_PAREGGIO])
      if (id) creati.clear.push(id)
    }
    for (const autore of assetti.keys()) await invia(autore)
    // Senza spareggio i pari merito escono nell'ordine in cui stanno sul
    // disco, cioe' quello d'inserimento. Se per caso e' gia' l'ordine per id
    // (una volta su sei) lo spareggio non si vede: si rifa' il primo, che
    // finisce in fondo, finche' i due ordini non differiscono.
    let fisico: string[] = []
    for (let i = 0; i < 20; i++) {
      const r = await righe<{ id: string; autore: string }>(`select id::text, author_id::text as autore
        from clear where id = any($1::uuid[]) order by ctid`, [creati.clear])
      fisico = r.map((x) => x.id)
      if (r.length < 3 || !stessi(fisico, [...fisico].sort())) break
      await db.query('delete from clear where id = $1::uuid', [r[0].id])
      creati.clear = creati.clear.filter((x) => x !== r[0].id)
      await invia(r[0].autore)
    }
    check('i pari merito sul disco non sono gia\' in ordine di id',
          fisico.length === 3 && !stessi(fisico, [...fisico].sort()))
    pronto = check('creati tre clear a pari merito', creati.clear.length === 3)
  })

  if (!pronto) check('preparazione completa', false, 'le verifiche dopo girano su dati incompleti')
  // senza il database giusto non c'e' niente da verificare, ne' da pulire
  if (connesso) await (async () => {
    // ------------------------------------------------------------ listEvents

    const combo: { nome: string; reg: Region; kind: EventKind | null; pagine: number[] }[] = [
      { nome: 'Global, tutti', reg: 'global', kind: null, pagine: [Q.EVENTI_PER_PAGINA, 7] },
      { nome: 'Global, Extreme Z-Battle', reg: 'global', kind: 'zbattle', pagine: [Q.EVENTI_PER_PAGINA] },
      { nome: 'Japan, tutti', reg: 'japan', kind: null, pagine: [Q.EVENTI_PER_PAGINA] },
    ]

    // Il conteggio "senza pagine", scritto qui: gli eventi con un nome e con
    // almeno una ricorrenza in quella regione.
    const contaEventi = async (reg: Region, kind: EventKind | null) => Number(await valore(`
      select count(*) from event e
      where exists (select 1 from event_text et where et.event_id = e.id and et.locale = 'en')
        and exists (select 1 from event_run r where r.event_id = e.id and r.reg = $1::region)
        and ($2::event_kind is null or e.kind = $2::event_kind)`, [reg, kind]))

    async function sfoglia(reg: Region, kind: EventKind | null, size: number, atteso: number) {
      const ids: string[] = []
      const totali = new Set<number>()
      let pagine = 0
      // il tetto ferma il giro se l'offset venisse ignorato
      for (let offset = 0; offset <= atteso + size; offset += size) {
        const r = await Q.listEvents({ reg, kind, limit: size, offset })
        if (r.length) pagine++
        for (const x of r) { ids.push(x.id); totali.add(x.total) }
        if (r.length < size) break
      }
      return { ids, totali, pagine }
    }

    await sezione('listEvents: totale e pagine', async () => {
      for (const c of combo) {
        const atteso = await contaEventi(c.reg, c.kind)
        if (!check(`${c.nome}: piu' di una pagina di eventi`, atteso > Q.EVENTI_PER_PAGINA, `${atteso}`)) continue
        const p1 = await Q.listEvents({ reg: c.reg, kind: c.kind })
        check(`${c.nome}: la prima pagina ne ha ${Q.EVENTI_PER_PAGINA}`, p1.length === Q.EVENTI_PER_PAGINA, `${p1.length}`)
        check(`${c.nome}: total = il conteggio senza pagine`, p1[0]?.total === atteso,
              `total ${p1[0]?.total}, atteso ${atteso}`)
        tutte(`${c.nome}: total uguale su ogni riga`, p1, (x) => x.total === atteso)
        for (const size of c.pagine) {
          const { ids, totali, pagine } = await sfoglia(c.reg, c.kind, size, atteso)
          const distinti = new Set(ids).size
          check(`${c.nome}, pagine da ${size}: ogni evento una volta sola, nessuno perso`,
                ids.length === atteso && distinti === atteso,
                `${pagine} pagine, ${ids.length} righe, ${distinti} distinte, attese ${atteso}`)
          check(`${c.nome}, pagine da ${size}: lo stesso total su tutte`, totali.size === 1 && totali.has(atteso),
                [...totali].join(', '))
        }
      }
      const oltre = await Q.listEvents({ reg: 'global', offset: GRANDE })
      check('oltre l\'ultima pagina: nessuna riga, nessun errore', oltre.length === 0)
    })

    let glob: EventRow[] = []
    let jp: EventRow[] = []
    const riga = (lista: EventRow[], id: string) => lista.find((x) => x.id === id)

    await sezione('listEvents: ordine e spareggio', async () => {
      glob = await Q.listEvents({ reg: 'global', limit: GRANDE })
      jp = await Q.listEvents({ reg: 'japan', limit: GRANDE })
      check('la lista intera Global', glob.length === await contaEventi('global', null), `${glob.length}`)
      let pareggi = 0
      let fuori = ''
      for (let i = 1; i < glob.length; i++) {
        const a = glob[i - 1], b = glob[i]
        const ta = a.starts_at.getTime(), tb = b.starts_at.getTime()
        if (ta === tb) pareggi++
        if (ta < tb || (ta === tb && !(BigInt(a.id) > BigInt(b.id)))) fuori ||= `${a.id} prima di ${b.id}`
      }
      // senza date uguali lo spareggio non entra mai in gioco, e la prova
      // qui sotto sarebbe verde per caso
      check('ci sono eventi con la stessa data di inizio', pareggi > 0, `${pareggi} coppie`)
      check('ordinati per data decrescente, a pari data per id decrescente', glob.length > 1 && !fuori, fuori)
      const { ids } = await sfoglia('global', null, Q.EVENTI_PER_PAGINA, glob.length)
      check('le pagine in fila danno lo stesso ordine della lista intera',
            stessi(ids, glob.map((x) => x.id)), `${ids.length} contro ${glob.length}`)
      tutte('tipi: total, stages e clears numeri; starts_at Date; is_eza e ends_at_known booleani', glob,
            (x) => typeof x.total === 'number' && typeof x.stages === 'number' && typeof x.clears === 'number'
              && x.starts_at instanceof Date && typeof x.is_eza === 'boolean'
              && typeof x.ends_at_known === 'boolean' && typeof x.id === 'string')
    })

    await sezione('listEvents: fra gli eventi in corso prima chi chiude', async () => {
      const att = await Q.listEvents({ reg: 'global', status: 'active', limit: GRANDE })
      check('ci sono eventi in corso con una fine nota', att.filter((x) => x.ends_at).length >= 2,
            `${att.filter((x) => x.ends_at).length}`)
      const primoSenza = att.findIndex((x) => !x.ends_at)
      const ultimoCon = att.map((x) => !!x.ends_at).lastIndexOf(true)
      check('prima tutti quelli con una fine, poi gli altri', primoSenza === -1 || ultimoCon < primoSenza,
            `ultimo con fine ${ultimoCon}, primo senza ${primoSenza}`)
      const fini = att.filter((x) => x.ends_at).map((x) => x.ends_at!.getTime())
      check('le fini in ordine crescente', fini.every((t, i) => i === 0 || fini[i - 1] <= t))
      const ip = att.findIndex((x) => x.id === T.chiudePresto)
      const it = att.findIndex((x) => x.id === T.chiudeTardi)
      check('chi chiude fra 3 giorni viene prima di chi chiude fra 30', ip >= 0 && it >= 0 && ip < it, `${ip} ${it}`)
      tutte('tipi: ends_at Date o null, source fra wiki, game e manual', att,
            (x) => (x.ends_at === null || x.ends_at instanceof Date) && ['wiki', 'game', 'manual'].includes(x.source))
      // l'ordine per data di inizio resta quello della lista senza filtro
      const tutti = await Q.listEvents({ reg: 'global', limit: GRANDE })
      check('senza filtro di stato l\'ordine non guarda la fine', tutti.length > 1 &&
            tutti.every((x, i) => i === 0 || tutti[i - 1].starts_at.getTime() >= x.starts_at.getTime()))
    })

    await sezione('getMissions: le missioni della ricorrenza mostrata', async () => {
      // un evento con missioni legate a una run e altre senza scadenza propria
      const [ev] = await righe<{ ev: string; run: string }>(`
        select m.event_id::text as ev, min(m.run_id)::text as run from mission m
        where m.run_id is not null
          and exists (select 1 from mission n where n.event_id = m.event_id and n.run_id is null)
        group by m.event_id order by m.event_id limit 1`)
      if (!check('c\'e\' un evento con missioni di una run e missioni senza scadenza', !!ev)) return
      const lista = await Q.getMissions(ev.ev, ev.run)
      const attese = await righe<{ id: string }>(`select id::text from mission
        where event_id = $1::bigint and (run_id is null or run_id = $2::bigint)`, [ev.ev, ev.run])
      check('tutte e sole le missioni della run e quelle senza scadenza',
            stessi(lista.map((m) => m.id).sort(), attese.map((m) => m.id).sort()), `${lista.length} contro ${attese.length}`)
      const altre = await righe<{ id: string }>(`select id::text from mission
        where event_id = $1::bigint and run_id is not null and run_id <> $2::bigint`, [ev.ev, ev.run])
      check('nessuna missione di un\'altra run', !lista.some((m) => altre.some((a) => a.id === m.id)))
      const seq = lista.map((m) => m.seq ?? Infinity)
      check('in ordine di gioco (seq)', seq.every((x, i) => i === 0 || seq[i - 1] <= x))
      tutte('ogni missione ha una descrizione e premi con nome e quantita\' numerica', lista,
            (m) => typeof m.description === 'string' && m.description.length > 0 && Array.isArray(m.rewards)
              && m.rewards.every((r) => typeof r.name === 'string' && r.name.length > 0 && typeof r.quantity === 'number'))
      const det = await Q.getEvent(ev.ev, 'global')
      check('getEvent espone la run mostrata', typeof det?.run_id === 'string' && det.run_id.length > 0, `${det?.run_id}`)
      check('nessuna missione per un evento che non ne ha', (await Q.getMissions(T.ricerca, null)).length === 0)
    })

    await sezione('copertina e legami fra EZA e Super EZA', async () => {
      // Il database di test non scarica le immagini: nessuna carta ha una
      // miniatura, e null contro null passerebbe anche con il join rotto.
      // Se ne da' una, finta, alla carta di copertina, e la si toglie dopo.
      const [cop] = await righe<{ ev: string; card: string; thumb: string | null }>(`
        select e.id::text as ev, c.id::text as card, c.thumb_key as thumb
        from event e join card c on c.id = e.cover_card_id
        where e.banner_key is null
          and exists (select 1 from event_run r where r.event_id = e.id and r.reg = 'global')
        order by e.id limit 1`)
      if (check('c\'e\' un evento senza banner con una carta di copertina', !!cop)) {
        const finta = `test/copertina-${cop.card}.webp`
        await db.query(`insert into asset (key, kind, content_type, byte_size, checksum)
                        values ($1, 'card_thumb', 'image/webp', 1, 'test') on conflict (key) do nothing`, [finta])
        await db.query('update card set thumb_key = $1 where id = $2::bigint', [finta, cop.card])
        try {
          const det = await Q.getEvent(cop.ev, 'global')
          check('getEvent: la miniatura della copertina', det?.cover_thumb_key === finta, `${det?.cover_thumb_key}`)
          const nella = (await Q.listEvents({ reg: 'global', limit: GRANDE })).find((x) => x.id === cop.ev)
          check('listEvents: la stessa miniatura', nella?.cover_thumb_key === finta, `${nella?.cover_thumb_key}`)
        } finally {
          await db.query('update card set thumb_key = $1 where id = $2::bigint', [cop.thumb, cop.card])
          await db.query('delete from asset where key = $1', [finta])
        }
      }
      const coppia = (await righe<{ sup: string; norm: string }>(`select r1.event_id::text as sup, r2.event_id::text as norm
        from event_game_ref r1 join event_game_ref r2 on r2.game_kind = r1.game_kind and r2.game_id = r1.related_game_id
        where r1.related_game_id is not null order by r1.event_id limit 1`))[0]
      if (check('c\'e\' una Super EZA legata alla sua EZA normale', !!coppia)) {
        const daSuper = await Q.getEzaLinks(coppia.sup)
        check('dalla Super EZA si arriva alla normale', daSuper.normal?.id === coppia.norm && daSuper.supers.length === 0,
              JSON.stringify(daSuper))
        const daNormale = await Q.getEzaLinks(coppia.norm)
        check('dalla normale si arriva alla Super', daNormale.normal === null && daNormale.supers.some((x) => x.id === coppia.sup),
              JSON.stringify(daNormale))
      }
      const qualunque = await Q.getEzaLinks(T.ricerca)
      check('un evento qualsiasi non ha legami', qualunque.normal === null && qualunque.supers.length === 0)
    })

    await sezione('quale ricorrenza rappresenta l\'evento', async () => {
      const attiva = await valore<Date>(`select starts_at from event_run where event_id = 5001 and reg = 'japan'
                                           and starts_at <= now() and (ends_at is null or ends_at > now())`)
      const replica = inizio.get('5001|replica')
      const ok = check('5001 su Japan: una run in corso e una replica annunciata dopo',
                       attiva instanceof Date && replica instanceof Date && replica > attiva)
      const scelta = (nome: string, r: { status: string | null; starts_at: Date | null } | null | undefined,
                      status: string, da: Date | undefined) =>
        check(nome, !!r && !!da && r.status === status && r.starts_at instanceof Date
                    && r.starts_at.getTime() === da.getTime(),
              `${r?.status ?? 'nessuna riga'} dal ${quando(r?.starts_at)}, atteso ${status} dal ${quando(da)}`)
      if (ok) {
        scelta('listEvents, 5001 su Japan: la run in corso, non la replica', riga(jp, '5001'), 'active', attiva)
        scelta('getEvent, 5001 su Japan: la run in corso, non la replica',
               await Q.getEvent('5001', 'japan'), 'active', attiva)
      }
      for (const [id, nome, status, etichetta] of [
        [T.inArrivo, 'due in arrivo: la piu\' vicina', 'upcoming', 'vicina'],
        [T.concluse, 'solo concluse: la piu\' recente', 'past', 'recente'],
        [T.miste, 'conclusa e in arrivo: quella in arrivo', 'upcoming', 'futura'],
      ]) {
        scelta(`listEvents, ${nome}`, riga(jp, id), status, inizio.get(`${id}|${etichetta}`))
        scelta(`getEvent, ${nome}`, await Q.getEvent(id, 'japan'), status, inizio.get(`${id}|${etichetta}`))
      }

      // il filtro per stato si applica alla ricorrenza scelta
      const ids = async (status: 'active' | 'upcoming' | 'past') => {
        const r = await Q.listEvents({ reg: 'japan', status, limit: GRANDE })
        tutte(`filtro ${status}: solo righe in quello stato`, r, (x) => x.status === status)
        return new Set(r.map((x) => x.id))
      }
      const inArrivo = await ids('upcoming')
      check('filtro in arrivo: gli eventi di prova con una run futura, non 5001',
            inArrivo.has(T.inArrivo) && inArrivo.has(T.miste) && !inArrivo.has('5001') && !inArrivo.has(T.concluse))
      const inCorso = await ids('active')
      check('filtro in corso: 5001 c\'e\'', inCorso.has('5001') && !inCorso.has(T.inArrivo))
      const conclusi = await ids('past')
      check('filtro conclusi: solo quello senza run future', conclusi.has(T.concluse) && !conclusi.has(T.miste))
    })

    await sezione('la ricerca prende i caratteri alla lettera', async () => {
      const cerca = async (s: string) => (await Q.listEvents({ reg: 'global', search: s, limit: GRANDE }))
      for (const ch of ['_', '%']) {
        const attesi = glob.filter((x) => x.name.includes(ch)).map((x) => x.id).sort()
        const r = await cerca(ch)
        const trovati = r.map((x) => x.id).sort()
        check(`"${ch}": ci sono nomi che lo contengono, e non tutti`,
              attesi.length > 0 && attesi.length < glob.length, `${attesi.length} su ${glob.length}`)
        check(`"${ch}": trova solo i nomi che lo contengono davvero`, stessi(trovati, attesi),
              `${trovati.length} trovati, ${attesi.length} attesi`)
        check(`"${ch}": total = le righe trovate`, r.length > 0 && r[0].total === r.length)
      }
      // l'esca ha "X" dove l'altro ha "_", e "1000" dove l'altro ha "100%"
      check('"ricerca_letterale": il _ non vale un carattere qualsiasi',
            stessi((await cerca('ricerca_letterale')).map((x) => x.id), [T.ricerca]))
      check('"100%": il % non vale una sequenza qualsiasi',
            stessi((await cerca('100%')).map((x) => x.id), [T.ricerca]))
      check('maiuscole e minuscole non contano',
            stessi((await cerca('PROVA RICERCA_LETTERALE')).map((x) => x.id), [T.ricerca]))
      check('"red zone: frieza" trova 5001', (await cerca('red zone: frieza')).some((x) => x.id === '5001'))
      check('una ricerca senza risultati: lista vuota', (await cerca('nessun evento si chiama cosi\'')).length === 0)
    })

    await sezione('livelli EZA e stage', async () => {
      const eza = await valore<string>(`
        select e.id::text from event e
        where e.kind = 'zbattle'
          and exists (select 1 from stage_tier st where st.event_id = e.id)
          and not exists (select 1 from stage_tier st where st.event_id = e.id and st.difficulty <> 'eza_level')
          and exists (select 1 from event_run r where r.event_id = e.id and r.reg = 'global')
        order by e.id limit 1`)
      if (!check('c\'e\' un evento EZA (dai dati importati)', !!eza)) return
      const rEza = riga(glob, eza!)
      check('un\'EZA ha is_eza vero', rEza?.is_eza === true, `${eza}: ${rEza?.is_eza}`)
      check('una sfida (5001) ha is_eza falso', riga(glob, '5001')?.is_eza === false)
      const vuoto = riga(glob, T.ricerca)
      check('un evento senza stage: is_eza falso (non null) e 0 stage',
            vuoto?.is_eza === false && vuoto.stages === 0)
      const nEza = Number(await valore(`
        select count(*) from event e
        where exists (select 1 from event_text et where et.event_id = e.id and et.locale = 'en')
          and exists (select 1 from event_run r where r.event_id = e.id and r.reg = 'global')
          and exists (select 1 from stage_tier st where st.event_id = e.id)
          and not exists (select 1 from stage_tier st where st.event_id = e.id and st.difficulty <> 'eza_level')`))
      check('quanti EZA nella lista: come nel database', glob.filter((x) => x.is_eza).length === nEza,
            `${glob.filter((x) => x.is_eza).length}, attesi ${nEza}`)
      check('5001 ha 3 stage', riga(glob, '5001')?.stages === 3)
      const stEza = Number(await valore('select count(*) from stage where event_id = $1', [eza]))
      check('stage dell\'EZA: come nel database', rEza?.stages === stEza, `${rEza?.stages}, attesi ${stEza}`)
    })

    await sezione('clear contati per regione', async () => {
      const conta = (reg: Region) => valore<string>(`
        select count(*) from clear c join event_run r on r.id = c.run_id
        where c.event_id = 5001 and r.reg = $1::region and c.status = 'published'`, [reg])
      const gl = Number(await conta('global'))
      const jpN = Number(await conta('japan'))
      const fixture = check('fixture: 5001 ha clear su Global', gl > 0, `${gl}`)
        && check('fixture: e nessuno su Japan', jpN === 0, `${jpN}`)
      if (!fixture) return
      check('listEvents Global: i clear di 5001', riga(glob, '5001')?.clears === gl,
            `${riga(glob, '5001')?.clears}, attesi ${gl}`)
      check('listEvents Japan: 5001 c\'e\', a zero clear', riga(jp, '5001')?.clears === 0,
            `${riga(jp, '5001')?.clears}`)

      const perTier = new Map((await righe<{ id: string; n: string }>(`
        select st.id::text as id,
               count(c.id) filter (where r.reg = 'global' and c.status = 'published') as n
        from stage_tier st
        left join clear c on c.stage_tier_id = st.id
        left join event_run r on r.id = c.run_id
        where st.event_id = 5001 group by st.id`)).map((x) => [x.id, Number(x.n)]))
      const stJp = await Q.getStages('5001', 'japan')
      const stGl = await Q.getStages('5001', 'global')
      tutte('getStages Japan: ogni difficolta\' a zero', stJp, (s) => s.clears === 0)
      tutte('getStages Global: ogni difficolta\' come nel database', stGl,
            (s) => s.clears === perTier.get(s.tier_id))
      check('getStages Global: la somma e\' quella dell\'evento',
            stGl.reduce((a, s) => a + s.clears, 0) === gl)

      const nTier3 = perTier.get(TIER3) ?? 0
      check('la difficolta\' della fixture ha clear su Global', nTier3 > 0, `${nTier3}`)
      check('listClears Japan: vuota', (await Q.listClears(TIER3, 'japan')).length === 0)
      check('listClears Global: tutti quelli della difficolta\'',
            nTier3 > 0 && (await Q.listClears(TIER3, 'global')).length === nTier3)
    })

    await sezione('getEvent', async () => {
      const nul = await Q.getEvent(T.ricerca, 'japan')
      check('evento senza run in Japan: la riga c\'e\'', nul?.id === T.ricerca && nul.name === NOMI[T.ricerca])
      check('...con stato, date e ends_at_known a null',
            !!nul && nul.status === null && nul.starts_at === null && nul.ends_at === null && nul.ends_at_known === null,
            nul ? `${nul.status}, ${nul.starts_at}, ${nul.ends_at}, ${nul.ends_at_known}` : 'nessuna riga')

      const run = (await righe<{ starts_at: Date; ends_at: Date }>(`
        select starts_at, ends_at from event_run where event_id = 5001 and reg = 'global'
          and starts_at <= now() and (ends_at is null or ends_at > now())`))[0]
      const ev = await Q.getEvent('5001', 'global')
      check('5001 su Global: in corso, fine nota', ev?.status === 'active' && ev.ends_at_known === true)
      check('...starts_at e ends_at sono Date, quelle della run in corso',
            !!run && ev?.starts_at instanceof Date && ev.ends_at instanceof Date
              && ev.starts_at.getTime() === run.starts_at.getTime() && ev.ends_at.getTime() === run.ends_at.getTime(),
            `${quando(ev?.starts_at)} - ${quando(ev?.ends_at)}`)
      check('...nome, tipo e descrizione',
            ev?.name === FRIEZA && ev.kind === 'challenge' && typeof ev.description === 'string' && ev.description.length > 0)

      const importato = await valore<string>(`
        select e.id::text from event e join event_run r on r.event_id = e.id and r.reg = 'global'
        where e.wiki_title is not null
        group by e.id having count(*) = 1 and bool_and(not r.ends_at_known)
        order by e.id limit 1`)
      if (check('c\'e\' un evento importato con una sola run, fine non nota', !!importato)) {
        const e = await Q.getEvent(importato!, 'global')
        check('...getEvent lo dice: ends_at_known falso, ends_at null, starts_at Date',
              e?.ends_at_known === false && e.ends_at === null && e.starts_at instanceof Date)
      }

      const assente = '999999999999'
      check('l\'id di prova non esiste',
            Number(await valore('select count(*) from event where id = $1::bigint', [assente])) === 0)
      check('getEvent di un id che non esiste: null', (await Q.getEvent(assente, 'global')) === null)
    })

    await sezione('getStages: ordine e contenuto', async () => {
      const ordine = (await righe<{ d: string }>(`select enumlabel as d from pg_enum
        where enumtypid = 'difficulty'::regtype order by enumsortorder`)).map((x) => x.d)
      const pos = new Map(ordine.map((d, i) => [d, i]))
      // per stage, poi per difficolta' nell'ordine dell'enum (z_hard prima di
      // super, che in ordine alfabetico verrebbe prima)
      const ordinati = (r: StageRow[]) => r.every((b, i) => {
        if (i === 0) return true
        const a = r[i - 1]
        return a.seq < b.seq || (a.seq === b.seq && (pos.get(a.difficulty) ?? -1) < (pos.get(b.difficulty) ?? -1))
      })
      const tier = (id: string) => valore<string>('select count(*) from stage_tier where event_id = $1::bigint', [id])

      const f = await Q.getStages('5001', 'global')
      check('5001: una riga per difficolta\'', f.length > 1 && f.length === Number(await tier('5001')), `${f.length}`)
      check('5001: per stage e per difficolta\'', f.length > 1 && ordinati(f),
            f.map((s) => `${s.seq}/${s.difficulty}`).join(' '))
      check('5001: tre stage distinti, un tier_id per riga',
            new Set(f.map((s) => s.stage_id)).size === 3 && new Set(f.map((s) => s.tier_id)).size === f.length)
      const ultra = f.find((s) => s.tier_id === TIER3)
      check('5001: nome dello stage, stamina e nota del boss',
            ultra?.name === 'Maximum Power' && ultra.sta_cost === 45 && !!ultra.boss_note?.includes('seals supers'))
      tutte('tipi: seq, clears numeri; id stringhe', f,
            (s) => typeof s.seq === 'number' && typeof s.clears === 'number'
              && typeof s.stage_id === 'string' && typeof s.tier_id === 'string')

      const misto = await valore<string>(`
        select s.event_id::text from stage_tier st join stage s on s.id = st.stage_id
        join event e on e.id = s.event_id where e.wiki_title is not null
        group by s.event_id, s.id
        having bool_or(st.difficulty = 'z_hard') and bool_or(st.difficulty = 'super')
        order by s.event_id limit 1`)
      if (check('c\'e\' un evento importato con z_hard e super nello stesso stage', !!misto)) {
        const m = await Q.getStages(misto!, 'global')
        check(`evento ${misto}: tutte le difficolta'`, m.length === Number(await tier(misto!)), `${m.length}`)
        check(`evento ${misto}: ordine per stage, poi enum delle difficolta'`, m.length > 1 && ordinati(m))
      }

      const eza = await valore<string>(`
        select st.event_id::text from stage_tier st group by st.event_id
        having bool_and(st.difficulty = 'eza_level') and count(*) > 10 order by 1 limit 1`)
      if (check('c\'e\' un\'EZA con piu\' di dieci livelli', !!eza)) {
        const z = await Q.getStages(eza!, 'global')
        check('EZA: un livello per riga, tutti', z.length === Number(await tier(eza!)), `${z.length}`)
        tutte('EZA: ogni riga e\' eza_level', z, (s) => s.difficulty === 'eza_level')
        check('EZA: livelli in ordine crescente', z.length > 1 && z.every((s, i) => i === 0 || z[i - 1].seq < s.seq))
      }
      check('evento inesistente: nessuno stage', (await Q.getStages('999999999999', 'global')).length === 0)
    })

    // l'ordine dichiarato da listClears, riscritto qui
    const viene = (a: ClearRow, b: ClearRow) => {
      if (a.has_proof !== b.has_proof) return a.has_proof ? -1 : 1
      if (a.score !== b.score) return b.score - a.score
      if (a.turns !== b.turns) return a.turns === null ? 1 : b.turns === null ? -1 : a.turns - b.turns
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }
    const aUnoAUno = async (tier: string, n: number) => {
      const ids: string[] = []
      for (let offset = 0; offset < n + 1; offset++) {
        for (const c of await Q.listClears(tier, 'global', { limit: 1, offset })) ids.push(c.id)
      }
      return ids
    }

    await sezione('listClears', async () => {
      const cl = await Q.listClears(TIER3, 'global')
      if (!check('almeno due clear sulla difficolta\' della fixture', cl.length >= 2, `${cl.length}`)) return
      const db0 = new Map((await righe<{ id: string; score: number; versions: string; lifetime: string;
                                          lang: string | null; prove: string }>(`
        select c.id::text, c.score, rep.versions, rep.lifetime_score as lifetime, c.lang,
               (select count(*) from clear_proof p
                 where p.version_id = c.version_id and p.is_reachable is not false) as prove
        from clear_current c join clear_reputation rep on rep.clear_id = c.id
        where c.stage_tier_id = $1::bigint`, [TIER3])).map((x) => [x.id, x]))

      tutte('score, versions e lifetime_score sono numeri', cl,
            (c) => typeof c.score === 'number' && typeof c.versions === 'number' && typeof c.lifetime_score === 'number')
      tutte('...e valgono quanto nel database', cl, (c) => {
        const d = db0.get(c.id)
        return !!d && c.score === d.score && c.versions === Number(d.versions) && c.lifetime_score === Number(d.lifetime)
      })
      tutte('created_at e\' una Date', cl, (c) => c.created_at instanceof Date)
      tutte('turns numero o null; no_items, deathless, has_proof booleani', cl,
            (c) => (c.turns === null || typeof c.turns === 'number') && typeof c.no_items === 'boolean'
              && typeof c.deathless === 'boolean' && typeof c.has_proof === 'boolean')
      tutte('note_lang: la lingua scritta col clear', cl, (c) => c.note_lang === (db0.get(c.id)?.lang ?? null))
      tutte('proofs: un array di {kind, provider, url}', cl, (c) => Array.isArray(c.proofs) && c.proofs.every((p) =>
        Object.keys(p).sort().join(',') === 'kind,provider,url'
          && (p.kind === 'screenshot' || p.kind === 'video') && typeof p.url === 'string'
          && (p.provider === null || typeof p.provider === 'string')))
      const caduti = Number(await valore(`
        select count(*) from clear_proof p join clear_current c on c.version_id = p.version_id
        where c.stage_tier_id = $1::bigint and p.is_reachable is false`, [TIER3]))
      check('fixture: c\'e\' un link caduto su questa difficolta\'', caduti > 0, `${caduti}`)
      tutte('i link caduti non si mostrano', cl, (c) => c.proofs.length === Number(db0.get(c.id)?.prove))
      tutte('has_proof vuol dire almeno una prova mostrabile', cl, (c) => c.has_proof === c.proofs.length > 0)
      tutte('la squadra di 7, con nome, epiteto e tipo', cl,
            (c) => c.cards.length === 7 && c.cards.every((k) => !!k.name && !!k.epithet && !!k.type))
      check('ordine: prima le prove, poi i voti, poi i turni, poi l\'id',
            cl.every((b, i) => i === 0 || viene(cl[i - 1], b) < 0),
            cl.map((c) => `${c.has_proof ? 'P' : '-'}${c.score}/${c.turns}`).join(' '))

      const p0 = await Q.listClears(TIER3, 'global', { limit: 1, offset: 0 })
      const p1 = await Q.listClears(TIER3, 'global', { limit: 1, offset: 1 })
      check('limit 1, offset 0 e 1: due clear diversi, i primi due',
            p0.length === 1 && p1.length === 1 && p0[0].id !== p1[0].id
              && p0[0].id === cl[0].id && p1[0].id === cl[1].id)
      check('a uno a uno: lo stesso ordine della lista intera',
            stessi(await aUnoAUno(TIER3, cl.length), cl.map((c) => c.id)))
      check('oltre l\'ultima pagina: lista vuota',
            (await Q.listClears(TIER3, 'global', { offset: cl.length })).length === 0)

      const vuoto = await valore<string>(`
        select st.id::text from stage_tier st join event e on e.id = st.event_id
        where e.wiki_title is not null
          and not exists (select 1 from clear c where c.stage_tier_id = st.id)
        order by st.id limit 1`)
      if (check('c\'e\' una difficolta\' importata senza clear', !!vuoto)) {
        check('una difficolta\' senza clear: lista vuota', (await Q.listClears(vuoto!, 'global')).length === 0)
      }
    })

    await sezione('listClears a pari merito', async () => {
      if (!check('i tre clear di prova ci sono', creati.clear.length === 3)) return
      const attesi = [...creati.clear].sort()
      const tl = await Q.listClears(TIER1, 'global')
      check('ci sono tutti e tre, e solo loro', stessi(tl.map((c) => c.id).sort(), attesi), `${tl.length}`)
      check('stessa prova, voti e turni: decide l\'id, crescente', stessi(tl.map((c) => c.id), attesi))
      check('a uno a uno: ognuno una volta, nello stesso ordine',
            stessi(await aUnoAUno(TIER1, 3), attesi))
      check('su Japan: nessuno', (await Q.listClears(TIER1, 'japan')).length === 0)

      // la moderazione: un clear nascosto non si mostra e non si conta
      const prima = riga(await Q.listEvents({ reg: 'global', search: FRIEZA }), '5001')?.clears ?? -1
      await db.query(`update clear set status = 'hidden' where id = $1::uuid`, [attesi[0]])
      try {
        const dopo = await Q.listClears(TIER1, 'global')
        check('nascosto: listClears non lo mostra', stessi(dopo.map((c) => c.id), attesi.slice(1)))
        check('nascosto: getStages non lo conta',
              (await Q.getStages('5001', 'global')).find((s) => s.tier_id === TIER1)?.clears === 2)
        check('nascosto: listEvents non lo conta',
              riga(await Q.listEvents({ reg: 'global', search: FRIEZA }), '5001')?.clears === prima - 1,
              `prima ${prima}`)
      } finally {
        await db.query(`update clear set status = 'published' where id = $1::uuid`, [attesi[0]])
      }
    })
  })()
} finally {
  try {
    if (connesso) {
      await pulisci()
      const resti = Number(await valore('select count(*) from event where id = any($1::bigint[])', [creati.eventi]))
      if (resti) check('pulizia dei dati di prova', false, `${resti} eventi rimasti`)
    }
  } catch (err) {
    check('pulizia dei dati di prova', false, (err as Error).message)
  }
  // senza, la pool tiene vivo il processo per trenta secondi
  await db.end()
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
