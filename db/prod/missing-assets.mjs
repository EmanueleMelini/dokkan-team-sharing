#!/usr/bin/env node
// Le immagini che mancano: carte senza miniatura o artwork (con una pagina
// wiki o senza), eventi del wiki senza banner. Solo SELECT.
//
//   DATABASE_URL=... node db/prod/missing-assets.mjs [--json out.json] [--out out.md]
//        [--downloaded N] [--deployed true|false]   per la riga del riepilogo
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... node db/prod/missing-assets.mjs --prod
//        [--allow-local] [--plan piano.json] ...
//
// La CI lo lancia sul giro di prova: se l'elenco e' vuoto non chiede
// niente al wiki. Con GITHUB_OUTPUT scrive pending=<n> per i passi dopo.
//
// --prod e' per il giro giornaliero delle immagini (daily-images.yml): il
// bersaglio lo decide target.mjs (TLS verificato, niente database locale
// senza --allow-local), e le letture stanno in una transazione read only.
// --plan lancia fetch-assets --missing --plan sullo stesso database: chiede
// all'API del wiki quali file ci sono, senza scaricarli. Il piano finisce
// nel riepilogo, e in GITHUB_OUTPUT fetchable, fetchable_bytes e challenged.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { md } from './compare.mjs'

const SHOWN = 30

/** @param {import('pg').ClientBase} client */
export async function missingAssets(client) {
  // Anche le carte senza pagina: fetch-assets prova per loro i nomi per
  // convenzione del wiki (asset-jobs.mjs), a ogni giro.
  const { rows: cards } = await client.query(`
    select c.id::text as id, t.name, (c.wiki_title is null) as no_page,
           array_remove(array[case when c.thumb_key is null then 'thumb' end,
                              case when c.art_key is null then 'art' end], null) as missing
    from card c left join card_text t on t.card_id = c.id and t.locale = 'en'
    where c.thumb_key is null or c.art_key is null
    order by c.id`)
  const { rows: events } = await client.query(`
    select e.id::text as id, t.name from event e
    left join event_text t on t.event_id = e.id and t.locale = 'en'
    where e.wiki_title is not null and e.banner_key is null order by e.id`)
  const { rows: [{ n }] } = await client.query('select count(*)::int as n from card where wiki_title is null')
  return { cards, events, cards_without_wiki: n, pending: cards.length + events.length }
}

const MB = (b) => (b / 1e6).toFixed(1)

/**
 * I numeri del piano di fetch-assets --plan, per il riepilogo e GITHUB_OUTPUT.
 * @param {{ jobs?: { keyBase: string, size: number | null }[], missing_quiet?: number, missing_loud?: number,
 *           over_cap?: number, over_budget?: number, api_challenged?: boolean, api_unavailable?: boolean,
 *           challenged?: number } | null} plan
 */
export function planNumbers(plan) {
  if (!plan) return null
  const jobs = plan.jobs ?? []
  return {
    fetchable: jobs.length,
    fetchable_bytes: jobs.reduce((n, j) => n + (j.size ?? 0), 0),
    missing: (plan.missing_quiet ?? 0) + (plan.missing_loud ?? 0),
    over_limits: (plan.over_cap ?? 0) + (plan.over_budget ?? 0),
    challenged: (plan.challenged ?? 0) + (plan.api_challenged || plan.api_unavailable ? 1 : 0),
    api_challenged: Boolean(plan.api_challenged),
    api_unavailable: Boolean(plan.api_unavailable),
    first: jobs.slice(0, 8).map((j) => j.keyBase),
  }
}

/**
 * @param {Awaited<ReturnType<typeof missingAssets>>} m
 * @param {{ downloaded?: number | null, deployed?: boolean | null, plan?: Parameters<typeof planNumbers>[0] }} [opts]
 */
