// I legami fra gli eventi del wiki e il gioco, calcolati come li scrive
// load-windows (game-map.mjs), senza leggerli dal database.
//
// load-game-events gira PRIMA di load-windows (cosi' gli eventi che crea
// prendono le finestre nello stesso giro), e su un database appena
// ricreato event_game_ref e' vuota: leggendola, ogni area sembrerebbe senza
// evento e diventerebbe un doppione di una pagina del wiki. Per questo i
// due script chiedono a questo modulo la stessa cosa, e la ottengono uguale.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTable } from '../datamine.mjs'
import { mapEvents } from '../game-map.mjs'

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'wiki-events.json')

export function loadMapTables() {
  return {
    areas: loadTable('areas'), quests: loadTable('quests'), missions: loadTable('missions'),
    areaTabs: loadTable('area_tabs'),
    sugorokuMaps: loadTable('sugoroku_maps'), sugorokuEnemies: loadTable('sugoroku_map_enemy_informations'),
    zStages: loadTable('z_battle_stages'), zViews: loadTable('z_battle_stage_views'),
    zEnemies: loadTable('z_battle_enemies'), zEscalations: loadTable('z_battle_enemy_card_escalations'),
  }
}

export function loadWikiPages() {
  const wiki = JSON.parse(readFileSync(CACHE, 'utf8'))
  return new Map(wiki.pages.map((p) => [p.pageid, p.wikitext]))
}

/**
 * Ritorna { events, refs, unmatched, pages, dm }:
 *   events  gli eventi del wiki con i nomi degli stage, come li ha scritti load-events
 *   refs    [{ event_id, game_kind, game_id, via, keys, confidence }]
 */
export async function wikiRefs(client, pages = loadWikiPages(), dm = loadMapTables()) {
  const { rows } = await client.query(`
    select e.id, e.kind::text as kind, e.wiki_title, et.name,
           coalesce(array_agg(stx.name order by s.seq) filter (where stx.name is not null), '{}') as stages
    from event e
    join event_text et on et.event_id = e.id and et.locale = 'en'
    left join stage s on s.event_id = e.id
    left join stage_text stx on stx.stage_id = s.id and stx.locale = 'en'
    where e.imported_from = 'wiki' and e.wiki_title is not null
    group by e.id, et.name`)
  const events = rows.map((r) => ({ ...r, id: Number(r.id) }))
  const { refs, unmatched } = mapEvents(events, pages, dm)
  return { events, refs, unmatched, pages, dm }
}
