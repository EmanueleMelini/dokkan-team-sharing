#!/usr/bin/env node
// Su Supabase lo schema public e' esposto dalla Data API (PostgREST) ai
// ruoli anon e authenticated, e i privilegi di default gli danno accesso a
// ogni tabella nuova. La chiave anon e' pubblica per costruzione: senza RLS
// chiunque leggerebbe auth_session o le email di app_user. Noi la Data API
// non la usiamo (il sito parla SQL con il proprio utente), quindi la prima
// difesa e' spegnerla nella dashboard; questa e' la seconda: a quei ruoli
// si tolgono tutti i privilegi su public, anche per gli oggetti futuri.
//
// Fuori da Supabase quei ruoli non esistono e il passo non fa niente.
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { connectionString } from '../env.mjs'

export const SUPABASE_API_ROLES = ['anon', 'authenticated']

// Pura, per i test. Idempotente: revocare un privilegio assente non e' un errore.
export function hardenSql(roles) {
  const to = roles.map((r) => `"${r.replace(/"/g, '""')}"`).join(', ')
  return [
    `revoke all on all tables in schema public from ${to}`,
    `revoke all on all sequences in schema public from ${to}`,
    `revoke all on all functions in schema public from ${to}`,
    `alter default privileges in schema public revoke all on tables from ${to}`,
    `alter default privileges in schema public revoke all on sequences from ${to}`,
    `alter default privileges in schema public revoke all on functions from ${to}`,
  ]
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const c = new pg.Client({ connectionString: connectionString() })
  await c.connect()
  const { rows } = await c.query('select rolname from pg_roles where rolname = any($1)', [SUPABASE_API_ROLES])
  const roles = rows.map((r) => r.rolname)
  if (!roles.length) {
    console.log('  nessun ruolo della Data API (non e\' Supabase): niente da revocare')
  } else {
    await c.query('begin')
    for (const sql of hardenSql(roles)) await c.query(sql)
    await c.query('commit')
    const { rows: left } = await c.query(`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and grantee = any($1)`, [roles])
    console.log(`  privilegi su public tolti a ${roles.join(', ')}: restano ${left[0].n} grant su tabelle`)
  }
  await c.end()
}
