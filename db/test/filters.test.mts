// I filtri della lista dei clear sul database di test: le letture vere di
// lib/queries.ts (listClears con i filtri, countClears, getClearFacets,
// cardLabels) confrontate con quello che il test calcola da solo, in JS,
// dalle carte di ogni clear.
//
// Gira dentro npm run db:test, dopo gli import. Crea solo gli utenti
// filterstest+...@example.invalid con i loro clear (su un tier senza altri
// clear), e li toglie alla fine.
import { db } from '@/lib/db'
import {
  cardLabels, categoryName, countClears, getClearFacets, listClears,
  type ClearRow, type Region,
} from '@/lib/queries'
import { leggiFiltri, type FiltriClear } from '@/lib/clears/filtri'
import type { Ricerca } from '@/lib/parametri'
import {
  DOMINIO, SUBMIT, check, guardia, one, payload, q, stato, utente, type Payload,
} from '@/db/test/builder-helpers'

guardia()
const P = 'filterstest'
const HANDLE = ['filterstest_a', 'filterstest_b', 'filterstest_c']
const vale = (nome: string, got: unknown, atteso: unknown) => {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  return check(nome, g === a, g === a ? `= ${g}` : `= ${g}, atteso ${a}`)
}
const VOTE = 'select vote_clear_version($1::uuid, $2::uuid, $3::smallint) as score'

type Base = { tier: string; global: string; japan: string; teq: number[]; cat: number; altre: number[]; agl: number }

/** Un tier senza clear con una ricorrenza Global e una Japan gia' iniziate, e le carte. */
async function base(): Promise<Base> {
  const t = await one<{ tier: string; global: string; japan: string }>(`
    select st.id::text as tier, g.id::text as global, j.id::text as japan from stage_tier st
     join event_run g on g.event_id = st.event_id and g.reg = 'global' and g.starts_at <= now()
     join event_run j on j.event_id = st.event_id and j.reg = 'japan' and j.starts_at <= now()
    where not exists (select 1 from clear c where c.stage_tier_id = st.id)
    order by st.id, g.starts_at desc, j.starts_at desc limit 1`)
  // otto TEQ Super uscite in entrambe le versioni con una categoria in comune
  const uscita = `exists (select 1 from card_release r where r.card_id = c.id and r.reg = 'global' and r.released_at <= current_date)
    and exists (select 1 from card_release r where r.card_id = c.id and r.reg = 'japan' and r.released_at <= current_date)`
  const cat = await one<{ id: number }>(`
    select cc.category_id as id from card c join card_category cc on cc.card_id = c.id
    where c.type = 'TEQ' and c.class = 'Super' and ${uscita}
    group by 1 having count(*) >= 8 order by count(*) desc, 1 limit 1`)
  const teq = (await q<{ id: string }>(`
    select c.id::text from card c join card_category cc on cc.card_id = c.id and cc.category_id = $1
    where c.type = 'TEQ' and c.class = 'Super' and ${uscita} order by c.id limit 8`, [cat!.id])).map((r) => Number(r.id))
  const agl = await one<{ id: string }>(`
    select c.id::text from card c where c.type = 'AGL' and ${uscita}
      and not exists (select 1 from card_category cc where cc.card_id = c.id and cc.category_id = $1)
    order by c.id limit 1`, [cat!.id])
  // carte di tipi diversi, fuori dalle otto
  const altre = (await q<{ id: string }>(`
    select x.id from (select distinct on (c.type) c.id::text as id, c.type from card c
      where ${uscita} and c.id <> all($1::bigint[]) and c.id <> $2::bigint order by c.type, c.id) x
    union all
    (select c.id::text from card c where ${uscita} and c.id <> all($1::bigint[]) and c.id <> $2::bigint
      order by c.id desc limit 3)`, [teq, agl!.id])).map((r) => Number(r.id))
  return { tier: t!.tier, global: t!.global, japan: t!.japan, teq, cat: cat!.id, altre, agl: Number(agl!.id) }
}

/** Un clear della prova, con le carte che il test sa di avergli dato (ogni assetto). */
type Clear = { id: string; nome: string; carte: Set<number>; leader: number }

