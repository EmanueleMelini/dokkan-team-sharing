#!/usr/bin/env node
// Le immagini che mancano: carte con una pagina wiki ma senza miniatura o
// artwork, eventi del wiki senza banner. Solo SELECT.
//
//   DATABASE_URL=... node db/prod/missing-assets.mjs [--json out.json] [--out out.md]
//        [--downloaded N] [--deployed true|false]   per la riga del riepilogo
//
// La CI lo lancia sul giro di prova: se l'elenco e' vuoto non chiede
// niente al wiki. Con GITHUB_OUTPUT scrive pending=<n> per i passi dopo.
import { appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { md } from './compare.mjs'

const SHOWN = 30

/** @param {import('pg').ClientBase} client */
export async function missingAssets(client) {
  const { rows: cards } = await client.query(`
    select c.id::text as id, t.name,
           array_remove(array[case when c.thumb_key is null then 'thumb' end,
                              case when c.art_key is null then 'art' end], null) as missing
    from card c left join card_text t on t.card_id = c.id and t.locale = 'en'
    where c.wiki_title is not null and (c.thumb_key is null or c.art_key is null)
    order by c.id`)
  const { rows: events } = await client.query(`
    select e.id::text as id, t.name from event e
    left join event_text t on t.event_id = e.id and t.locale = 'en'
    where e.wiki_title is not null and e.banner_key is null order by e.id`)
  const { rows: [{ n }] } = await client.query('select count(*)::int as n from card where wiki_title is null')
  return { cards, events, cards_without_wiki: n, pending: cards.length + events.length }
}

export function missingMarkdown(m, { downloaded = null, deployed = null } = {}) {
  const out = ['### Images', '']
  const parts = []
  if (downloaded != null) parts.push(`downloaded ${downloaded}`)
  if (deployed != null) parts.push(`deployed ${deployed ? 'yes' : 'no'}`)
  parts.push(`pending ${m.pending}`)
  out.push(parts.join(', '), '')
  for (const c of m.cards.slice(0, SHOWN)) out.push(`- card ${md(c.id)} ${md(c.name ?? '')}: no ${c.missing.join(', ')}`)
  for (const e of m.events.slice(0, SHOWN)) out.push(`- event ${md(e.id)} ${md(e.name ?? '')}: no banner`)
  const hidden = Math.max(0, m.cards.length - SHOWN) + Math.max(0, m.events.length - SHOWN)
  if (hidden) out.push(`- +${hidden} more`)
  if (m.cards_without_wiki) out.push('', `${m.cards_without_wiki} cards have no wiki page, so there is no image source for them.`)
  out.push('')
  return out.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { connectionString } = await import('../env.mjs')
  const argv = process.argv.slice(2)
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const c = new pg.Client({ connectionString: connectionString() })
  await c.connect()
  const m = await missingAssets(c)
  await c.end()
  if (val('--json')) writeFileSync(val('--json'), JSON.stringify(m) + '\n')
  const dl = val('--downloaded')
  const dep = val('--deployed')
  if (val('--out')) {
    writeFileSync(val('--out'), missingMarkdown(m, { downloaded: dl == null ? null : Number(dl) || 0,
                                                     deployed: dep == null ? null : dep === 'true' }) + '\n')
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `pending=${m.pending}\n`)
  console.log(`  immagini mancanti: ${m.cards.length} carte, ${m.events.length} eventi` +
              ` (${m.cards_without_wiki} carte senza pagina wiki)`)
}
