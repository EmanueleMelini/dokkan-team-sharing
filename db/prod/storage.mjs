#!/usr/bin/env node
// Quanto spazio prendono le immagini, contro i limiti di asset-limits.mjs.
//
//   node db/prod/storage.mjs --tree <dir> [--guard] [--out storage.md] [--attention a.md]
//   DATABASE_URL=... node db/prod/storage.mjs [--out storage.md] [--attention a.md]
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... node db/prod/storage.mjs --prod ...
//
// --tree conta l'albero che sta per andare su Cloudflare Pages (file per
// kind, _headers compreso), --guard rifiuta il deploy se Pages lo
// rifiuterebbe: troppi file, o un file oltre 25 MiB. Senza --tree conta la
// tabella asset (solo SELECT, in una transazione read only). --attention
// aggiunge una riga fra le cose da guardare dall'80% in su.
//
// La CI deploya con wrangler, non con scripts/assets-deploy.mjs: senza
// questo passo il controllo dei 20.000 file in CI non c'era.
import { appendFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { avvisiSpazio, kindOfKey, rapportoSpazio, spazioMarkdown } from '../import/asset-limits.mjs'

const CI = process.env.GITHUB_ACTIONS === 'true'

/** L'albero dei file: kind -> { files, bytes }, _headers fuori dal conto. */
export function contaAlbero(dir) {
  /** @type {Record<string, { files: number, bytes: number }>} */
  const perTipo = {}
  let files = 0, piuGrande = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!e.isFile()) continue
      const key = relative(dir, p).split(sep).join('/')
      if (key === '_headers') continue
      const size = statSync(p).size
      const kind = kindOfKey(key) ?? 'other'
      perTipo[kind] ??= { files: 0, bytes: 0 }
      perTipo[kind].files++; perTipo[kind].bytes += size
      files++; piuGrande = Math.max(piuGrande, size)
    }
  }
  walk(dir)
  return { files, perTipo, piuGrande }
}

/** La tabella asset: kind -> { files, bytes }. @param {import('pg').ClientBase} client */
export async function contaTabella(client) {
  const { rows } = await client.query(`
    select kind::text, count(*)::int as files, coalesce(sum(byte_size), 0)::bigint as bytes,
           coalesce(max(byte_size), 0)::bigint as max
    from asset group by kind order by kind`)
  /** @type {Record<string, { files: number, bytes: number }>} */
  const perTipo = {}
  let files = 0, piuGrande = 0
  for (const r of rows) {
    perTipo[r.kind] = { files: r.files, bytes: Number(r.bytes) }
    files += r.files; piuGrande = Math.max(piuGrande, Number(r.max))
  }
  return { files, perTipo, piuGrande }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const tree = val('--tree')
  let conto
  if (tree) {
    try { conto = contaAlbero(tree) } catch (err) {
      console.error(`\n  storage: ${tree} non si legge (${err.message})\n`); process.exit(1)
    }
  } else {
    let url
    if (argv.includes('--prod')) {
      const { resolveTarget } = await import('./target.mjs')
      try { url = resolveTarget(process.env, { allowLocal: argv.includes('--allow-local') }).url } catch (err) {
        console.error(`\n  storage: ${err.message}\n`); process.exit(1)
      }
    } else url = (await import('../env.mjs')).connectionString()
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    try {
      await c.query('begin transaction read only')
      conto = await contaTabella(c)
    } finally {
      await c.query('rollback').catch(() => {})
      await c.end()
    }
  }
  const r = rapportoSpazio(conto)
  console.log(`  ${tree ? `albero ${tree}` : 'tabella asset'}: ${r.files} file con _headers (${r.filesPct}% di 20.000),` +
              ` artwork animati ${(r.anim.bytes / 1024 / 1024).toFixed(1)} MiB (${r.anim.pct}% del budget)`)
  if (val('--out')) writeFileSync(val('--out'), spazioMarkdown(r, tree ? 'Storage (deploy)' : 'Storage') + '\n')
  const avvisi = avvisiSpazio(r)
  for (const a of avvisi) {
    console.log(CI ? `::warning::storage: ${a}` : `  attenzione: ${a}`)
    if (val('--attention')) appendFileSync(val('--attention'), `- Storage: ${a}.\n`)
  }
  if (argv.includes('--guard') && r.rifiuto) {
    console.log(`::error::deploy refused: production not touched (${avvisi[0] ?? 'over the Cloudflare Pages limits'})`)
    process.exit(1)
  }
}