/** I clear della prova: A-F come nel disegno, piu' G (con un friend che non e' mai leader). */
async function crea(b: Base, utenti: string[]): Promise<Record<string, Clear>> {
  const invia = async (nome: string, u: string, run: string, p: Payload): Promise<Clear> => {
    const r = await one<{ id: string }>(SUBMIT, [u, run, b.tier, JSON.stringify(p)])
    const carte = new Set(p.lineups.flatMap((l) => l.slots.map((x) => Number(x.card_id))))
    return { id: r!.id, nome, carte, leader: Number(p.lineups[0].slots[0].card_id) }
  }
  const T = b.teq, X = b.altre
  const out: Record<string, Clear> = {}
  // A: mono TEQ, tutto Super, tutte nella categoria, con prova, no items, no KO, 5 turni
  out.A = await invia('A', utenti[0], b.global, payload(T, { no_items: true, deathless: true, turns: 5 }))
  // B: tipi misti, senza prova, turni non detti; il friend X[5] non e' mai leader
  out.B = await invia('B', utenti[1], b.global, payload([X[0], X[1], X[2], X[3], X[4], X[6], X[5], X[7]],
    { proofs: [], turns: null, no_items: false, deathless: false }))
  // C: partenza TEQ, il cambio porta dentro una AGL fuori categoria
  out.C = await invia('C', utenti[2], b.global, payload([...T.slice(0, 7), b.agl],
    { proofs: [], turns: 3, no_items: true, deathless: false }))
  // D: stesso leader di A, 9 turni, dopo, con piu' voti
  out.D = await invia('D', utenti[1], b.global, payload([T[0], X[0], X[1], X[2], X[3], X[4], X[5], X[6]],
    { turns: 9, no_items: false, deathless: true }))
  // E: la versione giapponese (mai in Global); F: nascosto (mai)
  out.E = await invia('E', utenti[0], b.japan, payload(T, { turns: 4 }))
  out.F = await invia('F', utenti[2], b.global, payload(T, { turns: 2 }))
  await db.query(`update clear set status = 'hidden' where id = $1::uuid`, [out.F.id])
  // G: con prova, 9 turni come D: il pareggio di turni si scioglie con prova e voti
  out.G = await invia('G', utenti[0], b.global, payload([X[1], X[0], X[2], X[3], X[4], X[6], X[7], X[5]],
    { turns: 9 }))
  // voti: D +2 (b e c non possono votare il proprio: D e' di b, voto di a e c)
  const versione = async (c: Clear) => (await one<{ v: string }>(
    `select version_id::text as v from clear_current where id = $1::uuid`, [c.id]))!.v
  for (const u of [utenti[0], utenti[2]]) await one(VOTE, [u, await versione(out.D), 1])
  await one(VOTE, [utenti[1], await versione(out.A), 1])
  return out
}

type Info = { type: string; class: string; cats: number[] }
type Riga = Clear & { has_proof: boolean; no_items: boolean; deathless: boolean; turns: number | null; score: number; created_at: Date }

/** Il modello del test: le regole dei filtri riscritte in JS, sulle carte note di ogni clear. */
function passa(c: Riga, f: FiltriClear, info: Map<number, Info>): boolean {
  const carte = [...c.carte].map((id) => info.get(id)!)
  if (f.proof && !c.has_proof) return false
  if (f.noItems && !c.no_items) return false
  if (f.noKo && !c.deathless) return false
  if (f.turns != null && (c.turns == null || c.turns > f.turns)) return false
  if (f.leader && c.leader !== Number(f.leader)) return false
  if (!f.cards.every((id) => c.carte.has(Number(id)))) return false
  if (f.mono && !carte.every((x) => x.type === f.mono)) return false
  if (f.cls && !carte.every((x) => x.class === f.cls)) return false
  if (f.cat != null && !carte.every((x) => x.cats.includes(f.cat!))) return false
  return true
}

const perId = (a: Riga, b: Riga) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const ORDINE: Record<FiltriClear['sort'], (a: Riga, b: Riga) => number> = {
  top: (a, b) => Number(b.has_proof) - Number(a.has_proof) || b.score - a.score
    || (a.turns ?? Infinity) - (b.turns ?? Infinity) || perId(a, b),
  new: (a, b) => b.created_at.getTime() - a.created_at.getTime() || perId(a, b),
  turns: (a, b) => (a.turns ?? Infinity) - (b.turns ?? Infinity) || Number(b.has_proof) - Number(a.has_proof)
    || b.score - a.score || perId(a, b),
}

