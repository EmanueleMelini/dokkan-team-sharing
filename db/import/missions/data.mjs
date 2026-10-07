// Le tabelle del datamine che servono a load-missions, gia' indicizzate.
// Solo cache di fetch-datamine: niente rete.
import { int, loadTable } from '../datamine.mjs'

// item_type di mission_rewards -> la tabella che ne ha il nome. I Point e
// le sfere del drago non hanno tabella: vedi rewards.mjs.
export const ITEM_TABLES = {
  Card: 'cards', AwakeningItem: 'awakening_items', TrainingItem: 'training_items',
  PotentialItem: 'potential_items', TreasureItem: 'treasure_items', SpecialItem: 'special_items',
  EquipmentSkillItem: 'equipment_skill_items', ActItem: 'act_items', SupportItem: 'support_items',
  SupportMemory: 'support_memories', SupportMemoryEnhancementItem: 'support_memory_enhancement_items',
  SupportFilm: 'support_films', TrainingField: 'training_fields', LinkSkillLvUpItem: 'link_skill_lv_up_items',
  EventkagiItem: 'eventkagi_items', WallpaperItem: 'wallpaper_items', CardStickerItem: 'card_sticker_items',
  CardSkinItem: 'card_skin_items', Achievement: 'achievements', 'SD::Pack': 'sd_packs',
  'Jukebox::Track': 'jukebox_tracks',
}

export function loadMissionData() {
  const dm = {
    missions: loadTable('missions'),
    rewards: loadTable('mission_rewards'),
    points: new Map(loadTable('points').map((p) => [int(p.id), p])),
  }
  dm.mapQuest = new Map(loadTable('sugoroku_maps').map((m) => [int(m.id), int(m.quest_id)]))
  dm.questArea = new Map(loadTable('quests').map((q) => [int(q.id), int(q.area_id)]))
  dm.rewardsByMission = new Map()
  for (const r of dm.rewards) {
    if (!dm.rewardsByMission.has(r.mission_id)) dm.rewardsByMission.set(r.mission_id, [])
    dm.rewardsByMission.get(r.mission_id).push(r)
  }
  for (const rs of dm.rewardsByMission.values()) rs.sort((a, b) => int(a.id) - int(b.id))
  // il nome di ogni oggetto, tabella per tabella; jukebox lo chiama title
  dm.itemName = {}
  for (const [type, t] of Object.entries(ITEM_TABLES)) {
    dm.itemName[type] = new Map(loadTable(t).map((r) => [int(r.id), r.name ?? r.title]))
  }
  return dm
}

// Le aree divise fra piu' eventi: quelle delle quest legate per quest.
export function questAreas(ix, dm) {
  return new Set([...ix.quest.keys()].map((q) => dm.questArea.get(q)).filter(Boolean))
}
