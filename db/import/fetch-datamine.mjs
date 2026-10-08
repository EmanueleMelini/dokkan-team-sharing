#!/usr/bin/env node
// Scarica i CSV del database ufficiale Global da Nicholas1006/dokkan-backend.
//
// Quel repo versiona in git il database del gioco esportato tabella per
// tabella, con commit automatici settimanali. Prendiamo solo le tabelle
// che ci servono: ~25 MB invece dei 100 del database intero.
//
// Tutte le tabelle vengono dallo STESSO commit, che si chiede una volta
// all'API di GitHub e si scrive in _snapshot.json. Scaricando da HEAD un
// commit arrivato a meta' giro mescolerebbe due settimane diverse: aree di
// una, missioni dell'altra. E il loader delle finestre deve poter dire di
// quando e' la fotografia che sta leggendo.
//
// Nota: il repo non dichiara una licenza. I dati sono di Bandai Namco /
// Akatsuki in ogni caso — vedi il disclaimer nel README.
//
//   node db/import/fetch-datamine.mjs [--fresh]
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '.cache', 'datamine')
const REPO = 'Nicholas1006/dokkan-backend'
const UA = 'DokkanTeamSharing/0.1 (progetto personale, import periodico)'
const FRESH = process.argv.includes('--fresh')
const SNAPSHOT = join(DIR, '_snapshot.json')

const TABLES = [
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
]

mkdirSync(DIR, { recursive: true })

// Il commit da cui scaricare. Con --fresh l'ultimo che tocca data/; senza,
// quello della cache gia' presente, cosi' una tabella aggiunta dopo arriva
// dalla stessa fotografia delle altre.
let snap = null
if (!FRESH && existsSync(SNAPSHOT)) snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const daCommitNoto = !!snap
if (!snap) {
  const old = TABLES.filter((t) => existsSync(join(DIR, `${t}.csv`)))
  if (!FRESH && old.length) {
    console.log(`  attenzione: la cache non dice da che commit viene; le tabelle mancanti`)
    console.log(`  arrivano dall'ultimo, le altre restano vecchie. --fresh le riallinea.`)
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?path=data&per_page=1`,
      { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const [c] = await res.json()
    snap = { repo: REPO, commit: c.sha, committed_at: c.commit.committer.date }
  } catch (err) {
    // senza API si scarica comunque, da HEAD, e lo si dichiara
    console.log(`  non so quale sia l'ultimo commit (${err.message}): scarico da HEAD`)
    snap = { repo: REPO, commit: null, committed_at: null }
  }
}
const ref = snap.commit ?? 'HEAD'
const BASE = `https://raw.githubusercontent.com/${REPO}/${ref}/data`
console.log(`  commit: ${snap.commit ? `${snap.commit.slice(0, 8)} del ${snap.committed_at}` : 'HEAD (non noto)'}`)

let scaricati = 0, saltati = 0, falliti = 0, byte = 0
for (const t of TABLES) {
  const dest = join(DIR, `${t}.csv`)
  if (!FRESH && existsSync(dest) && statSync(dest).size > 0) {
    saltati++; byte += statSync(dest).size
    continue
  }
  // una alla volta e con una pausa: e' il raw di GitHub, non un nostro server
  if (scaricati) await new Promise((r) => setTimeout(r, 500))
  const res = await fetch(`${BASE}/${t}.csv`, { headers: { 'User-Agent': UA } })
  if (!res.ok) { console.log(`  ${t}.csv: HTTP ${res.status}`); falliti++; continue }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  scaricati++; byte += buf.length
  process.stdout.write(`\r  scaricate ${scaricati} tabelle, ${(byte / 1e6).toFixed(1)} MB`)
}
// Il commit si scrive solo se e' vero per tutta la cache: con tabelle
// vecchie di provenienza ignota, o un download fallito, sarebbe una bugia.
const coerente = !falliti && (FRESH || daCommitNoto || !saltati)
if (scaricati && coerente) {
  writeFileSync(SNAPSHOT, JSON.stringify({ ...snap, fetched_at: new Date().toISOString() }, null, 1) + '\n')
}
console.log(`\r  ${scaricati} scaricate, ${saltati} gia' presenti, ${(byte / 1e6).toFixed(1)} MB in tutto`
            + (saltati && !FRESH ? '  (--fresh per riscaricare)' : '') + '          ')
