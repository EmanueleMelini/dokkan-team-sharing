#!/usr/bin/env node
// Le sorgenti appena scaricate sono plausibili? Si confrontano con la
// cache della settimana prima, tenuta in .cache.prev prima del download.
//
//   node db/prod/sanity.mjs [--cache dir] [--prev dir]
//
// Il wiki e il datamine sono di terzi: un giorno possono rispondere con
// meta' delle pagine o un CSV troncato. I limiti alle cancellazioni
// (compare.mjs) fermerebbero il danno dopo; questo lo ferma prima, con un
// messaggio che dice qual e' la sorgente rotta. Esce 1 se qualcosa non va.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TABLES } from '../import/datamine-source.mjs'
import { CACHE_DIR } from './inputs.mjs'

export const WIKI_MAX_DROP_PCT = 2
export const CSV_MIN_PCT = 90
/**
 * Sotto questa misura (la volta prima) un CSV non si confronta col 90%:
 * basta che ci sia e non sia vuoto. Le tabelle piccole cambiano a salti
 * veri: il 2026-10-15 points.csv e' passato da 777 a 99 byte perche' il
 * datamine ha tolto 28 varianti di punti mai usate da mission_rewards (che
 * usa solo gli id 11-14, con la quantita' in colonna), e il settimanale si
 * e' fermato. Un CSV troncato a meta' resta un errore dove conta, sulle
 * tabelle grandi; per le altre ci sono i limiti alle cancellazioni di
 * compare.mjs.
 */
export const CSV_MIN_BYTES = 4096

// Pure, per i test: ognuna torna l'elenco dei problemi (vuoto = va bene).
export function checkPages(label, prev, cur, maxDropPct = WIKI_MAX_DROP_PCT) {
  if (cur == null) return [`${label}: missing`]
  if (cur === 0) return [`${label}: no pages`]
  if (prev != null && cur < prev * (1 - maxDropPct / 100)) {
    return [`${label}: ${cur} pages, ${prev} last time (more than ${maxDropPct}% fewer)`]
  }
  return []
}

/**
 * Ogni CSV deve esserci e avere almeno una riga di dati (vuoto vuol dire
 * zero byte, o la sola intestazione: senzaRighe). Se la volta prima era di
 * almeno minBytes, deve anche essere almeno il minPct% di allora.
 *
 * @param {Record<string, number>} prev  tabella -> byte, la volta prima
 * @param {Record<string, number | undefined>} cur  tabella -> byte, adesso
 * @param {string[]} required
 * @param {{ minPct?: number, minBytes?: number, senzaRighe?: Iterable<string> }} [opts]
 *   senzaRighe: le tabelle di adesso con la sola intestazione
 */
export function checkDatamine(prev, cur, required = TABLES, { minPct = CSV_MIN_PCT, minBytes = CSV_MIN_BYTES, senzaRighe = [] } = {}) {
  const vuote = new Set(senzaRighe)
  const out = []
  for (const t of required) {
    const size = cur[t]
    if (!size || vuote.has(t)) { out.push(`datamine ${t}.csv: missing or empty`); continue }
    const was = prev[t]
    if (was && was >= minBytes && size < was * (minPct / 100)) {
      out.push(`datamine ${t}.csv: ${size} bytes, ${was} last time (under ${minPct}%)`)
    }
  }
  return out
}

const pageCount = (file) => {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')).pages.length } catch { return null }
}
const csvSizes = (dir, tables = TABLES) => Object.fromEntries(tables.map((t) => {
  const f = join(dir, 'datamine', `${t}.csv`)
  return [t, existsSync(f) ? statSync(f).size : undefined]
}))

/**
 * Le tabelle con la sola intestazione (o nemmeno quella), lette solo fra
 * quelle piccole: un CSV di almeno minBytes ha righe per forza.
 */
export function csvSenzaRighe(dir, sizes, tables = TABLES, minBytes = CSV_MIN_BYTES) {
  return tables.filter((t) => {
    const n = sizes[t]
    if (!n || n >= minBytes) return false
    const righe = readFileSync(join(dir, 'datamine', `${t}.csv`), 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
    return righe.length < 2
  })
}

/** checkDatamine sulle cartelle: adesso (cache) contro la volta prima (prev, o null). */
export function checkDatamineDir(prev, cache, tables = TABLES) {
  const cur = csvSizes(cache, tables)
  return checkDatamine(prev ? csvSizes(prev, tables) : {}, cur, tables, { senzaRighe: csvSenzaRighe(cache, cur, tables) })
}

export function checkCache(cache, prev) {
  const hasPrev = prev && existsSync(prev)
  const pc = (d, f) => (d ? pageCount(join(d, f)) : null)
  return [
    ...checkPages('wiki cards', hasPrev ? pc(prev, 'wiki-cards.json') : null, pc(cache, 'wiki-cards.json')),
    ...checkPages('wiki events', hasPrev ? pc(prev, 'wiki-events.json') : null, pc(cache, 'wiki-events.json')),
    ...checkDatamineDir(hasPrev ? prev : null, cache),
  ]
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
  const cache = val('--cache', CACHE_DIR)
  const prev = val('--prev', `${CACHE_DIR}.prev`)
  const problems = checkCache(cache, prev)
  if (!existsSync(prev)) console.log('  nessuna cache precedente: controllo solo che tutto ci sia')
  for (const p of problems) console.log(`  ${p}`)
  if (problems.length) {
    console.error(`\n  sorgenti non plausibili (${problems.length}): non importo\n`)
    process.exit(1)
  }
  console.log(`  sorgenti plausibili: ${pageCount(join(cache, 'wiki-cards.json'))} pagine carta, ` +
              `${pageCount(join(cache, 'wiki-events.json'))} pagine evento, ${TABLES.length} tabelle del datamine`)
}