async function filtri(b: Base, cl: Record<string, Clear>) {
  const tutte = [...new Set(Object.values(cl).flatMap((c) => [...c.carte]))]
  const info = new Map<number, Info>()
  for (const r of await q<{ id: string; type: string; class: string; cats: number[] }>(`
    select c.id::text, c.type::text, c.class::text,
           coalesce((select array_agg(cc.category_id order by cc.category_id) from card_category cc where cc.card_id = c.id), '{}') as cats
    from card c where c.id = any($1::bigint[])`, [tutte])) info.set(Number(r.id), { type: r.type, class: r.class, cats: r.cats })
  const stato = new Map((await q<Omit<Riga, keyof Clear> & { id: string }>(`
    select id::text, has_proof, no_items, deathless, turns, score, created_at from clear_current
    where id = any($1::uuid[])`, [Object.values(cl).map((c) => c.id)])).map((r) => [r.id, r]))
  const globali: Riga[] = ['A', 'B', 'C', 'D', 'G'].map((k) => ({ ...cl[k], ...stato.get(cl[k].id)! }))
  const nomeDi = new Map(Object.values(cl).map((c) => [c.id, c.nome]))
  const nomi = (rows: { id: string }[]) => rows.map((r) => nomeDi.get(r.id) ?? `estraneo ${r.id}`).join('')

  const T = b.teq, X = b.altre
  const casi: [string, Ricerca, string | null][] = [
    ['nessun filtro', {}, 'DAGCB'],
    ['proof', { proof: '1' }, 'DAG'],
    ['no items', { noitems: '1' }, 'AGC'],
    ['no KOs', { noko: '1' }, 'DA'],
    ['al massimo 5 turni: B (senza turni) fuori', { turns: '5' }, 'AC'],
    ['al massimo 2 turni', { turns: '2' }, ''],
    ['leader: solo quello di partenza', { leader: String(T[0]) }, 'DAC'],
    ['leader: il friend di B non conta', { leader: String(X[5]) }, ''],
    ['usa: il friend conta', { card: String(X[5]) }, 'DGB'],
    ['usa: la carta del cambio', { card: String(b.agl) }, 'C'],
    ['usa: una nel cambio di A', { card: String(T[7]) }, 'A'],
    ['usa due carte: partenza e cambio, insieme', { card: [String(T[1]), String(b.agl)] }, 'C'],
    ['usa tre carte: tutte e tre', { card: [String(T[1]), String(T[7]), String(T[3])] }, 'A'],
    ['usa tre carte: una manca a tutti', { card: [String(T[1]), String(b.agl), String(X[0])] }, ''],
    ['mono TEQ: il cambio AGL di C lo esclude', { mono: 'TEQ' }, 'A'],
    ['mono AGL', { mono: 'AGL' }, ''],
    ['tutti Super', { class: 'super' }, null],
    ['tutti Extreme', { class: 'extreme' }, null],
    ['categoria: ogni carta di ogni assetto', { cat: String(b.cat) }, 'A'],
    ['tutto insieme', { proof: '1', noitems: '1', noko: '1', turns: '5', leader: String(T[0]), card: String(T[7]),
      mono: 'TEQ', class: 'super', cat: String(b.cat) }, 'A'],
    ['ordine new', { sort: 'new' }, 'GDCBA'],
    ['ordine turns: senza turni in fondo, pari turni per prova e voti', { sort: 'turns' }, 'CADGB'],
    ['turns e filtro', { sort: 'turns', proof: '1' }, 'ADG'],
    ['iniezioni: valori ignorati', { card: '1 or 1=1', leader: '1); drop table clear; --', cat: "1' or '1'='1",
      mono: "TEQ' or 1=1 --", turns: '1;', sort: 'id; drop table clear' }, 'DAGCB'],
  ]
  console.log('\n  -- listClears e countClears con i filtri (Global)')
  for (const [nome, sp, atteso] of casi) {
    const f = leggiFiltri(sp)
    const [lista, n] = await Promise.all([listClears(b.tier, 'global', { limit: 100, filtri: f }), countClears(b.tier, 'global', f)])
    const modello = nomi(globali.filter((c) => passa(c, f, info)).sort(ORDINE[f.sort]))
    const ok = nomi(lista) === modello && (atteso === null || modello === atteso) && n === lista.length
    check(nome, ok, `${nomi(lista)}, modello ${modello}${atteso !== null ? `, atteso ${atteso}` : ''}, count ${n}`)
  }
  return { globali, info, nomi }
}

