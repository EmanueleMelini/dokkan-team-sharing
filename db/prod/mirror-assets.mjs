#!/usr/bin/env node
// Ricostruisce l'albero completo delle immagini dalla nostra CDN.
//
//   DATABASE_URL=... node db/prod/mirror-assets.mjs --from https://<cdn> --to <dir>
//        [--extra <dir>] [--min-files N] [--concurrency 16]
//
// Perche' serve: un deploy di Cloudflare Pages e' una fotografia intera.
// Pubblicare solo le immagini nuove cancellerebbe tutte le altre dalla
// produzione. Quindi la CI scarica ogni file che la tabella asset conosce,
// lo verifica (byte e sha256 della riga), ci aggiunge i file nuovi
// (--extra, verificati anch'essi) e solo allora l'albero si puo'
// pubblicare. Se manca anche un file, o l'albero ha meno file delle righe,
// si ferma: meglio nessun deploy che un deploy che toglie immagini.
//
// Al proprietario serve anche per rifare public/assets su una macchina
// nuova: --to public/assets. I file gia' presenti e giusti non si
// riscaricano, quindi si puo' interrompere e rilanciare.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'

// le stesse intestazioni di scripts/assets-deploy.mjs: il deploy sostituisce
// anche _headers, e senza le immagini perderebbero la cache di un anno
export const HEADERS = `/*
  Cache-Control: public, max-age=31536000, immutable
  X-Content-Type-Options: nosniff
`

// Pura: null se il file e' quello della riga, altrimenti il motivo.
/** @param {Buffer} buf @param {{ byte_size: number, checksum: string | null }} row */
export function verifyFile(buf, row) {
  if (buf.length !== Number(row.byte_size)) return `size ${buf.length}, expected ${row.byte_size}`
  if (!row.checksum) return 'no checksum in the asset row'
  const h = createHash('sha256').update(buf).digest('hex')
  return h === row.checksum ? null : 'sha256 mismatch'
}

// Pura: l'albero da pubblicare deve avere almeno un file per riga.
export function treeGuard(files, rows, minFiles = 0) {
  if (files < rows) return `the tree has ${files} files but asset has ${rows} rows`
  if (files < minFiles) return `the tree has ${files} files, fewer than the ${minFiles} required`
  return null
}

export function countFiles(dir) {
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(join(dir, e.name))
    else if (e.isFile() && e.name !== '_headers') n++
  }
  return n
}

// la chiave diventa un percorso sotto la radice, mai fuori (../, assoluti)
export function safePath(root, key) {
  const p = resolve(root, key)
  if (!p.startsWith(resolve(root) + sep) || /(^|\/)\.\.(\/|$)/.test(key)) throw new Error(`chiave non valida: ${key}`)
  return p
}

async function fetchVerified(base, row, attempt = 1) {
  const u = `${base.replace(/\/$/, '')}/${row.key.split('/').map(encodeURIComponent).join('/')}`
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(60000) })
    if (res.status >= 500 && attempt < 4) throw new Error(`HTTP ${res.status}`)
    if (!res.ok) return { err: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    const bad = verifyFile(buf, row)
    return bad ? { err: bad } : { buf }
  } catch (err) {
    if (attempt >= 4) return { err: err.message }
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return fetchVerified(base, row, attempt + 1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { connectionString } = await import('../env.mjs')
  const argv = process.argv.slice(2)
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
  const from = val('--from'), to = val('--to'), extra = val('--extra')
  const conc = Number(val('--concurrency', 16))
  if (!from || !to) { console.error('  uso: mirror-assets.mjs --from <url> --to <dir> [--extra <dir>]'); process.exit(1) }
  if (!/^https:\/\//.test(from) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(from)) {
    console.error('  --from deve essere https'); process.exit(1)
  }
  const c = new pg.Client({ connectionString: connectionString() })
  await c.connect()
  const { rows } = await c.query('select key, byte_size, checksum from asset order by key')
  await c.end()
  mkdirSync(to, { recursive: true })
  // i file nuovi prima: le loro righe sono gia' in asset (il giro di prova
  // le ha appena scritte) ma sulla CDN non ci sono ancora. Copiati qui, il
  // giro sotto li trova e li verifica come gli altri.
  if (extra && existsSync(extra)) {
    cpSync(extra, to, { recursive: true, force: true })
    console.log(`  copiati i file nuovi di ${extra}`)
  }

  let ok = 0, fetched = 0, bytes = 0
  const bad = []
  const queue = [...rows]
  await Promise.all(Array.from({ length: conc }, async () => {
    while (queue.length) {
      const row = queue.shift()
      const dest = safePath(to, row.key)
      if (existsSync(dest) && !verifyFile(readFileSync(dest), row)) { ok++; continue }
      const r = await fetchVerified(from, row)
      if (r.err) { bad.push(`${row.key}: ${r.err}`); continue }
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest + '.partial', r.buf)
      renameSync(dest + '.partial', dest)
      ok++; fetched++; bytes += r.buf.length
      if (fetched % 200 === 0) process.stdout.write(`\r  scaricati ${fetched}, ${(bytes / 1e6).toFixed(0)} MB`)
    }
  }))
  console.log(`\r  ${rows.length} righe: ${ok} file verificati (${fetched} scaricati, ${(bytes / 1e6).toFixed(1)} MB), ${bad.length} mancanti`)
  if (bad.length) {
    for (const b of bad.slice(0, 10)) console.error(`    ${b}`)
    console.error(`\n  ${bad.length} file non verificati: l'albero e' incompleto, non si pubblica\n`)
    process.exit(1)
  }
  writeFileSync(join(to, '_headers'), HEADERS)
  const files = countFiles(to)
  const guard = treeGuard(files, rows.length, Number(val('--min-files', 0)))
  if (guard) { console.error(`\n  ${guard}: non si pubblica\n`); process.exit(1) }
  console.log(`  albero pronto: ${files} file (righe in asset: ${rows.length})`)
}
