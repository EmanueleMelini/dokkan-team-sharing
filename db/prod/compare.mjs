#!/usr/bin/env node
// Il confronto fra due fotografie (snapshot.mjs) e i limiti alle
// cancellazioni: e' il cancello dell'aggiornamento settimanale. Il giro di
// prova gira su una copia della produzione; se qui qualcosa non torna, la
// produzione non si tocca.
//
//   node db/prod/compare.mjs before.json after.json --limits db/prod/limits.json
//        [--allow-deletions] [--out diff.md] [--json esito.json]
//        [--expect esito-prova.json]   (verifica dopo: avvisa, non blocca)
//        [--header]   l'intestazione del riepilogo dalla cache dell'import,
//                     con WIKI_MODE (fresh|cached) e APPLY dall'ambiente
//
// Esce 3 se un limite e' violato. Il markdown va nel riepilogo del job:
// i nomi vengono da dati di terzi (wiki, datamine) e si scappano.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DATAMINE_REPO = 'Nicholas1006/dokkan-backend'
const NAMES_SHOWN = 20

// Markdown di GitHub: niente tabelle rotte, link, immagini o HTML dai nomi
export function md(s) {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 160)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]|!#~]/g, '\\$&')
}

function diffRows(b = {}, a = {}) {
  let added = 0, removed = 0, changed = 0
  const addedKeys = []
  for (const [k, h] of Object.entries(a)) {
    if (!Object.hasOwn(b, k)) { added++; addedKeys.push(k) } else if (b[k] !== h) changed++
  }
  for (const k of Object.keys(b)) if (!Object.hasOwn(a, k)) removed++
  return { added, removed, changed, addedKeys }
}

// Quante righe si possono togliere: ogni limite presente deve valere, cioe'
// il piu' stretto fra il numero e la percentuale. Senza limiti, Infinity.
export function allowedRemovals(lim, before) {
  const caps = []
  if (lim?.maxRemoved != null) caps.push(lim.maxRemoved)
  if (lim?.maxRemovedPct != null) caps.push((lim.maxRemovedPct / 100) * before)
  return caps.length ? Math.min(...caps) : Infinity
}

/**
 * @param {any} before snapshot
 * @param {any} after snapshot
 * @param {Record<string, any>} limits
 * @param {{ allowDeletions?: boolean, userTables?: 'check' | 'ignore', meta?: any }} [opts]
 */
