#!/usr/bin/env node
// Fotografia del database per il controllo dell'aggiornamento settimanale.
// Solo SELECT, in una transazione read only.
//
//   DATABASE_URL=... node db/prod/snapshot.mjs [--out file.json]
//   PROD_DATABASE_URL=... PROD_DATABASE_CA_CERT=... node db/prod/snapshot.mjs --prod --out f.json
//
// Con --prod il bersaglio lo decide target.mjs (TLS verificato), come per
// gli altri script di produzione; e' comunque solo lettura.
//
// Per le tabelle di gioco (content in tables.mjs) una mappa chiave -> hash
// della riga: basta per dire cosa e' stato aggiunto, tolto o cambiato. Per
// quelle degli utenti solo il conteggio e un md5 di tutte le righe: la
// fotografia non contiene nessun dato degli utenti (finisce nei log di un
// repository pubblico), ma qualsiasi cambiamento cambia l'md5.
//
// Una tabella che tables.mjs non classifica e' un errore: vedi li'.
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { TABLES, unclassified } from './tables.mjs'

const ident = (s) => `"${s.replace(/"/g, '""')}"`

async function primaryKey(client, table) {
  const { rows } = await client.query(`
    select a.attname from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = $1::regclass and i.indisprimary
    order by array_position(i.indkey::int2[], a.attnum)`, [`public.${ident(table)}`])
  return rows.map((r) => r.attname)
}

async function contentRows(client, table, spec) {
  const cols = spec.key ?? await primaryKey(client, table)
  // senza chiave la riga intera fa da chiave (doppioni numerati sotto)
  const keyExpr = spec.keySql ?? (cols.length
    ? `array_to_string(array[${cols.map((c) => `t.${ident(c)}::text`).join(', ')}], '|', '~')`
    : 't::text')
  const { rows } = await client.query(`
    select ${keyExpr} as k, left(md5((to_jsonb(t) - $1::text[])::text), 12) as h
    from public.${ident(table)} t order by 1, 2`, [spec.ignore ?? []])
  /** @type {Record<string, string>} */
  const out = {}
  for (const r of rows) {
    let k = r.k
    for (let n = 2; Object.hasOwn(out, k); n++) k = `${r.k}#${n}`
    out[k] = r.h
  }
  return out
}

async function opaque(client, table) {
  const { rows } = await client.query(`
    select count(*)::int as n, md5(coalesce(string_agg(x, E'\\n' order by x), '')) as h
    from (select t::text as x from public.${ident(table)} t) s`)
  return { count: rows[0].n, hash: rows[0].h }
}

async function names(client, sql) {
  const { rows } = await client.query(sql)
  return Object.fromEntries(rows.map((r) => [String(r.id), r.name]))
}

/**
 * @param {import('pg').ClientBase} client
 * @param {{ tables?: typeof TABLES, inTransaction?: boolean, contentOnly?: boolean }} [opts]
 *   inTransaction: dentro una transazione gia' aperta (i test, che poi la
 *   annullano): niente begin/commit propri
 *   contentOnly: solo le tabelle di gioco, senza conteggi e md5 di quelle
 *   degli utenti ne' i nomi (update.mjs, per sapere cosa rinfrescare)
 */
export async function takeSnapshot(client, { tables = TABLES, inTransaction = false, contentOnly = false } = {}) {
  if (!inTransaction) await client.query('begin isolation level repeatable read read only')
  try {
    // le chiavi con un orario (event_run.starts_at) non devono dipendere
    // dal fuso della sessione
    await client.query(`set local timezone = 'UTC'`)
    const { rows } = await client.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      order by 1`)
    const present = rows.map((r) => r.relname)
    const missing = unclassified(present)
    if (missing.length) {
      throw new Error(`tabelle non classificate in db/prod/tables.mjs: ${missing.join(', ')}`)
    }
    /** @type {Record<string, any>} */
    const out = {}
    for (const t of present) {
      const spec = tables[t]
      if (spec.class === 'content') {
        const r = await contentRows(client, t, spec)
        out[t] = { class: 'content', count: Object.keys(r).length, rows: r }
      } else if (spec.class === 'user' && !contentOnly) {
        out[t] = { class: 'user', ...await opaque(client, t) }
      } else if (spec.class === 'user') {
        out[t] = { class: 'user' }
      } else {
        out[t] = { class: 'system' }
      }
    }
    /** @type {Record<string, Record<string, string>>} */
    const nm = contentOnly ? {} : {
      card: await names(client, `select card_id as id, name from card_text where locale = 'en'`),
      event: await names(client, `select event_id as id, name from event_text where locale = 'en'`),
    }
    if (!inTransaction) await client.query('commit')
    return { version: 1, taken_at: new Date().toISOString(), tables: out, names: nm }
  } catch (err) {
    if (!inTransaction) await client.query('rollback').catch(() => {})
    throw err
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--out')
  let url
  if (argv.includes('--prod')) {
    const { resolveTarget } = await import('./target.mjs')
    try { url = resolveTarget(process.env, { allowLocal: argv.includes('--allow-local') }).url } catch (err) {
      console.error(`\n  snapshot: ${err.message}\n`); process.exit(1)
    }
  } else url = (await import('../env.mjs')).connectionString()
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    const snap = await takeSnapshot(c)
    const json = JSON.stringify(snap)
    if (i >= 0) {
      writeFileSync(argv[i + 1], json + '\n')
      const n = Object.values(snap.tables).filter((t) => t.class !== 'system').length
      console.error(`  snapshot: ${n} tabelle in ${argv[i + 1]} (${(json.length / 1e6).toFixed(1)} MB)`)
    } else process.stdout.write(json + '\n')
  } catch (err) {
    console.error(`\n  snapshot fallito: ${err.message}\n`)
    process.exitCode = 1
  } finally { await c.end() }
}
