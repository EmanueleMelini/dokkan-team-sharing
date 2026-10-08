// Da dove arriva il datamine e come si sceglie il commit: separato da
// fetch-datamine.mjs perche' lo leggono anche il controllo della CI
// (db/prod/sanity.mjs) e i test, senza scaricare niente.
//
// Nota: il repo non dichiara una licenza. I dati sono di Bandai Namco /
// Akatsuki in ogni caso: vedi il disclaimer nel README.

export const REPO = 'Nicholas1006/dokkan-backend'
export const UA = 'DokkanTeamSharing/0.1 (+https://github.com/EmanueleMelini/dokkan-team-sharing; weekly import)'

export const TABLES = [
  'cards', 'card_categories', 'card_card_categories', 'link_skills',
  'card_awakening_routes', 'areas', 'quests', 'missions', 'mission_rewards',
  'mission_categories', 'z_battle_stages',
  // per le finestre degli eventi (load-windows): le schede delle aree, e le
  // EZA per titolo e boss. sugoroku_* (2,6 MB) danno i nemici di ogni quest,
  // la conferma "stesso boss" per gli eventi normali.
  'area_tabs', 'z_battle_stage_views', 'z_battle_enemies',
  'z_battle_enemy_card_escalations', 'sugoroku_maps', 'sugoroku_map_enemy_informations',
  // per gli eventi che il wiki non documenta (load-game-events): le abilita'
  // dei boss (riduzione danni, immunita'), come crescono livello per livello
  // nelle EZA, quanti livelli ha un'EZA e la stamina dei checkpoint
  'enemy_skills', 'z_battle_enemy_skill_escalations', 'z_battle_first_reward_level_ranges',
  'z_battle_check_points',
  // per i premi delle missioni (load-missions): mission_rewards dice solo
  // item_type + item_id, il nome sta nella tabella di quel tipo. Una per
  // tipo; i Point (dragon stone, zeni, punti di scambio) stanno in points,
  // le carte in cards, le sfere del drago non hanno tabella.
  'achievements', 'act_items', 'awakening_items', 'card_skin_items', 'card_sticker_items',
  'equipment_skill_items', 'eventkagi_items', 'jukebox_tracks', 'link_skill_lv_up_items',
  'points', 'potential_items', 'sd_packs', 'special_items', 'support_films', 'support_items',
  'support_memories', 'support_memory_enhancement_items', 'training_fields', 'training_items',
  'treasure_items', 'wallpaper_items',
  // per le build del builder (load-equipment): i nomi delle abilita' del
  // Hidden Potential, che il builder suggerisce come percorso. Le Skill
  // Orb (l'equipaggiamento) stanno gia' in equipment_skill_items.
  'potential_skills',
  // chi puo' montare quale sfera (0021): una regola per set, per tipo e
  // classe, categoria, lista di carte o "nome che contiene" (un set di
  // card_unique_infos, la colonna card_unique_info_id di cards)
  'equipment_skill_limitations', 'card_unique_info_set_relations',
]

// Il token di GitHub va SOLO all'API, mai a raw.githubusercontent.com o
// altrove: e' il GITHUB_TOKEN del workflow, e un host terzo che lo
// ricevesse potrebbe usarlo sul repository finche' il job gira.
export function headersFor(url, token) {
  /** @type {Record<string, string>} */
  const h = { 'User-Agent': UA }
  const host = new URL(url).hostname
  if (host === 'api.github.com') {
    h.Accept = 'application/vnd.github+json'
    if (token) h.Authorization = `Bearer ${token}`
  }
  return h
}

// L'ultimo commit che tocca data/. Senza --strict un errore da' commit
// null (si scarica da HEAD, e lo si dichiara); con --strict rifiuta: in CI
// una fotografia di provenienza ignota non deve arrivare in produzione.
/**
 * @param {(url: string, init?: any) => Promise<any>} fetchFn
 * @param {{ strict?: boolean, token?: string }} [opts]
 */
export async function resolveCommit(fetchFn, { strict = false, token } = {}) {
  const url = `https://api.github.com/repos/${REPO}/commits?path=data&per_page=1`
  try {
    const res = await fetchFn(url, { headers: headersFor(url, token) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const [c] = await res.json()
    if (!c?.sha || !/^[0-9a-f]{40}$/.test(c.sha)) throw new Error('risposta senza commit')
    return { repo: REPO, commit: c.sha, committed_at: c.commit?.committer?.date ?? null }
  } catch (err) {
    if (strict) throw new Error(`commit del datamine non noto (${err.message})`)
    return { repo: REPO, commit: null, committed_at: null, error: err.message }
  }
}
