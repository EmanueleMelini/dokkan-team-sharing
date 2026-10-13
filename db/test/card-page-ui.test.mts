// La pagina della carta, lato pagina: le letture vere di lib/card-page.ts
// sul database di test (catena, link, categorie, i clear che usano la
// carta e la pagina del loro tier), le funzioni pure delle skill per
// livello, e lib/card-art.ts (quale artwork, la scelta per carta nel
// localStorage).
//
// Gira dentro npm run db:test, dopo gli import. Crea solo gli utenti
// cardpageui+...@example.invalid con i loro clear, e li toglie alla fine.
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import {
  baseOfZAwakened, getCard, getCardClears, parseCardId, righeDi, sitemapCards, skillTiers,
  skillsForTier, staticCardIds, CARTE_STATICHE_MAX, type CardSkill,
} from '@/lib/card-page'
import { clearPage } from '@/lib/queries'
import {
  ART_STORE_KEY, ART_STORE_MAX, formatBytes, readArtChoice, resolveArt, saveArtChoice, type StorageLike,
} from '@/lib/card-art'
import {
  DOMINIO, SUBMIT, check, dati, guardia, num, one, payload, q, stato, utente,
} from '@/db/test/builder-helpers'
import { chiaveNuda, conMiniatureNude } from '@/db/test/miniature-nude'

guardia()
const P = 'cardpageui'
const HANDLE = ['cardpageui_a', 'cardpageui_b', 'cardpageui_c']
const vale = (nome: string, got: unknown, atteso: unknown) => {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  check(nome, g === a, g === a ? `= ${g}` : `= ${g}, atteso ${a}`)
}

function idPuri() {
  console.log('\n  -- parseCardId e la forma Z')
  vale('1032310 va', parseCardId('1032310'), '1032310')
  for (const s of ['0', '-1', '1e5', '12345678901', 'abc', '', ' 1032310', '01032310']) {
    vale(`"${s}" no`, parseCardId(s), null)
  }
  vale('un numero non stringa no', parseCardId(1032310), null)
  vale('1032311 -> 1032310', baseOfZAwakened('1032311'), '1032310')
  vale('1032310 non e\' una forma Z', baseOfZAwakened('1032310'), null)
  vale('dieci cifre restano esatte', baseOfZAwakened('9999999991'), '9999999990')
  vale('1 non ha una base', baseOfZAwakened('1'), null)
}

const sk = (kind: CardSkill['kind'], tier: CardSkill['tier'], seq = 1): CardSkill =>
  ({ kind, tier, seq, name: null, description: `${kind} ${tier}`, details: [], condition: null, ki: null })

function livelli() {
  console.log('\n  -- skill per livello')
  const skills = [sk('leader', 'base'), sk('leader', 'eza'), sk('super', 'base'), sk('super', 'eza'),
    sk('passive', 'base'), sk('passive', 'eza'), sk('passive', 'seza'), sk('active', 'base')]
  vale('i livelli dal piu\' alto', skillTiers(skills), ['seza', 'eza', 'base'])
  vale('solo la base', skillTiers([sk('leader', 'base')]), ['base'])
  vale('nessuna skill, nessun livello', skillTiers([]), [])
  const seza = skillsForTier(skills, 'seza')
  vale('Super EZA con la sola passiva: le altre dall\'EZA, l\'attiva dalla base',
    seza.map((s) => `${s.kind}:${s.from ?? 'own'}`), ['leader:eza', 'super:eza', 'passive:own', 'active:base'])
  vale('EZA: proprie dove ci sono', skillsForTier(skills, 'eza').map((s) => `${s.kind}:${s.from ?? 'own'}`),
    ['leader:own', 'super:own', 'passive:own', 'active:base'])
  vale('la base non prende niente da altri livelli', skillsForTier(skills, 'base').every((s) => s.from === null), true)
  const tre = skillsForTier([sk('super', 'base', 2), sk('super', 'base', 1), sk('leader', 'base')], 'base')
  vale('le sezioni nell\'ordine dell\'enum', tre.map((s) => s.kind), ['leader', 'super'])
  vale('le righe: "- " e\' un punto elenco', righeDi('Basic effect(s)\n- ATK +1\n\n  - DEF +2  \nEnd'),
    [{ bullet: false, text: 'Basic effect(s)' }, { bullet: true, text: 'ATK +1' },
     { bullet: true, text: 'DEF +2' }, { bullet: false, text: 'End' }])
}

