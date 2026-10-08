#!/usr/bin/env node
// C'e' qualcosa di nuovo rispetto all'ultimo import riuscito? Solo SELECT
// sulla produzione (import_run, 0023) e la cache locale.
//
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... node db/prod/last-run.mjs [--allow-local]
//
// Con GITHUB_OUTPUT scrive changed=true|false e last_ok=<data>. Nel dubbio
// (tabella assente, nessun giro riuscito) la risposta e' "cambiato": un
// import in piu' costa poco, uno saltato per errore lascia i dati vecchi.
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { describeInputs } from './inputs.mjs'
import { resolveTarget } from './target.mjs'

// Pura, per i test.
export function hasChanged(last, inputs) {
  if (!last) return { changed: true, why: 'no successful import yet' }
  if (!inputs.datamine_commit) return { changed: true, why: 'datamine commit unknown' }
  if (last.datamine_commit !== inputs.datamine_commit) return { changed: true, why: 'new datamine commit' }
  if (!inputs.wiki_sha || last.wiki_sha !== inputs.wiki_sha) return { changed: true, why: 'wiki content changed' }
  return { changed: false, why: 'same datamine commit and wiki content' }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let target
  try { target = resolveTarget(process.env, { allowLocal: process.argv.includes('--allow-local') }) } catch (err) {
    console.error(`\n  last-run: ${err.message}\n`); process.exit(1)
  }
  const c = new pg.Client({ connectionString: target.url })
  await c.connect()
  let last = null
  try {
    const { rows: [{ ok }] } = await c.query(`select to_regclass('import_run') is not null as ok`)
    if (ok) {
      const { rows } = await c.query(`
        select datamine_commit, summary->>'wiki_sha' as wiki_sha, finished_at
        from import_run where status = 'ok' order by finished_at desc limit 1`)
      last = rows[0] ?? null
    }
  } finally { await c.end() }
  const r = hasChanged(last, describeInputs())
  const when = last?.finished_at ? new Date(last.finished_at).toISOString().slice(0, 10) : ''
  console.log(`  ${r.changed ? 'da importare' : 'niente di nuovo'}: ${r.why}${when ? ` (ultimo import riuscito ${when})` : ''}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${r.changed}\nlast_ok=${when}\nwhy=${r.why}\n`)
  }
}
