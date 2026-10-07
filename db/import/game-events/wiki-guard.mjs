// Per load-events: una pagina nuova del wiki e' un evento che abbiamo gia'
// creato dal gioco?
//
// Gli eventi del gioco (load-game-events) hanno un id loro, 1e9/2e9 + id di
// gioco, e il wiki un pageid: lo stesso evento entrerebbe due volte. Il
// legame si riconosce con le stesse chiavi di load-windows (game-map.mjs),
// applicate alle sole pagine nuove; se l'area o l'EZA che trovano e' gia'
// di un evento del gioco, la pagina si salta. La fusione (l'evento del
// gioco che diventa quello del wiki, tenendo clear e run) resta a mano:
// vedi il README.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DM_DIR } from '../datamine.mjs'
import { mapEvents } from '../game-map.mjs'
import { loadMapTables } from './wiki-refs.mjs'

/**
 * fresh: gli eventi di load-events che il database non ha ancora
 *        ({ event: { id, kind, wiki_title }, text: { name }, stages })
 * pages: le pagine della cache del wiki ({ pageid, wikitext })
 * held:  i legami degli eventi del gioco ({ game_kind, game_id, event_id })
 * Ritorna Map pageid -> il legame del gioco che la pagina ritrova.
 */
export function heldByGame(fresh, pages, held) {
  const out = new Map()
  if (!fresh.length || !held.length) return out
  if (!existsSync(join(DM_DIR, 'areas.csv'))) {
    console.log('  attenzione: senza la cache del datamine non so dire se una pagina nuova e\' un evento gia\' preso dal gioco')
    return out
  }
  const dm = loadMapTables()
  const events = fresh.map((x) => ({ id: x.event.id, kind: x.event.kind, wiki_title: x.event.wiki_title,
    name: x.text.name, stages: x.stages.map((s) => s.name).filter(Boolean) }))
  const text = new Map(pages.map((p) => [p.pageid, p.wikitext]))
  const { refs } = mapEvents(events, text, dm)
  const byKey = new Map(held.map((h) => [`${h.game_kind}:${h.game_id}`, h]))
  for (const r of refs) {
    const h = byKey.get(`${r.game_kind}:${r.game_id}`)
    if (h && !out.has(r.event_id)) out.set(r.event_id, h)
  }
  return out
}
