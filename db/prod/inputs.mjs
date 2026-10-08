// Cosa c'e' nella cache dell'import (db/import/.cache): da quale commit
// del datamine, quando e' stato scaricato il wiki, e un'impronta del suo
// contenuto. L'impronta ignora fetched_at e l'ordine delle pagine, cosi'
// due download dello stesso wiki danno lo stesso valore e il workflow puo'
// dire "niente di nuovo".
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './target.mjs'

export const CACHE_DIR = join(ROOT, 'db', 'import', '.cache')

/** @param {{ pageid: number, title: string, wikitext: string }[]} pages */
export function pagesHash(pages, h = createHash('sha256')) {
  for (const p of [...pages].sort((a, b) => a.pageid - b.pageid)) {
    h.update(`${p.pageid}\u0000${p.title}\u0000${p.wikitext}\u0001`)
  }
  return h
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)

export function describeInputs(dir = CACHE_DIR) {
  const snap = readJson(join(dir, 'datamine', '_snapshot.json'))
  const cards = readJson(join(dir, 'wiki-cards.json'))
  const events = readJson(join(dir, 'wiki-events.json'))
  let wiki_sha = null
  if (cards && events) {
    const h = createHash('sha256')
    pagesHash(cards.pages, h)
    h.update('\u0002')
    pagesHash(events.pages, h)
    wiki_sha = h.digest('hex')
  }
  // il piu' vecchio dei due: e' quello che dice quanto puo' essere indietro il wiki
  const times = [cards?.fetched_at, events?.fetched_at].filter(Boolean).sort()
  return {
    datamine_commit: snap?.commit ?? null,
    datamine_committed_at: snap?.committed_at ?? null,
    datamine_fetched_at: snap?.fetched_at ?? null,
    wiki_fetched_at: times[0] ?? null,
    wiki_pages: cards ? cards.pages.length : null,
    event_pages: events ? events.pages.length : null,
    wiki_sha,
  }
}