export function compare(before, after, limits, { allowDeletions = false, userTables = 'check', meta } = {}) {
  const names = [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort()
  const tables = []
  const violations = []
  const star = limits['*'] ?? {}
  for (const t of names) {
    const b = before.tables[t], a = after.tables[t]
    const cls = a?.class ?? b?.class
    if (cls === 'system') continue
    if (cls === 'user' || b?.class === 'user') {
      if (userTables === 'ignore') continue
      const same = b?.class === 'user' && a?.class === 'user' && b.count === a.count && b.hash === a.hash
      if (!same) {
        violations.push({ table: t, rule: 'user table changed', before: b?.count ?? null,
                          after: a?.count ?? null, bypassable: false })
      }
      continue
    }
    const d = diffRows(b?.rows, a?.rows)
    const row = { table: t, before: b?.count ?? 0, after: a?.count ?? 0, ...d }
    tables.push(row)
    // una tabella con i suoi limiti usa quelli; le altre la regola "*"
    const lim = Object.hasOwn(limits, t) ? limits[t] : star
    const allowed = allowedRemovals(lim, row.before)
    if (row.removed > allowed) {
      violations.push({ table: t, rule: 'removed', before: row.before, removed: row.removed,
                        allowed: Math.floor(allowed), bypassable: true })
    }
    if (lim.minTotalPct != null && row.before > 0 && row.after < (lim.minTotalPct / 100) * row.before) {
      violations.push({ table: t, rule: `total below ${lim.minTotalPct}%`, before: row.before,
                        after: row.after, bypassable: true })
    }
  }
  const blocking = violations.filter((v) => !v.bypassable || !allowDeletions)
  const res = { ok: blocking.length === 0, violations, blocking, tables, allowDeletions, userTables }
  return { ...res, markdown: markdown(res, before, after, meta) }
}

function newNames(rows, dict, label) {
  const keys = rows?.addedKeys ?? []
  if (!keys.length) return []
  const out = [`### New ${label} (${keys.length})`, '']
  for (const k of keys.slice(0, NAMES_SHOWN)) out.push(`- ${md(k)} ${md(dict?.[k] ?? '(no English name)')}`)
  if (keys.length > NAMES_SHOWN) out.push(`- +${keys.length - NAMES_SHOWN} more`)
  out.push('')
  return out
}

export function header(meta = {}) {
  const sha = meta.datamine_commit
  const src = sha && /^[0-9a-f]{40}$/.test(sha)
    ? `datamine [${sha.slice(0, 7)}](https://github.com/${DATAMINE_REPO}/commit/${sha}) (${md(meta.datamine_committed_at)})`
    : 'datamine commit unknown'
  return [
    `## Weekly data update, ${md(meta.date ?? new Date().toISOString().slice(0, 10))}`, '',
    `Source: ${src}, wiki fetched ${md(meta.wiki_fetched_at ?? 'unknown')} | ${md(meta.wiki_mode ?? 'cached')}`, '',
    ...(meta.dry_run ? ['**Dry run: production not touched.**', ''] : []),
  ]
}

function markdown(res, before, after, meta) {
  const out = meta ? header(meta) : []
  const changed = res.tables.filter((r) => r.added || r.removed || r.changed)
  out.push('### Changes', '')
  if (!changed.length) out.push('No changes in game data.', '')
  else {
    out.push('| Table | Before | Added | Removed | Changed | After |', '|---|---:|---:|---:|---:|---:|')
    for (const r of changed) out.push(`| ${md(r.table)} | ${r.before} | ${r.added} | ${r.removed} | ${r.changed} | ${r.after} |`)
    out.push('', `${res.tables.length - changed.length} other game tables unchanged.`, '')
  }
  const byName = Object.fromEntries(res.tables.map((r) => [r.table, r]))
  out.push(...newNames(byName.event, after.names?.event, 'events'))
  out.push(...newNames(byName.card, after.names?.card, 'cards'))
  out.push('### Limits', '')
  if (!res.violations.length) {
    const users = res.userTables === 'ignore' ? 'User tables not compared (live traffic).' : 'User tables identical.'
    out.push(`All within limits. ${users}`, '')
  } else {
    out.push('| Table | Rule | Before | Removed or after | Allowed | Status |', '|---|---|---:|---:|---:|---|')
    for (const v of res.violations) {
      const status = !v.bypassable ? 'VIOLATION (cannot be bypassed)'
        : res.allowDeletions ? 'bypassed (allow_deletions)' : 'VIOLATION'
      out.push(`| ${md(v.table)} | ${md(v.rule)} | ${v.before ?? '-'} | ${v.removed ?? v.after ?? '-'} | ${v.allowed ?? '-'} | ${status} |`)
    }
    out.push('')
  }
  return out.join('\n')
}

// Verifica dopo l'applicazione: le tabelle di gioco devono essere cambiate
// come nel giro di prova. Torna l'elenco delle differenze.
export function sameChanges(rehearsal, prod) {
  const key = (r) => `${r.added}/${r.removed}/${r.changed}`
  const p = Object.fromEntries(prod.tables.map((r) => [r.table, r]))
  const out = []
  for (const r of rehearsal.tables) {
    const q = p[r.table]
    const got = q ? key(q) : 'missing'
    if (got !== key(r)) out.push({ table: r.table, rehearsal: key(r), prod: got })
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const VALUED = new Set(['--limits', '--out', '--json', '--expect', '--meta'])
  const [bFile, aFile] = argv.filter((x, i) => !x.startsWith('--') && !VALUED.has(argv[i - 1]))
  if (!bFile || !aFile) {
    console.error('  uso: compare.mjs before.json after.json --limits limits.json [--allow-deletions]')
    process.exit(1)
  }
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'))
  const limits = read(val('--limits') ?? new URL('./limits.json', import.meta.url))
  const expect = val('--expect')
  let meta = val('--meta') ? read(val('--meta')) : undefined
  if (argv.includes('--header')) {
    const { describeInputs } = await import('./inputs.mjs')
    meta = { ...describeInputs(), wiki_mode: process.env.WIKI_MODE ?? 'cached',
             dry_run: process.env.APPLY !== 'true', ...meta }
  }
  const r = compare(read(bFile), read(aFile), limits, {
    allowDeletions: argv.includes('--allow-deletions'),
    // dopo l'applicazione gli utenti hanno potuto scrivere: si guardano solo i dati di gioco
    userTables: expect ? 'ignore' : 'check', meta,
  })
  if (val('--out')) writeFileSync(val('--out'), r.markdown + '\n')
  else console.log(r.markdown)
  if (val('--json')) {
    writeFileSync(val('--json'), JSON.stringify({ ...r, markdown: undefined }) + '\n')
  }
  if (expect) {
    const diff = sameChanges(read(expect), r)
    for (const d of diff) console.log(`::warning::post-check: ${d.table} changed ${d.prod} in production, ${d.rehearsal} in the rehearsal (added/removed/changed)`)
    console.error(`  verifica dopo: ${diff.length ? `${diff.length} tabelle diverse dal giro di prova` : 'come il giro di prova'}`)
    process.exit(0)
  }
  for (const v of r.blocking) console.error(`  LIMITE: ${v.table} ${v.rule} (prima ${v.before ?? '-'}, ${v.removed ?? v.after ?? '-'})`)
  process.exit(r.ok ? 0 : 3)
}
