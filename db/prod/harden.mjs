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

// Le revoche ai ruoli non bastano per le funzioni: Postgres concede EXECUTE a
// PUBLIC su ogni funzione nuova, e anon e authenticated lo ereditano. Con la
// Data API accesa chiunque avesse la chiave anon chiamerebbe i nostri verbi,
// set_user_role compreso. Si toglie PUBLIC solo dalle funzioni di chi
// lancia lo script (le nostre) e fuori dalle estensioni: quelle di citext,
// pg_trgm e btree_gist stanno in public ma sono di supabase_admin, e senza il
// loro EXECUTE il sito smetterebbe di confrontare gli handle. Il proprietario
// tiene il suo EXECUTE; la riga dei default copre le funzioni future.
export function funzioniNostreSql() {
  return [
    `do $$ declare f record; begin
       for f in select p.oid::regprocedure as firma from pg_proc p
                 where p.pronamespace = 'public'::regnamespace
                   and p.proowner = (select oid from pg_roles where rolname = current_user)
                   and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                                     and d.objid = p.oid and d.deptype = 'e')
       loop execute format('revoke execute on function %s from public', f.firma); end loop;
     end $$`,
    'alter default privileges in schema public revoke execute on functions from public',
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
    for (const sql of [...hardenSql(roles), ...funzioniNostreSql()]) await c.query(sql)
    await c.query('commit')
    const { rows: left } = await c.query(`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and grantee = any($1)`, [roles])
    const { rows: fn } = await c.query(`
      select count(*) filter (where has_function_privilege(r, p.oid, 'execute'))::int as n
      from pg_proc p cross join unnest($1::text[]) r
      where p.pronamespace = 'public'::regnamespace
        and p.proowner = (select oid from pg_roles where rolname = current_user)`, [roles])
    console.log(`  privilegi su public tolti a ${roles.join(', ')}: restano ${left[0].n} grant su tabelle, ${fn[0].n} funzioni nostre eseguibili`)
  }
  await c.end()
}