/** Un localStorage finto; rotto lancia a ogni accesso, come in navigazione privata. */
function finto(rotto = false): StorageLike & { dati: Map<string, string> } {
  const dati = new Map<string, string>()
  return {
    dati,
    getItem: (k) => { if (rotto) throw new Error('bloccato'); return dati.get(k) ?? null },
    setItem: (k, v) => { if (rotto) throw new Error('pieno'); dati.set(k, v) },
  }
}

function arte() {
  console.log('\n  -- lib/card-art.ts')
  const base = { hasAnimated: true, accountDefault: null, stored: null, reducedMotion: false, saveData: false } as const
  vale('senza animato sempre statico, anche se scelto', resolveArt({ ...base, hasAnimated: false, stored: 'animated', accountDefault: 'animated' }), 'still')
  vale('chi non e\' entrato: statico', resolveArt(base), 'still')
  vale('il default dell\'account Animated vale', resolveArt({ ...base, accountDefault: 'animated' }), 'animated')
  vale('...ma non col movimento ridotto', resolveArt({ ...base, accountDefault: 'animated', reducedMotion: true }), 'still')
  vale('...ne\' col risparmio dati', resolveArt({ ...base, accountDefault: 'animated', saveData: true }), 'still')
  vale('la scelta sulla carta vince sul movimento ridotto', resolveArt({ ...base, stored: 'animated', reducedMotion: true, saveData: true }), 'animated')
  vale('la scelta sulla carta vince sul default', resolveArt({ ...base, stored: 'still', accountDefault: 'animated' }), 'still')

  const s = finto()
  vale('niente salvato: null', readArtChoice(s, '1'), null)
  check('si salva', saveArtChoice(s, '1', 'animated') && readArtChoice(s, '1') === 'animated')
  for (let i = 2; i <= ART_STORE_MAX + 5; i++) saveArtChoice(s, String(i), 'still')
  const voci = JSON.parse(s.dati.get(ART_STORE_KEY) ?? '[]') as [string, string][]
  vale(`al massimo ${ART_STORE_MAX} carte`, voci.length, ART_STORE_MAX)
  vale('se ne va la piu\' vecchia', readArtChoice(s, '1'), null)
  vale('restano le piu\' recenti, nell\'ordine', [voci[0][0], voci.at(-1)?.[0]], ['6', String(ART_STORE_MAX + 5)])
  saveArtChoice(s, '6', 'animated')
  const dopo = JSON.parse(s.dati.get(ART_STORE_KEY) ?? '[]') as [string, string][]
  vale('risalvare una carta la porta in fondo, senza doppioni', [dopo.at(-1), dopo.filter((v) => v[0] === '6').length], [['6', 'animated'], 1])
  const rotto = finto(true)
  vale('un localStorage che lancia: nessuna scelta', readArtChoice(rotto, '1'), null)
  vale('...e salvare dice false senza eccezioni', saveArtChoice(rotto, '1', 'still'), false)
  vale('senza localStorage', [readArtChoice(null, '1'), saveArtChoice(null, '1', 'still')], [null, false])
  const sporco = finto(); sporco.dati.set(ART_STORE_KEY, '{"1":"animated"}')
  vale('un valore scritto male non rompe niente', readArtChoice(sporco, '1'), null)
  sporco.dati.set(ART_STORE_KEY, '[["1","gif"],["2","animated"]]')
  vale('...e una voce sconosciuta si salta', [readArtChoice(sporco, '1'), readArtChoice(sporco, '2')], [null, 'animated'])
  vale('i pesi', [formatBytes(4_180_098), formatBytes(62_598), formatBytes(400), formatBytes(null), formatBytes(0)],
    ['4.2 MB', '63 KB', '1 KB', null, null])

  // I moduli puri non chiamano la cache di Next: i test li importano fuori da Next
  for (const f of ['lib/card-page.ts', 'lib/card-art.ts']) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
    check(`${f} senza 'use cache', cacheTag, cacheLife`, !/['"]use cache|cacheTag\(|cacheLife\(|next\/cache/.test(src))
  }
}

async function carte() {
  console.log('\n  -- getCard')
  vale('una carta che non c\'e\': null', await getCard('1999999990'), null)
  vale('un id non valido: null senza query', await getCard('abc'), null)

  // Una catena di due passi: prima -> mezzo -> ultima
  const c = await one<{ prima: string; mezzo: string; ultima: string }>(`
    select a.id::text as prima, b.id::text as mezzo, x.id::text as ultima
    from card b join card a on a.id = b.awakens_from join card x on x.awakens_from = b.id
    order by b.id limit 1`)
  check('c\'e\' una catena di due passi nei dati', !!c)
  if (c) {
    const m = await getCard(c.mezzo)
    vale('dal mezzo: prima, mezzo, ultima', m?.chain.map((k) => k.id), [c.prima, c.mezzo, c.ultima])
    const p = await getCard(c.prima)
    vale('dalla prima la stessa catena', p?.chain.map((k) => k.id), [c.prima, c.mezzo, c.ultima])
    check('Global segnato per ogni anello', !!m && m.chain.every((k) => typeof k.global === 'boolean'))
    check('nessuna miniatura nuda senza immagini: thumb_bare false, anche nella catena',
      m?.thumb_bare === false && !!m && m.chain.every((k) => k.thumb_bare === false))
    // La miniatura nuda (0034): la pagina e la catena la incorniciano
    await conMiniatureNude((t, p) => db.query(t, p), [c.mezzo], async () => {
      const n = await getCard(c.mezzo)
      check('getCard: thumb_bare per la miniatura nuda', n?.thumb_bare === true && n.thumb_key === chiaveNuda(c.mezzo))
      vale('...e nella catena solo il suo anello', n?.chain.map((k) => k.thumb_bare), [false, true, false])
      vale('dalla prima: lei no, l\'anello di mezzo si\'', [(await getCard(c.prima))?.thumb_bare,
        (await getCard(c.prima))?.chain.map((k) => k.thumb_bare)], [false, [false, true, false]])
    })
  }
  const sola = await one<{ id: string }>(`
    select c.id::text from card c where c.awakens_from is null
       and not exists (select 1 from card x where x.awakens_from = c.id) limit 1`)
  vale('una carta senza catena: solo lei', (await getCard(sola!.id))?.chain.map((k) => k.id), [sola!.id])

  const conLink = await one<{ id: string }>(`
    select cl.card_id::text as id from card_link cl join card_category cc on cc.card_id = cl.card_id
    group by cl.card_id having count(distinct cl.link_id) >= 5 and count(distinct cc.category_id) >= 3 limit 1`)
  const k = await getCard(conLink!.id)
  const attesi = await num(`select count(*) from card_link where card_id = $1`, [conLink!.id])
  check('i link della carta, con l\'effetto', k?.links.length === attesi && k.links.every((l) => l.name && l.effect != null),
    `${k?.links.length} su ${attesi}`)
  const nomi = k?.categories.map((x) => x.name) ?? []
  vale('le categorie in ordine di nome', nomi, [...nomi].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))

  const eza = await one<{ id: string }>(`
    select c.id::text from card c join event e on e.cover_card_id = c.id and e.kind = 'zbattle'
     where c.has_eza and exists (select 1 from card_skill s where s.card_id = c.id and s.tier = 'eza') limit 1`)
  if (eza) {
    const e = await getCard(eza.id)
    check('una carta EZA: il suo evento e le skill EZA', !!e && e.ezaEvents.length > 0 && skillTiers(e.skills).includes('eza'),
      JSON.stringify(e?.ezaEvents))
  }
  const jp = await one<{ id: string }>(`
    select c.id::text from card c where not exists (
      select 1 from card_release r where r.card_id = c.id and r.reg = 'global') limit 1`)
  if (jp) vale('una carta solo giapponese ha solo la data JP', (await getCard(jp.id))?.releases.map((r) => r.reg), ['japan'])

  console.log('\n  -- build e sitemap')
  const statiche = await staticCardIds()
  check(`da 1 a ${CARTE_STATICHE_MAX} carte da prerenderizzare`, statiche.length >= 1 && statiche.length <= CARTE_STATICHE_MAX, `${statiche.length}`)
  const mappa = await sitemapCards()
  check('la sitemap ha le carte uscite su Global',
    mappa.length === await num(`select count(*) from card_release where reg = 'global'`) && mappa.length > 1000, `${mappa.length}`)
}

