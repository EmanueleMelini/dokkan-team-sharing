// Quali aree ed EZA del gioco diventano un evento nuovo, quali sono una
// riedizione di un evento che abbiamo gia', e quali non sono eventi.
//
// Le regole sono quelle della ricerca sul buco del wiki (ottobre 2026),
// rilette a mano su tutte le 138 aree attive dopo il taglio:
//   1. MainArea e TutorialArea sono capitoli della storia, non eventi;
//   2. 30 quest o piu', 20 delle quali con la partenza fittizia: e' un
//      archivio (Ultimate Red Zone, Supreme Magnificent Battle). Gli archivi
//      ripropongono edizioni che hanno gia' il loro evento: per ora si
//      dicono e basta;
//   3. stesso nome (norm) di un'area piu' vecchia dello stesso tipo, e
//      almeno meta' dei boss o delle quest non generiche in comune: e' la
//      stessa cosa che torna. Solo i nomi delle quest non bastano ("Stage
//      1/2" faceva sembrare 1754 una replica di 784), e la regola delle
//      sorelle di game-map (stesse quest identiche) perde le repliche che
//      aggiungono una quest ("Extreme Stage", "Category Only");
//   4. ': RE [' nel nome e' un remix con le sue quest: evento nuovo, anche
//      con lo stesso nome. I remake DbStory pure (901-917 hanno gia' un
//      evento ciascuno), per questo il confronto e' fra aree dello stesso tipo;
//   5. un'area vecchia tornata dopo il taglio si lega all'evento che le
//      somiglia; se non ce n'e', si importa come le altre.
import { norm } from '../game-map.mjs'
import { int, isPreLaunch, isSentinel } from '../datamine.mjs'
import { CUTOFF, areaActivity, areaBosses, oneLine } from './data.mjs'

export const AREA_BASE = 1_000_000_000
export const EZA_BASE = 2_000_000_000

// areas.category -> event.kind, misurato sui 427 eventi del wiki gia'
// legati alla loro area (98,4% d'accordo). DbStory (9000) va su 'story':
// l'enum ha anche db_story, ma la lista del sito (lib/queries.ts) non lo
// offre fra i filtri, e il wiki stesso li chiama eventi della storia.
// Le categorie senza nessun esempio legato (14, 15, 18, 23-27) restano
// fuori: un tipo inventato e' peggio di un evento in meno.
const KIND = {
  7: 'story', 9000: 'story',
  2: 'limited', 4: 'limited', 9: 'limited', 13: 'limited', 16: 'limited', 21: 'limited',
  10: 'challenge', 11: 'challenge', 12: 'challenge', 20: 'challenge',
  1: 'bonus', 5: 'bonus', 6: 'bonus',
  8: 'other',
}

// Decisioni prese a mano, con il motivo. Le aree di una famiglia sono un
// evento solo: Million Arena ha preliminari, semifinale, finale e la
// variante in singolo, quattro aree (e tre categorie diverse) per una gara.
const FAMILY = { 1718: 1717, 1719: 1717, 1721: 1717 }
const BY_HAND = {
  710: { skip: "il wiki ha Super Battle Road in pagine per intervallo di livelli (1 - 10, 11 - 20...): un'area non si lega a piu' eventi" },
  720: { skip: "il wiki ha Extreme Super Battle Road in pagine per intervallo di livelli: un'area non si lega a piu' eventi" },
  // un'area figlia di 607 (stesso boss, stesso nome con il prefisso
  // "Extreme Z-Area"): si apre con il suo evento
  791: { sameAs: 607 },
}

