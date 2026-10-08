#!/usr/bin/env node
// Il ruolo di un utente, da riga di comando: l'unico modo di creare il
// primo admin. Dal sito i ruoli non si cambiano mai (0024, set_user_role).
//
//   npm run db:role -- <handle> admin|editor|member         DATABASE_URL (lo sviluppo)
//   npm run prod:role -- <handle> admin|editor|member --yes  PROD_DATABASE_URL
//
// prod:role passa da db/prod/target.mjs come gli altri script di
// produzione: rifiuta dokkanteamsharing, i database locali e i nomi
// *_dev/*_test, vuole la CA e --yes; poi rilancia questo stesso script con
// l'ambiente ripulito (DATABASE_URL = la produzione, niente .env.local).
//
// Stampa il ruolo prima e dopo. Vale dalla richiesta successiva: le
// sessioni non tengono il ruolo in cache. Esce 0 se e' andata, 1 se
// l'handle non esiste o il database rifiuta, 2 se gli argomenti sono
// sbagliati (o, in produzione, senza --yes).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROLES = ['member', 'editor', 'admin']
// il vecchio database di un altro progetto sullo stesso server: mai
const FORBIDDEN_DBS = new Set(['dokkanteamsharing'])

// Pura, per i test: gli argomenti senza i flag.
export function parseArgs(argv) {
  const pos = argv.filter((a) => !a.startsWith('--'))
  const [handle, role] = pos
  const ok = pos.length === 2 && !!handle?.trim() && ROLES.includes(role)
  return { ok, handle: handle?.trim() ?? '', role: role ?? '', prod: argv.includes('--prod') }
}

const USO = '  uso: npm run db:role -- <handle> member|editor|admin\n' +
            '       npm run prod:role -- <handle> member|editor|admin --yes'

async function locale(handle, role) {
  // solo qui: env.mjs legge .env.local, che in produzione non deve entrare
  const { connectionString, describeTarget } = await import('../env.mjs')
  const url = connectionString()
  const db = decodeURIComponent(new URL(url).pathname.slice(1))
  if (FORBIDDEN_DBS.has(db)) {
    console.error(`\n  ${db} non e' di questo progetto: non lo tocco\n`)
    process.exit(1)
  }
  console.log(`  database: ${describeTarget()}`)
  const { default: pg } = await import('pg')
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const prima = await c.query('select handle::text, role from app_user where handle = $1::citext', [handle])
    if (!prima.rows.length) {
      console.error(`\n  nessun utente con handle ${handle}\n`)
      return 1
    }
    await c.query('select set_user_role($1::citext, $2)', [handle, role])
    const dopo = await c.query('select role from app_user where handle = $1::citext', [handle])
    const { handle: h, role: vecchio } = prima.rows[0]
    const nuovo = dopo.rows[0].role
    console.log(`  ${h}: ${vecchio} -> ${nuovo}${vecchio === nuovo ? ' (gia\' cosi\', niente da fare)' : ''}`)
    return 0
  } catch (err) {
    console.error(`\n  il database rifiuta: ${err.constraint ?? err.message}\n`)
    return 1
  } finally {
    await c.end()
  }
}

async function produzione(handle, role) {
  const { prepare } = await import('../prod/target.mjs')
  const { env } = prepare('prod:role', [`set_user_role(${handle}, ${role})`])
  const self = fileURLToPath(import.meta.url)
  const r = spawnSync(process.execPath, [self, handle, role], { stdio: 'inherit', env })
  return r.status ?? 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2))
  if (!a.ok) {
    console.error(`\n${USO}\n`)
    process.exit(2)
  }
  process.exit(a.prod ? await produzione(a.handle, a.role) : await locale(a.handle, a.role))
}
