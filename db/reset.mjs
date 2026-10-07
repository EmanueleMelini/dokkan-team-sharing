#!/usr/bin/env node
// Ricostruisce un database da zero: lo cancella, lo ricrea e applica le
// migrazioni. Con --fixture carica anche i dati finti dei test
// (db/test/fixture): li chiedono solo i test, il database di sviluppo
// contiene solo dati veri, così la lista eventi non mostra eventi inventati.
// La barriera fra "ricreo lo sviluppo" e "ho cancellato roba tua": prima
// di distruggere niente, si guarda DENTRO il database. Va bene procedere
// solo se e' vuoto, o se contiene la nostra schema_migrations — cioe' se
// e' nostro. Se ha tabelle che non abbiamo creato noi, si ferma.
//
// Il criterio precedente era il nome (doveva finire per _dev). Non serve
// a niente: puntando su un database chiamato bene ma pieno di roba di
// qualcun altro l'avrebbe cancellata comunque.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { connectionString, describeTarget } from './env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const url = new URL(connectionString())
console.log(`  database: ${describeTarget()}`)

const name = url.pathname.slice(1)

{
  const probe = new pg.Client({ connectionString: url.href })
  try {
    await probe.connect()
    const { rows } = await probe.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`)
    const ours = rows.some((r) => r.table_name === 'schema_migrations')
    if (rows.length && !ours) {
      console.error(`\n  mi fermo: "${name}" contiene ${rows.length} tabelle che non ho creato io`)
      console.error(`  e non c'e' schema_migrations, quindi questo database non e' del progetto.`)
      console.error(`  Trovate: ${rows.slice(0, 8).map((r) => r.table_name).join(', ')}${rows.length > 8 ? ', ...' : ''}`)
      console.error(`\n  Punta DATABASE_URL su un database vuoto, o su uno creato da qui.\n`)
      await probe.end(); process.exit(1)
    }
  } catch (err) {
    // il database non esiste ancora: va benissimo, lo creiamo noi
    if (!/does not exist/i.test(err.message)) {
      console.error(`\n  non riesco a ispezionare "${name}": ${err.message}\n`)
      process.exit(1)
    }
  } finally {
    try { await probe.end() } catch { /* era gia' chiuso */ }
  }
}

const admin = new pg.Client({ connectionString: new URL('/postgres', url).href })
await admin.connect()
await admin.query(`drop database if exists ${JSON.stringify(name).replace(/"/g, '"')} with (force)`)
await admin.query(`create database "${name}"`)
await admin.end()
console.log(`  database "${name}" ricreato`)

const run = (args) => {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
run([join(HERE, 'migrate.mjs')])

if (!process.argv.includes('--fixture')) process.exit(0)

const seedDir = join(HERE, 'test', 'fixture')
const seeds = readdirSync(seedDir).filter((f) => f.endsWith('.sql')).sort()
const client = new pg.Client({ connectionString: url.href })
await client.connect()
for (const f of seeds) {
  await client.query('begin')
  try {
    await client.query(readFileSync(join(seedDir, f), 'utf8'))
    await client.query('commit')
    console.log(`  caricato   ${f}`)
  } catch (err) {
    await client.query('rollback')
    console.error(`\n  ${f} e' fallito: ${err.message}\n`)
    await client.end()
    process.exit(1)
  }
}
await client.end()
