// Gli stage che una riedizione aggiunge a un evento che c'e' gia'.
//
// Una riedizione si attacca all'evento di prima come riga in
// event_game_ref (via 'rerun', o le aree in piu' che load-windows lega a
// una pagina del wiki), ma i suoi stage in piu' restavano fuori: 552139
// Looming Menace ha 3 stage dal wiki, la sua riedizione 616 ne ha 4, e le
// missioni dicono "Clear Stage 4". Le Extreme Z-Area 613-618 aggiungono
// tutte un "Extreme Stage". Qui si decide quali quest mancano; li scrive
// writeRerunStages (game-events/write-rerun.mjs).
//
// Lo stage di un'area si confronta con gli stage "propri" dell'evento
// (quelli che load-events o writeStages hanno scritto, game_quest_id
// nullo), mai con quelli aggiunti qui: cosi' il piano non dipende da cosa
// c'e' gia' nel database, e un secondo giro e' uguale al primo.
//
//   1. per nome: uguale dopo norm(), o senza la variante fra parentesi
//      che il wiki aggiunge ("Vs. Majin Buu (Majin Buu)");
//   2. per ordine: le quest rimaste vanno, in ordine, sugli stage propri
//      che nessuna quest di quest'area ha preso per nome. Copre i nomi che
//      il wiki scrive diversi e gli stage senza nome (eventi a stage
//      singolo): nel dubbio una quest "c'e' gia'", e non si duplica;
//   3. le quest che restano ancora sono gli stage nuovi, in coda.
//
// I pezzi si guardano per area crescente, e dal secondo in poi gli stage
// che i pezzi prima hanno aggiunto valgono come propri, per nome e per
// ordine: due riedizioni con lo stesso "Extreme Stage", o un archivio che
// ripete l'edizione, non aggiungono niente due volte.
import { norm } from '../game-map.mjs'
import { areaStagesOf } from './build.mjs'

const bare = (s) => norm((s ?? '').replace(/\s*\([^)]*\)\s*$/, ''))
const same = (a, b) => !!a && !!b && (norm(a) === norm(b) || bare(a) === bare(b))

// Le vie che non portano stage nuovi: l'area dell'evento del gioco e le
// sorelle di una famiglia, che buildEvent ha gia' messo negli stage propri.
const OWN = new Set(['game', 'family'])

/**
 * I pezzi di gioco legati a ogni evento, ognuno con i suoi stage:
 *   un'area      tutte le sue quest (game_kind = 'area');
 *   un insieme   le quest di un'area legate una per una (game_kind =
 *                'quest': gli archivi, la Super Battle Road), raggruppate
 *                per area.
 * refs: [{ event_id, game_kind, game_id, via }] del wiki e del gioco.
 * Ritorna Map event_id -> [{ area, via, stages }] per area crescente.
 */
export function rerunUnits(d, refs) {
  const byEvent = new Map()
  const areaOf = new Map(d.t.quests.map((q) => [Number(q.id), Number(q.area_id)]))
  const unit = (ev, area, via) => {
    if (!byEvent.has(ev)) byEvent.set(ev, new Map())
    const m = byEvent.get(ev)
    const k = `${via === 'quest' ? 'q' : 'a'}:${area}`
    if (!m.has(k)) m.set(k, { area, via, quests: via === 'quest' ? new Set() : null })
    return m.get(k)
  }
  for (const r of refs) {
    if (r.game_kind === 'area') unit(r.event_id, r.game_id, r.via)
    else if (r.game_kind === 'quest') {
      const area = areaOf.get(r.game_id)
      if (area != null) unit(r.event_id, area, 'quest').quests.add(r.game_id)
    }
  }
  const out = new Map()
  for (const [ev, m] of byEvent) {
    out.set(ev, [...m.values()].sort((a, b) => a.area - b.area || a.via.localeCompare(b.via)).map((u) => ({
      area: u.area, via: u.via,
      stages: OWN.has(u.via) ? [] : areaStagesOf(d, u.area).filter((s) => !u.quests || u.quests.has(s.quest)),
    })))
  }
  return out
}

/**
 * own:   Map event_id -> stage propri [{ seq, name }] in ordine di seq
 * units: rerunUnits()
 * Ritorna [{ event_id, area, quest, name, tiers }] nell'ordine in cui
 * vanno in coda, evento per evento.
 */
export function planRerunStages(own, units) {
  const out = []
  for (const [eventId, us] of [...units].sort((a, b) => a[0] - b[0])) {
    // un evento legato a un pezzo solo ha gia' tutti i suoi stage
    if (us.length < 2) continue
    const base = own.get(eventId) ?? []
    const added = []
    for (const u of us) {
      // gli stage aggiunti dai pezzi prima contano come quelli propri: un
      // archivio ("Movie Edition Stage 8") ripete l'area dell'edizione, e
      // la sua quest 8 e' lo stage 8 appena aggiunto, non un nono
      const all = [...base, ...added]
      const taken = new Set()
      const left = []
      for (const q of u.stages) {
        const hit = all.findIndex((s) => same(s.name, q.name))
        if (hit >= 0) taken.add(hit)
        else left.push(q)
      }
      const free = all.map((_, i) => i).filter((i) => !taken.has(i))
      for (const q of left.slice(free.length)) {
        if (added.some((a) => same(a.name, q.name))) continue
        added.push({ event_id: eventId, area: u.area, quest: q.quest, name: q.name, tiers: q.tiers })
      }
    }
    out.push(...added)
  }
  return out
}