export function missingMarkdown(m, { downloaded = null, deployed = null, plan = null } = {}) {
  const out = ['### Images', '']
  const parts = []
  if (downloaded != null) parts.push(`downloaded ${downloaded}`)
  if (deployed != null) parts.push(`deployed ${deployed ? 'yes' : 'no'}`)
  parts.push(`pending ${m.pending}`)
  out.push(parts.join(', '), '')
  const conPagina = m.cards.filter((c) => !c.no_page)
  const senzaPagina = m.cards.filter((c) => c.no_page)
  for (const c of conPagina.slice(0, SHOWN)) out.push(`- card ${md(c.id)} ${md(c.name ?? '')}: no ${c.missing.join(', ')}`)
  for (const e of m.events.slice(0, SHOWN)) out.push(`- event ${md(e.id)} ${md(e.name ?? '')}: no banner`)
  const hidden = Math.max(0, conPagina.length - SHOWN) + Math.max(0, m.events.length - SHOWN)
  if (hidden) out.push(`- +${hidden} more`)
  if (senzaPagina.length) {
    out.push('', `${senzaPagina.length} cards without a wiki page: only the conventional file names are tried, every run.`)
  }
  const p = planNumbers(plan)
  if (p) {
    out.push('', `Plan: ${p.fetchable} files on the wiki to fetch (up to ${MB(p.fetchable_bytes)} MB, originals; stills arrive resized)` +
                 `${p.first.length ? `: ${p.first.map(md).join(', ')}${p.fetchable > p.first.length ? ', ...' : ''}` : ''}.`)
    out.push(`${p.missing} not on the wiki yet (retried every run)` +
             `${p.over_limits ? `, ${p.over_limits} animated files over the storage limits` : ''}.`)
    if (p.api_challenged) out.push('The wiki API answered 403 (anti-bot challenge): the plan is partial, the next run retries.')
    else if (p.api_unavailable) out.push('The wiki API did not answer: the plan is partial, the next run retries.')
  }
  out.push('')
  return out.join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  let url
  if (argv.includes('--prod')) {
    const { resolveTarget } = await import('./target.mjs')
    try { url = resolveTarget(process.env, { allowLocal: argv.includes('--allow-local') }).url } catch (err) {
      console.error(`\n  missing-assets: ${err.message}\n`); process.exit(1)
    }
  } else url = (await import('../env.mjs')).connectionString()

  const c = new pg.Client({ connectionString: url })
  await c.connect()
  let m
  try {
    await c.query('begin transaction read only')
    m = await missingAssets(c)
  } finally {
    await c.query('rollback').catch(() => {})
    await c.end()
  }

  // il piano: fetch-assets con lo stesso bersaglio, e nessun file .env
  let plan = null
  const planFile = val('--plan')
  if (planFile) {
    const { ROOT, childEnv } = await import('./target.mjs')
    const r = spawnSync(process.execPath, [join(ROOT, 'db/import/fetch-assets.mjs'), '--missing', '--plan', planFile],
      { stdio: 'inherit', env: childEnv(url), cwd: ROOT })
    if (r.status !== 0 || !existsSync(planFile)) {
      console.error(`\n  fetch-assets --plan e' fallito (uscita ${r.status ?? r.signal})\n`); process.exit(1)
    }
    plan = JSON.parse(readFileSync(planFile, 'utf8'))
  }

  if (val('--json')) writeFileSync(val('--json'), JSON.stringify(m) + '\n')
  const dl = val('--downloaded')
  const dep = val('--deployed')
  if (val('--out')) {
    writeFileSync(val('--out'), missingMarkdown(m, { downloaded: dl == null ? null : Number(dl) || 0,
                                                     deployed: dep == null ? null : dep === 'true', plan }) + '\n')
  }
  if (process.env.GITHUB_OUTPUT) {
    const p = planNumbers(plan)
    appendFileSync(process.env.GITHUB_OUTPUT, `pending=${m.pending}\n` + (p
      ? `fetchable=${p.fetchable}\nfetchable_bytes=${p.fetchable_bytes}\nchallenged=${p.challenged}\nmissing=${p.missing}\n` : ''))
  }
  const senza = m.cards.filter((x) => x.no_page).length
  console.log(`  immagini mancanti: ${m.cards.length} carte (${senza} senza pagina wiki), ${m.events.length} eventi` +
              ` (${m.cards_without_wiki} carte senza pagina wiki in tutto)`)
}