async function resto(b: Base, cl: Record<string, Clear>, m: Awaited<ReturnType<typeof filtri>>) {
  const { globali, info, nomi } = m
  console.log('\n  -- regione, nascosti, pagine, il comportamento di sempre')
  vale('Japan: solo E', nomi(await listClears(b.tier, 'japan', { filtri: leggiFiltri({}) })), 'E')
  vale('Japan con mono TEQ: E', nomi(await listClears(b.tier, 'japan', { filtri: leggiFiltri({ mono: 'TEQ' }) })), 'E')
  const senza = await listClears(b.tier, 'global')
  const vuoti = await listClears(b.tier, 'global', { filtri: leggiFiltri({}) })
  check('senza filtri e' + "'" + ' la lista di sempre (stesse righe, stesso ordine)',
    JSON.stringify(senza) === JSON.stringify(vuoti) && nomi(senza) === 'DAGCB')
  vale('le colonne di listClears non cambiano', Object.keys(senza[0] ?? {}).sort(), [
    'cards', 'changes', 'comments', 'created_at', 'deathless', 'handle', 'has_proof', 'id', 'lifetime_score',
    'no_items', 'note', 'note_lang', 'proofs', 'score', 'turns', 'version_id', 'versions'])
  const f = leggiFiltri({ card: String(b.teq[0]) })
  vale('una pagina oltre la fine: vuota, il conteggio no',
    [(await listClears(b.tier, 'global', { offset: 100, filtri: f })).length, await countClears(b.tier, 'global', f)], [0, 3])
  vale('limit e offset con i filtri', nomi(await listClears(b.tier, 'global', { limit: 1, offset: 1, filtri: f })), 'A')
  vale('nessun clear nascosto in nessun caso', (await listClears(b.tier, 'global', { limit: 100, filtri: leggiFiltri({ sort: 'new' }) }))
    .some((r: ClearRow) => r.id === cl.F.id), false)

  console.log('\n  -- i valori arrivano legati, mai nel testo SQL')
  const crudo = async (g: Partial<FiltriClear>) => {
    try { await listClears(b.tier, 'global', { filtri: { ...leggiFiltri({}), ...g } as FiltriClear }); return 'eseguita' }
    catch (e) { return (e as { code?: string }).code ?? 'errore' }
  }
  // senza leggiFiltri, un valore cattivo e' un errore di tipo di Postgres (22P02), non SQL eseguito
  vale('mono con un apice', await crudo({ mono: "TEQ' or '1'='1" as FiltriClear['mono'] }), '22P02')
  vale('una carta con SQL', await crudo({ cards: ['1) or (1=1'] }), '22P02')
  vale('un ordine sconosciuto usa quello di difetto', await crudo({ sort: 'id desc; drop table clear' as FiltriClear['sort'] }), 'eseguita')
  check('la tabella clear c\'e\' ancora, coi clear della prova', (await q(`select 1 from clear where id = $1::uuid`, [cl.A.id])).length === 1)

  console.log('\n  -- getClearFacets: dai clear del tier senza filtri')
  const fc = await getClearFacets(b.tier, 'global')
  const conta = <K,>(chiavi: K[]) => {
    const mm = new Map<K, number>()
    for (const k of chiavi) mm.set(k, (mm.get(k) ?? 0) + 1)
    return mm
  }
  const ordina = (mm: Map<string | number, number>) => [...mm].map(([k, n]) => `${k}:${n}`).sort()
  const carte = conta(globali.flatMap((c) => [...c.carte].map(String)))
  vale('carte: in quanti clear, ogni assetto', fc.cards.map((c) => `${c.id}:${c.n}`).sort(), ordina(carte))
  vale('leader: quello di partenza', fc.leaders.map((c) => `${c.id}:${c.n}`).sort(), ordina(conta(globali.map((c) => String(c.leader)))))
  const unico = (c: Riga, k: 'type' | 'class') => {
    const v = new Set([...c.carte].map((id) => info.get(id)![k]))
    return v.size === 1 ? [...v][0] : null
  }
  vale('tipi: i clear mono', fc.types.map((t) => `${t.id}:${t.n}`).sort(),
    ordina(conta(globali.map((c) => unico(c, 'type')).filter((x): x is string => !!x))))
  vale('classi', fc.classes.map((t) => `${t.id}:${t.n}`).sort(),
    ordina(conta(globali.map((c) => unico(c, 'class')).filter((x): x is string => !!x))))
  const categorie = conta(globali.flatMap((c) => {
    const [prima, ...altre] = [...c.carte].map((id) => info.get(id)!.cats)
    return prima.filter((k) => altre.every((a) => a.includes(k)))
  }))
  vale('categorie: quelle di ogni carta', fc.categories.map((t) => `${t.id}:${t.n}`).sort(), ordina(categorie))
  check('la categoria di A c\'e\', col nome', fc.categories.some((c) => c.id === b.cat && !!c.name))
  check('nessuna opzione a 0', [...fc.cards, ...fc.leaders, ...fc.types, ...fc.classes, ...fc.categories].every((x) => x.n > 0))
  check('ogni opzione da sola trova i clear che conta', (await Promise.all(fc.cards.slice(0, 10).map(async (c) =>
    await countClears(b.tier, 'global', leggiFiltri({ card: c.id })) === c.n))).every(Boolean))
  check('le carte hanno nome, tipo e classe', fc.cards.every((c) => !!c.name && !!c.type && !!c.class))
  vale('Japan: solo le carte di E', (await getClearFacets(b.tier, 'japan')).cards.length, cl.E.carte.size)
  vale('un tier senza clear: tutto vuoto', await getClearFacets('999999999999', 'global' as Region),
    { cards: [], leaders: [], types: [], classes: [], categories: [] })

  console.log('\n  -- cardLabels e categoryName')
  const et = await cardLabels(['abc', String(b.teq[0]), '0', '999999999999999999'])
  vale('solo gli id validi che esistono', et.map((x) => [x.id, x.n, !!x.name]), [[String(b.teq[0]), 0, true]])
  vale('nessun id: nessuna query', await cardLabels([]), [])
  check('il nome della categoria', !!(await categoryName(b.cat)))
  vale('una categoria che non c\'e\'', await categoryName(32767), null)

  // Indicativo: con pochi clear il planner puo' preferire una scansione
  const piano = (await q<{ 'QUERY PLAN': string }>(`explain select c.id from clear_current c
    where c.stage_tier_id = $1::bigint and c.reg = 'global' and c.status = 'published'`, [b.tier])).map((r) => r['QUERY PLAN']).join('\n')
  console.log(`  INFO  piano della lista: ${/clear_by_tier/.test(piano) ? 'usa clear_by_tier' : 'senza clear_by_tier (pochi dati)'}`)
}

let utenti: string[] = []
try {
  const b = await base()
  check('ci sono i dati per la prova (tier, 8 TEQ Super, una AGL, 8 altre)',
    !!b.tier && b.teq.length === 8 && !!b.agl && b.altre.length >= 8, JSON.stringify({ tier: b.tier, cat: b.cat, n: b.altre.length }))
  utenti = await Promise.all(HANDLE.map((h) => utente(P, h)))
  const cl = await crea(b, utenti)
  const m = await filtri(b, cl)
  await resto(b, cl, m)
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  const emails = HANDLE.map((h) => `${P}+${h}${DOMINIO}`)
  await db.query(`delete from clear where author_id in (select id from app_user where email = any($1::text[]))`, [emails])
  await db.query('delete from app_user where email = any($1::text[])', [emails])
  check('pulizia: nessun utente di prova rimasto',
    (await q('select 1 from app_user where email = any($1::text[])', [emails])).length === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