async function clear() {
  console.log('\n  -- getCardClears')
  const d = await dati()
  const reg = (await one<{ reg: string }>(`select reg::text from event_run where id = $1`, [d.run]))!.reg as 'global' | 'japan'
  // La carta della prova: una uscita su Global che non e' fra le otto di dati()
  const C = Number((await one<{ id: string }>(`
    select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
     where r.released_at <= current_date and c.id <> all($1::bigint[]) order by c.id desc limit 1`, [d.cards]))!.id)
  const altri = d.cards.slice(1)                  // sette carte che non sono C
  const utenti = await Promise.all(HANDLE.map((h) => utente(P, h)))
  const invia = async (u: string, cards: number[]) =>
    (await one<{ id: string }>(SUBMIT, [u, d.run, d.tier, JSON.stringify(payload(cards))]))!.id

  // 21 clear con C in squadra (in tutti e due gli assetti: conta una volta),
  // uno con C solo nel secondo assetto, uno con C friend, uno con C leader
  const ids: string[] = []
  for (let i = 0; i < 21; i++) ids.push(await invia(utenti[i % 3], [altri[0], altri[1], C, ...altri.slice(2, 7)]))
  const soloSecondo = await invia(utenti[0], [altri[0], ...altri.slice(1, 7), C])
  const friend = await invia(utenti[1], [altri[0], altri[1], altri[2], altri[3], altri[4], altri[5], C, altri[6]])
  const leader = await invia(utenti[2], [C, ...altri.slice(0, 7)])
  const tutti = [...ids, soloSecondo, friend, leader]

  const r = await getCardClears(String(C), reg, 100)
  vale('il totale conta ogni clear una volta', r.total, tutti.length)
  vale('tutti i clear, nessuno doppio', new Set(r.rows.map((x) => x.id)).size, tutti.length)
  check('anche quello con la carta solo nel secondo assetto', r.rows.some((x) => x.id === soloSecondo))
  vale('i ruoli: leader 0, friend 1, in squadra 2',
    [leader, friend, soloSecondo].map((id) => r.rows.find((x) => x.id === id)?.role_rank), [0, 1, 2])
  const sbagliate: string[] = []
  for (const x of r.rows) {
    const vera = await clearPage(x.tier_id, reg, x.id)
    if (vera !== x.page) sbagliate.push(`${x.id}: ${x.page} invece di ${vera}`)
  }
  check('la pagina di ogni clear e\' quella della lista dell\'evento (ORDINE_CLEAR)', sbagliate.length === 0, sbagliate[0] ?? '')
  check('con piu\' di 20 clear nel tier qualcuno sta a pagina 2', r.rows.some((x) => x.page === 2))
  const ordine = await q<{ id: string }>(`
    select c.id::text from clear_current c where c.id = any($1::uuid[])
     order by c.has_proof desc, c.score desc, c.created_at desc, c.id`, [tutti])
  check('in ordine: prova, voti, i piu\' recenti', r.rows.map((x) => x.id).join() === ordine.map((x) => x.id).join())
  const top = await getCardClears(String(C), reg)
  vale('per difetto i primi 10, col totale intero', [top.rows.length, top.total], [10, tutti.length])
  check('una riga ha evento, handle e link', !!top.rows[0].event_name && HANDLE.includes(top.rows[0].handle) && /^\d+$/.test(top.rows[0].tier_id))

  await db.query(`update clear set status = 'hidden' where id = $1::uuid`, [leader])
  const nascosto = await getCardClears(String(C), reg, 100)
  check('un clear nascosto non c\'e\' e non conta', nascosto.total === tutti.length - 1 && !nascosto.rows.some((x) => x.id === leader))
  const altra = reg === 'global' ? 'japan' : 'global'
  vale('nell\'altra regione niente', (await getCardClears(String(C), altra)).total, 0)
  vale('un id non valido: niente', await getCardClears('x', reg), { rows: [], total: 0 })

  // I clear di prima del 0016 hanno solo clear_card (la fixture): contano
  const vecchia = await one<{ card: string; reg: string; n: number }>(`
    select cc.card_id::text as card, c.reg::text as reg, count(distinct c.id)::int as n
    from clear_card cc join clear_current c on c.version_id = cc.version_id and c.status = 'published'
    where not exists (select 1 from clear_lineup_card l where l.version_id = cc.version_id)
    group by 1, 2 order by 3 desc limit 1`)
  if (vecchia) {
    vale('i clear vecchi (solo clear_card) contano', (await getCardClears(vecchia.card, vecchia.reg as 'global')).total, vecchia.n)
  }
}

try {
  idPuri()
  livelli()
  arte()
  await carte()
  await clear()
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  // gli utenti della suite per email esatta; i loro clear vanno con loro
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
