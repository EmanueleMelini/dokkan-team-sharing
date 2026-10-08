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
 * @param {Record<string, number>} prev  tabella -> byte, la volta prima
 * @param {Record<string, number | undefined>} cur  tabella -> byte, adesso
 * @param {string[]} required
 */
export function checkDatamine(prev, cur, required = TABLES, minPct = CSV_MIN_PCT) {
  const out = []
  for (const t of required) {
    const size = cur[t]
    if (!size) { out.push(`datamine ${t}.csv: missing or empty`); continue }
    const was = prev[t]
    if (was && size < was * (minPct / 100)) {
      out.push(`datamine ${t}.csv: ${size} bytes, ${was} last time (under ${minPct}%)`)
    }
  }
  return out
}

const pageCount = (file) => {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf8')).pages.length } catch { return null }
}
const csvSizes = (dir) => Object.fromEntries(TABLES.map((t) => {
  const f = join(dir, 'datamine', `${t}.csv`)
  return [t, existsSync(f) ? statSync(f).size : undefined]
}))

export function checkCache(cache, prev) {
  const hasPrev = prev && existsSync(prev)
  const pc = (d, f) => (d ? pageCount(join(d, f)) : null)
  return [
    ...checkPages('wiki cards', hasPrev ? pc(prev, 'wiki-cards.json') : null, pc(cache, 'wiki-cards.json')),
    ...checkPages('wiki events', hasPrev ? pc(prev, 'wiki-events.json') : null, pc(cache, 'wiki-events.json')),
    ...checkDatamine(hasPrev ? csvSizes(prev) : {}, csvSizes(cache)),
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
