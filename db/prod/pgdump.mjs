// pg_dump della produzione: quale binario, quali estensioni, come passare
// la password. In comune fra prod:backup (la copia sul Mac) e dump.mjs
// (la copia cifrata e il giro di prova della CI).
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

// Le estensioni che servono alle nostre tabelle. Con --schema pg_dump le
// lascerebbe fuori, e il dump non si ripristinerebbe su un database vuoto
// (citext, btree_gist e pg_trgm servono alle colonne e agli indici).
// Solo queste: quelle di Supabase (pgsodium, pg_graphql...) un Postgres
// normale non le ha.
export const OUR_EXTENSIONS = ['pgcrypto', 'citext', 'btree_gist', 'pg_trgm']

export async function serverInfo(url) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const v = Number((await c.query('show server_version_num')).rows[0].server_version_num)
    const { rows: ext } = await c.query(`
      select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = any($1) order by 1`, [OUR_EXTENSIONS])
    return { major: Math.floor(v / 10000), extensions: ext }
  } finally { await c.end() }
}

// La versione del server decide il pg_dump: uno piu' vecchio del server
// si rifiuta, uno uguale o piu' nuovo va bene. Si preferisce quello della
// stessa versione (Postgres.app 15 sul Mac, postgresql-client-17 in CI).
export function pickPgDump(serverMajor, tool = 'pg_dump') {
  const out = []
  const envBin = tool === 'pg_dump' ? process.env.PG_DUMP : process.env.PG_RESTORE
  if (envBin) out.push(envBin)
  const app = '/Applications/Postgres.app/Contents/Versions'
  if (existsSync(app)) for (const v of readdirSync(app)) out.push(join(app, v, 'bin', tool))
  for (const v of [17, 16, 15]) out.push(`/usr/lib/postgresql/${v}/bin/${tool}`)
  out.push(tool)
  const majorOf = (bin) => {
    try {
      const m = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).match(/(\d+)\.\d+/)
      return m ? Number(m[1]) : null
    } catch { return null }
  }
  const found = [...new Set(out)].map((bin) => ({ bin, major: majorOf(bin) }))
    .filter((x) => x.major != null && x.major >= serverMajor)
    .sort((a, b) => (a.major - serverMajor) - (b.major - serverMajor))
  return found[0] ?? null
}

// La password non va sulla riga di comando (si vede in ps): passa da
// PGPASSWORD, e l'URL resta senza.
export function splitPassword(url, env) {
  const u = new URL(url)
  const out = { ...env }
  if (u.password) { out.PGPASSWORD = decodeURIComponent(u.password); u.password = '' }
  return { url: u.href, env: out }
}

export const dumpArgs = (url) => ['--dbname', url, '--schema', 'public',
  ...OUR_EXTENSIONS.flatMap((e) => ['--extension', e]), '--no-owner', '--no-privileges']
