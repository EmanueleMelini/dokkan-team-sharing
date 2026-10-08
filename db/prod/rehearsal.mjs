#!/usr/bin/env node
// Prepara il database del giro di prova da un dump di dump.mjs: le
// estensioni negli stessi schemi della produzione, poi pg_restore.
//
//   DATABASE_URL=postgres://...@localhost/<vuoto> node db/prod/rehearsal.mjs --dump prod.dump
//
// Solo verso un database locale e vuoto: e' una copia usa e getta, e un
// ripristino sopra la produzione o sopra dati esistenti non deve poter
// succedere nemmeno per un errore di variabile.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { connectionString } from '../env.mjs'
import { pickPgDump, splitPassword } from './pgdump.mjs'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`

const argv = process.argv.slice(2)
const dump = argv[argv.indexOf('--dump') + 1]
if (!argv.includes('--dump') || !dump) { console.error('  uso: rehearsal.mjs --dump <file>'); process.exit(1) }

const url = connectionString()
const u = new URL(url)
if (!LOCAL.has(u.hostname)) { console.error(`\n  ${u.hostname} non e' locale: il giro di prova si ripristina solo in locale\n`); process.exit(1) }
if (u.pathname.slice(1) === 'dokkanteamsharing') { console.error('\n  quel database non e\' di questo progetto\n'); process.exit(1) }

const { server_major: major, extensions } = JSON.parse(readFileSync(`${dump}.extensions.json`, 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
const { rows: [{ n }] } = await c.query(`
  select count(*)::int as n from pg_class k join pg_namespace s on s.oid = k.relnamespace
  where s.nspname = 'public' and k.relkind in ('r', 'p', 'v', 'm', 'S')`)
if (n) { await c.end(); console.error(`\n  il database non e' vuoto (${n} oggetti in public): mi fermo\n`); process.exit(1) }
// Il dump con -n public contiene CREATE SCHEMA public e le estensioni che
// stanno li': lo schema vuoto si toglie e lo ricrea pg_restore. Quelle in
// altri schemi (Supabase: extensions) il dump le crea WITH SCHEMA <loro>,
// e quello schema qui va creato prima.
await c.query('drop schema if exists public')
for (const e of extensions.filter((x) => x.nspname !== 'public')) {
  await c.query(`create schema if not exists ${ident(e.nspname)}`)
  await c.query(`create extension if not exists ${ident(e.extname)} with schema ${ident(e.nspname)}`)
}
// Su Supabase il search_path del database comprende "extensions": le
// funzioni che chiamano citext, pg_trgm o pgcrypto senza schema lo danno
// per scontato. pg_dump -n non porta le impostazioni del database, quindi
// qui si rimette uguale; vale per le connessioni dopo questa.
const altri = [...new Set(extensions.map((e) => e.nspname).filter((n) => n !== 'public'))]
if (altri.length) {
  const { rows: [{ db }] } = await c.query('select current_database() as db')
  await c.query(`alter database ${ident(db)} set search_path = "$user", public, ${altri.map(ident).join(', ')}`)
}
await c.end()
console.log(`  estensioni: ${extensions.map((e) => `${e.extname} in ${e.nspname}`).join(', ') || 'nessuna'}`)

const found = pickPgDump(major, 'pg_restore')
if (!found) { console.error(`\n  nessun pg_restore >= ${major}\n`); process.exit(1) }
const { url: dbUrl, env } = splitPassword(url, process.env)
const r = spawnSync(found.bin, ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', dbUrl, dump],
  { env, stdio: 'inherit' })
if (r.status !== 0) { console.error(`\n  pg_restore e' uscito con ${r.status ?? r.signal}\n`); process.exit(1) }
console.log(`  ripristinato con ${found.bin} (${found.major})`)
