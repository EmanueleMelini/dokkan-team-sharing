// Lettura della cache del datamine (fetch-datamine.mjs) e le regole per
// leggerne le date. Lo usano game-map.mjs e load-windows.mjs.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DM_DIR = join(dirname(fileURLToPath(import.meta.url)), '.cache', 'datamine')

// Lo stesso parser di load-datamine: campi fra apici con virgole, apici
// raddoppiati e a capo dentro (i nomi delle missioni li hanno).
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false, i = 0
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { quoted = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const head = rows.shift()
  return rows.filter((r) => r.length === head.length)
              .map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])))
}

export function loadTable(name) {
  const p = join(DM_DIR, `${name}.csv`)
  if (!existsSync(p)) {
    console.error(`\n  manca ${p.replace(process.cwd() + '/', '')}`)
    console.error(`  scaricalo con: node db/import/fetch-datamine.mjs\n`)
    process.exit(1)
  }
  return parseCsv(readFileSync(p, 'utf8'))
}

// Di quando e' la fotografia: il commit se fetch-datamine l'ha scritto,
// altrimenti solo la data del file, che dice quando e' stata scaricata.
export function snapshotInfo() {
  const p = join(DM_DIR, '_snapshot.json')
  if (existsSync(p)) {
    const s = JSON.parse(readFileSync(p, 'utf8'))
    if (s.commit) return `commit ${s.commit.slice(0, 8)} del ${s.committed_at.slice(0, 10)}`
  }
  const m = join(DM_DIR, 'missions.csv')
  return existsSync(m) ? `commit non noto, scaricata il ${statSync(m).mtime.toISOString().slice(0, 10)}` : 'assente'
}

export const int = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

// ------------------------------------------------------------- le date

// Il database del gioco scrive date senza fuso ("2026-10-20 07:59:59") e
// sono UTC: Global programma in UTC, senza ora legale. 05:00 UTC sono le
// 21:00 PST del giorno prima, le 06:30 sono le 22:30 PST del venerdi' della
// Super Battle Road, e le fini alle 14:59:59 sono le 23:59:59 di Tokyo.
// Si convertono qui, in JS: un ::timestamptz in SQL le leggerebbe nel fuso
// della sessione (Europe/Rome su dokkan_dev), un'ora o due fuori.

// 2038-01-01 00:00:00 e' "mai": il limite dei 32 bit. Su z_battle_stages
// vuol dire "in lista per sempre"; sulle missioni solo "nessuna scadenza
// propria", NON che l'evento sia permanente.
export const isSentinel = (s) => !!s && s.startsWith('2038-')
// Prima del lancio di Global (luglio 2015) ci sono solo righe spente
// ereditate dal database giapponese.
export const isPreLaunch = (s) => !!s && s < '2015-07-01'

const MIN = 60_000
const utc = (s) => {
  const d = new Date(s.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) throw new Error(`data del gioco illeggibile: "${s}"`)
  return d
}
// L'inizio al minuto: i secondi in piu' non sono un orario.
export const gameStart = (s) => new Date(Math.floor(utc(s).getTime() / MIN) * MIN)
// La fine diventa un limite ESCLUSIVO al minuto: 07:59:59 -> 08:00, e le
// 08:00:00..08:00:07 (secondi usati come ordinamento) -> 08:00.
export const gameEnd = (s) => new Date(Math.floor((utc(s).getTime() + 1000) / MIN) * MIN)

// ------------------------------------------- decodifica delle carte

// Qui e non in load-datamine perche' load-game-cards deve leggere tipo,
// classe e rarita' con LO STESSO codice: due decodifiche diverse
// darebbero alla stessa carta una classe a seconda di chi l'ha scritta.
//
// Verificato incrociando 2632 carte con i dati del wiki:
//   element 0-4    tipo giusto, classe NON ancora definita (forme base)
//   element 10-14  Super   AGL TEQ INT STR PHY   (99-100% di accordo)
//   element 20-24  Extreme AGL TEQ INT STR PHY   (99-100% di accordo)
// Le 20-24 sono le unita' Extreme, non carte nemico.
export const TYPES = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
export const decodeElement = (raw) => {
  const e = int(raw)
  if (e === null) return null
  const band = Math.floor(e / 10), idx = e % 10
  if (idx > 4) return null
  if (band === 1) return { type: TYPES[idx], cls: 'Super' }
  if (band === 2) return { type: TYPES[idx], cls: 'Extreme' }
  return { type: TYPES[idx], cls: null }      // forma base, classe ignota
}

// Verificato al 100% su tutte le rarita'
export const RARITY = ['N', 'R', 'SR', 'SSR', 'UR', 'LR']
export const decodeRarity = (raw) => RARITY[int(raw)] ?? null

// Le unita' giocabili hanno id a 7 cifre; quelle piu' lunghe (50003011,
// 501023491) sono boss e varianti interne.
export const isPlayable = (c) => String(c.id).length === 7