const GENERIC = /^(stage \d+|.*stage \d+|survival \d+|preliminary|semifinal|final|special battle|extreme stage)$/
const cover = (A, B) => { if (!A?.size || !B?.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / A.size }

/**
 * refs:   le righe di event_game_ref scritte da load-windows (source 'wiki'):
 *         [{ game_kind, game_id, event_id }]
 * wiki:   gli eventi del wiki senza nessun legame: [{ id, name }]
 * Ritorna { events, attach, skipped }:
 *   events   gli eventi da creare: { id, game_kind, game_id, kind, members, related }
 *   attach   le aree da legare a un evento che c'e' gia': { game_id, event_id, why, keys }
 *   skipped  { game_kind, game_id, cls, why }
 */
export function classify(d, refs, wiki) {
  const wikiArea = new Map(refs.filter((r) => r.game_kind === 'area').map((r) => [r.game_id, r.event_id]))
  const wikiEza = new Set(refs.filter((r) => r.game_kind === 'z_battle_stage').map((r) => r.game_id))
  const act = new Map(), boss = new Map(), qn = new Map()
  const activity = (id) => act.get(id) ?? act.set(id, areaActivity(d, id)).get(id)
  const bosses = (id) => boss.get(id) ?? boss.set(id, areaBosses(d, id).bosses).get(id)
  const quests = (id) => qn.get(id) ?? qn.set(id, new Set((d.questsByArea.get(id) ?? [])
    .map((q) => norm(oneLine(q.name))).filter((n) => n && !GENERIC.test(n)))).get(id)
  const nameOf = (id) => oneLine(d.area.get(id)?.name)
  const byName = new Map()
  for (const a of d.t.areas) {
    const k = `${a.type}|${norm(oneLine(a.name))}`
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(int(a.id))
  }
  const wikiByName = new Map(wiki.map((w) => [norm(w.name.replace(/\s+All Open$/i, '')), w]))

  const events = new Map(), attach = [], skipped = []
  const done = new Map()   // area -> event id (o null se non e' un evento)
  const skip = (id, cls, why) => { skipped.push({ game_kind: 'area', game_id: id, cls, why }); done.set(id, null); return null }
  const create = (id) => {
    const kind = KIND[int(d.area.get(id).category)]
    if (!kind) return skip(id, 'categoria senza esempi', `categoria ${d.area.get(id).category}: nessun evento legato da cui ricavare il tipo`)
    const ev = { id: AREA_BASE + id, game_kind: 'area', game_id: id, kind, members: [], related: null }
    events.set(ev.id, ev)
    done.set(id, ev.id)
    return ev.id
  }

  // le aree piu' vecchie con lo stesso nome e boss o quest in comune
  const olderTwins = (id) => {
    const a = d.area.get(id), me = activity(id)
    return (byName.get(`${a.type}|${norm(nameOf(id))}`) ?? [])
      .filter((p) => p !== id && activity(p).first && me.first && activity(p).first < me.first)
      .map((p) => ({ p, boss: cover(bosses(id), bosses(p)), q: cover(quests(id), quests(p)) }))
      .filter((x) => x.boss >= 0.5 || x.q >= 0.5)
      .map((x) => ({ ...x, keys: ['name', ...(x.boss >= 0.5 ? ['boss'] : []), ...(x.q >= 0.5 ? ['quests'] : [])],
                     why: `stesso nome dell'area ${x.p}, boss in comune ${x.boss.toFixed(2)}, quest ${x.q.toFixed(2)}` }))
  }

  function decide(id) {
    if (done.has(id)) return done.get(id)
    done.set(id, null)   // contro i cicli
    const a = d.area.get(id)
    if (wikiArea.has(id)) { done.set(id, wikiArea.get(id)); return wikiArea.get(id) }
    if (/MainArea|TutorialArea/.test(a.type)) return skip(id, 'non e\' un evento', `${a.type}: capitolo della storia`)
    const { nq, nph } = activity(id)
    if (nq >= 30 && nph >= 20) return skip(id, 'archivio', `${nq} quest, ${nph} con la partenza fittizia: ripropone edizioni che hanno gia' un evento`)
    const hand = BY_HAND[id]
    if (hand?.skip) return skip(id, 'deciso a mano', hand.skip)
    if (hand?.sameAs != null) return link(id, decide(hand.sameAs), `parte dell'area ${hand.sameAs}`, ['by-hand', 'boss'])
    if (FAMILY[id] != null) {
      const head = decide(FAMILY[id])
      if (head != null) events.get(head)?.members.push(id)
      done.set(id, head)
      return head
    }
    if (!/: RE \[/.test(nameOf(id))) {
      const twins = olderTwins(id)
      const mapped = [...new Set(twins.filter((x) => wikiArea.has(x.p)).map((x) => wikiArea.get(x.p)))]
      if (mapped.length > 1) return skip(id, 'ambigua', `riedizione di piu' eventi: ${mapped.join(', ')}`)
      if (mapped.length === 1) { const x = twins.find((t) => wikiArea.has(t.p)); return link(id, mapped[0], x.why, x.keys) }
      const w = wikiByName.get(norm(nameOf(id)))
      if (w) return link(id, w.id, `stesso nome dell'evento del wiki ${w.id}, che non aveva un'area`, ['name', 'wiki-title'])
      // la replica di un'area che nessuno ha legato: l'evento e' quella
      // piu' vecchia (1747 torna a 1708, uscita prima del taglio)
      if (twins.length) {
        const first = twins.sort((x, y) => (activity(x.p).first < activity(y.p).first ? -1 : 1))[0]
        const target = decide(first.p) ?? create(first.p)
        return link(id, target, first.why, first.keys)
      }
    }
    return create(id)
  }
  function link(id, eventId, why, keys) {
    if (eventId == null) return skip(id, 'riedizione senza evento', why)
    attach.push({ game_id: id, event_id: eventId, why, keys })
    done.set(id, eventId)
    return eventId
  }

  for (const a of d.t.areas) {
    const id = int(a.id)
    if (wikiArea.has(id) || !activity(id).active) continue
    decide(id)
  }
  // un'area tornata dopo il taglio ma uscita prima (activity.first < CUTOFF)
  // passa dalle stesse regole: qui si segna solo, per il riepilogo
  for (const ev of events.values()) ev.old = (activity(ev.game_id).first ?? '') < CUTOFF

  // EZA: le Normal che nessuno ha legato, e tutte le Super (il wiki le
  // tiene al piu' come una riga "Lv. SUPER" dentro la pagina della Normal)
  for (const z of d.t.zStages) {
    const id = int(z.id)
    if (wikiEza.has(id)) continue
    const out = !z.start_at || isSentinel(z.start_at) || isPreLaunch(z.start_at)
    if (out && !d.missionsByStage.get(id)?.length) {
      skipped.push({ game_kind: 'z_battle_stage', game_id: id, cls: 'EZA mai uscita', why: 'nessuna data su Global' })
      continue
    }
    const sup = /Super$/.test(z.type)
    events.set(EZA_BASE + id, { id: EZA_BASE + id, game_kind: 'z_battle_stage', game_id: id, kind: 'zbattle',
      members: [], related: sup ? int(z.related_z_battle_stage_id) : null, old: false })
  }
  return { events: [...events.values()], attach, skipped }
}
