// Verifica Settings (migrazione 0019, lib/auth/account.ts): scollegare un
// provider solo se resta un modo di entrare, e cancellare l'account con
// tutto quello che l'utente ha scritto, senza toccare gli altri.
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// settingstest+...@example.invalid e li toglie alla fine, anche se
// qualcosa fallisce.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createAuth } from '@/lib/auth/config'
import { readAuthEnv } from '@/lib/auth/env'
import {
  ACCOUNT_CONSTRAINTS, canUnlink, friendlyAccountError, handleMatches, signInMethodsLeft,
} from '@/lib/auth/account'
import { db } from '@/lib/db'
import {
  SUBMIT, check, copia, dati, esito, guardia, num, one, payload, q, stato, utente,
} from '@/db/test/builder-helpers'

guardia()
const P = 'settingstest'

function pure() {
  console.log('\n  -- regole in TypeScript (funzioni pure)')
  check('due provider, email non verificata: se ne scollega uno', canUnlink(['discord', 'google'], false, 'discord'))
  check('un provider, email non verificata: non si scollega', !canUnlink(['discord'], false, 'discord'))
  check('un provider, email verificata: si scollega (resta il link)', canUnlink(['discord'], true, 'discord'))
  check('un provider non collegato non si scollega', !canUnlink(['discord'], true, 'google'))
  check('i modi che restano contano il link solo se verificato',
    signInMethodsLeft(['discord', 'twitch'], true, 'discord') === 2 &&
    signInMethodsLeft(['discord', 'twitch'], false, 'discord') === 1 &&
    signInMethodsLeft([], false) === 0)
  check('l\'handle coincide senza badare a maiuscole e spazi', handleMatches('  GoKu_99 ', 'goku_99'))
  check('un handle diverso non coincide', !handleMatches('goku_9', 'goku_99') && !handleMatches('goku_99x', 'goku_99'))
  check('vuoto o non testo non coincide', !handleMatches('', 'goku_99') && !handleMatches(null, 'goku_99') &&
    !handleMatches('goku', ''))

  // Ogni nome di vincolo che 0019 alza ha una frase inglese.
  const sql = readFileSync(new URL('../migrations/0019_account_settings.sql', import.meta.url), 'utf8')
  const nomi = [...new Set([...sql.matchAll(/constraint = '([a-z_]+)'/g)].map((m) => m[1]))]
  const senza = nomi.filter((n) => !friendlyAccountError({ constraint: n }))
  check('ogni rifiuto di 0019 ha una frase', nomi.length === 4 && senza.length === 0, senza.join(', '))
  check('e la tabella delle frasi non ha nomi in piu\'', ACCOUNT_CONSTRAINTS.every((n) => nomi.includes(n)))
  check('un errore sconosciuto non ha frase (e un guasto)', friendlyAccountError({ code: '23505' }) === null)
}

/** Ogni FK verso le persone e i clear cancella a cascata: nessun residuo possibile. */
async function cascate() {
  console.log('\n  -- le FK verso app_user, clear e versioni')
  const fk = await q<{ figlia: string; madre: string; nome: string; del: string }>(
    `select conrelid::regclass::text as figlia, confrelid::regclass::text as madre,
            conname as nome, confdeltype::text as del
       from pg_constraint
      where contype = 'f'
        and confrelid in ('app_user'::regclass, 'clear'::regclass, 'clear_version'::regclass,
                          'clear_lineup'::regclass, 'clear_lineup_card'::regclass,
                          'clear_lineup_build'::regclass, 'team'::regclass, 'lineup'::regclass,
                          'lineup_slot'::regclass, 'tip'::regclass)`)
  // clear.team_id -> team e' "set null" apposta (0001): la squadra si puo'
  // togliere senza perdere il clear. Con l'account se ne va anche il clear.
  const nonCascata = fk.filter((f) => f.del !== 'c' && f.nome !== 'clear_team_id_fkey')
  check('tutte le FK verso utenti, clear e squadre sono on delete cascade',
    fk.length >= 20 && nonCascata.length === 0, nonCascata.map((f) => `${f.figlia}.${f.nome}=${f.del}`).join(', '))
  const versoUtente = fk.filter((f) => f.madre === 'app_user').map((f) => f.figlia).sort()
  check('le tabelle che puntano a app_user sono quelle note',
    versoUtente.join(',') === 'auth_account,auth_session,clear,clear_comment,clear_vote,clear_write_log,report,team,tip,tip_vote',
    versoUtente.join(','))
  const trig = await num(
    `select count(*) from pg_trigger where tgname = 'report_target_gone'
        and tgrelid in ('clear'::regclass, 'tip'::regclass, 'clear_proof'::regclass)`)
  check('report (target polimorfico, senza FK) ha il trigger su clear, tip e prove', trig === 3)
}

const UNLINK = 'select unlink_provider($1::uuid, $2)'
const providers = async (u: string) =>
  (await q<{ p: string }>('select provider_id as p from auth_account where user_id = $1 order by 1', [u])).map((r) => r.p)

async function collega(u: string, ...lista: string[]) {
  for (const p of lista) {
    await db.query('insert into auth_account (account_id, provider_id, user_id) values ($1, $2, $3)',
      [`${P}-${p}-${randomBytes(4).toString('hex')}`, p, u])
  }
}

async function scollega() {
  console.log('\n  -- unlink_provider')
  const a = await utente(P, 'stunlink_a')
  const b = await utente(P, 'stunlink_b')
  await collega(a, 'discord', 'google')
  await collega(b, 'discord')

  check('un provider non collegato: provider_not_linked', await esito(UNLINK, [a, 'twitch']) === '23514 provider_not_linked')
  check('un utente inesistente: account_missing',
    await esito(UNLINK, ['00000000-0000-0000-0000-00000000dead', 'discord']) === '42501 account_missing')
  check('email non verificata, due provider: il primo si scollega', await esito(UNLINK, [a, 'discord']) === 'ok')
  check('e resta solo l\'altro', (await providers(a)).join() === 'google')
  check('l\'ultimo no: last_sign_in_method', await esito(UNLINK, [a, 'google']) === '23514 last_sign_in_method')
  check('e la riga resta', (await providers(a)).join() === 'google')
  check('il Discord di un altro utente non si tocca', (await providers(b)).join() === 'discord')

  await db.query('update app_user set email_verified = true where id = $1', [a])
  check('con l\'email verificata anche l\'ultimo si scollega (resta il link)', await esito(UNLINK, [a, 'google']) === 'ok')
  check('e non ha piu\' provider', (await providers(a)).length === 0)
  check('b ha ancora il suo provider', (await providers(b)).join() === 'discord')

  // Due richieste insieme sullo stesso utente non verificato con due
  // provider: il lock sulla riga dell'utente le mette in fila, e la
  // seconda vede che e' rimasto un solo modo di entrare.
  const c = await utente(P, 'stunlink_c')
  await collega(c, 'discord', 'twitch')
  const uno = await db.connect()
  const due = await db.connect()
  let secondo = ''
  try {
    await uno.query('begin')
    await uno.query(UNLINK, [c, 'discord'])
    await due.query('begin')
    const attesa = due.query(UNLINK, [c, 'twitch']).then(
      () => 'ok',
      (e: { code?: string; constraint?: string }) => `${e.code} ${e.constraint}`,
    )
    await new Promise((r) => setTimeout(r, 150)) // la seconda e' ferma sul lock
    await uno.query('commit')
    secondo = await attesa
    await due.query(secondo === 'ok' ? 'commit' : 'rollback')
  } finally {
    uno.release()
    due.release()
  }
  check('due scollegamenti in parallelo: il secondo e\' rifiutato', secondo === '23514 last_sign_in_method', secondo)
  check('e resta un provider', (await providers(c)).join() === 'twitch')
}

/** La rotta HTTP di better-auth per scollegare e' spenta: resta solo la Server Action. */
async function rotteSpente() {
  console.log('\n  -- le rotte di better-auth spente (config.ts)')
  const BASE = 'http://localhost:3999'
  const env = readAuthEnv({ NODE_ENV: 'test', BETTER_AUTH_URL: BASE, BETTER_AUTH_SECRET: randomBytes(32).toString('base64') })
  const auth = createAuth({ env, sendMagicLink: async () => {} })
  const post = (path: string) => auth.handler(new Request(`${BASE}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': '10.9.8.1' },
    body: JSON.stringify({ accountId: '00000000-0000-0000-0000-000000000000' }),
  }))
  check('POST /unlink-account risponde 404', (await post('/unlink-account')).status === 404)
  check('POST /delete-user risponde 404', (await post('/delete-user')).status === 404)
  const lista = await auth.handler(new Request(`${BASE}/api/auth/list-accounts`, { headers: { 'x-forwarded-for': '10.9.8.2' } }))
  check('le altre rotte restano (list-accounts senza sessione: 401)', lista.status === 401, String(lista.status))
}

const DELETE = 'select delete_account($1::uuid, $2)'
const versione = async (clear: string) =>
  (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 order by created_at desc limit 1', [clear])).id

/** Quante righe di ogni tabella collegata parlano dell'utente o dei suoi clear. */
async function residui(u: string, clears: string[]): Promise<Record<string, number>> {
  const r: Record<string, number> = {}
  for (const t of ['auth_account', 'auth_session', 'clear_write_log', 'team', 'tip', 'tip_vote', 'clear_vote']) {
    const col = t === 'team' ? 'owner_id' : t === 'tip' ? 'author_id' : 'user_id'
    r[t] = await num(`select count(*) from ${t} where ${col} = $1`, [u])
  }
  r.clear = await num('select count(*) from clear where author_id = $1 or id = any($2::uuid[])', [u, clears])
  r.clear_comment = await num('select count(*) from clear_comment where author_id = $1', [u])
  r.report = await num('select count(*) from report where reporter_id = $1', [u])
  const v = 'select id from clear_version where clear_id = any($1::uuid[])'
  r.clear_version = await num(`select count(*) from (${v}) x`, [clears])
  for (const t of ['clear_lineup', 'clear_lineup_card', 'clear_lineup_build', 'clear_lineup_equipment', 'clear_proof', 'clear_card']) {
    r[t] = await num(`select count(*) from ${t} where version_id in (${v})`, [clears])
  }
  r.lineup = await num('select count(*) from lineup l join team t on t.id = l.team_id where t.owner_id = $1', [u])
  return r
}
const somma = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0)

async function cancella() {
  console.log('\n  -- delete_account')
  const d = await dati()
  const a = await utente(P, 'stdelete_a')
  const b = await utente(P, 'stdelete_b')
  await collega(a, 'discord', 'google')
  await db.query(`insert into auth_session (token, user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
    [`${P}-${randomBytes(8).toString('hex')}`, a])
  // una sfera che la carta dello slot puo' montare (le esclusive, 0021)
  const orb = (await one<{ id: string }>(
    'select id::text from equipment where equipment_fits(id, $1) order by id limit 1', [d.cards[0]])).id
  const conBuild = copia(payload(d.cards))
  conBuild.lineups[0].slots[0].build = { hp_routes: 4, hp_path: 'Critical Hit', note: 'Rainbow.', equipment: [Number(orb), null, null] }
  const clearA = (await one<{ id: string }>(SUBMIT, [a, d.run, d.tier, JSON.stringify(conBuild)])).id
  const clearB = (await one<{ id: string }>(SUBMIT, [b, d.run, d.tier, JSON.stringify(payload(d.cards))])).id
  const vA = await versione(clearA)
  const vB = await versione(clearB)
  // a vota e commenta il clear di b, b fa lo stesso su quello di a
  await db.query('select vote_clear_version($1::uuid, $2::uuid, 1::smallint)', [a, vB])
  await db.query('select comment_clear_version($1::uuid, $2::uuid, $3)', [a, vB, 'Nice team.'])
  await db.query('select vote_clear_version($1::uuid, $2::uuid, 1::smallint)', [b, vA])
  await db.query('select comment_clear_version($1::uuid, $2::uuid, $3)', [b, vA, 'Thanks for this.'])
  // una tip di a votata da b, e segnalazioni: di a, e di b sul clear e sulla prova di a
  const tip = (await one<{ id: string }>(`insert into tip (author_id, stage_tier_id, body) values ($1, $2, 'Stall turn 1.') returning id::text`, [a, d.tier])).id
  await db.query('insert into tip_vote (tip_id, user_id, value) values ($1, $2, 1)', [tip, b])
  const tipB = (await one<{ id: string }>(`insert into tip (author_id, stage_tier_id, body) values ($1, $2, 'Use items.') returning id::text`, [b, d.tier])).id
  await db.query('insert into tip_vote (tip_id, user_id, value) values ($1, $2, 1)', [tipB, a])
  const prova = (await one<{ id: string }>('select id::text from clear_proof where version_id = $1 limit 1', [vA])).id
  await db.query(`insert into report (reporter_id, target_kind, target_id, reason) values
    ($1, 'clear', $3, 'spam'), ($2, 'clear', $4, 'fake'), ($2, 'proof', $5, 'dead link'), ($2, 'tip', $6, 'rude')`,
  [a, b, clearB, clearA, prova, tip])

  const prima = await residui(a, [clearA])
  check('a ha scritto in ogni tabella', Object.entries(prima).every(([, n]) => n > 0),
    Object.entries(prima).filter(([, n]) => n === 0).map(([t]) => t).join(', '))
  const bPrima = await residui(b, [clearB])
  const punteggioB = await num('select score from clear_version where id = $1', [vB])

  check('l\'handle sbagliato: account_handle_mismatch', await esito(DELETE, [a, 'stdelete_x']) === '23514 account_handle_mismatch')
  check('l\'handle di un altro: account_handle_mismatch', await esito(DELETE, [a, 'stdelete_b']) === '23514 account_handle_mismatch')
  check('handle nullo: account_handle_mismatch', await esito(DELETE, [a, null]) === '23514 account_handle_mismatch')
  check('un utente inesistente: account_missing',
    await esito(DELETE, ['00000000-0000-0000-0000-00000000dead', 'stdelete_a']) === '42501 account_missing')
  check('dopo i rifiuti a c\'e\' ancora tutto', somma(await residui(a, [clearA])) === somma(prima))
  check('e b anche', somma(await residui(b, [clearB])) === somma(bPrima))

  check('con il suo handle (maiuscole e spazi liberi) si cancella', await esito(DELETE, [a, '  StDelete_A ']) === 'ok')
  check('l\'utente non c\'e\' piu\'', await num('select count(*) from app_user where id = $1', [a]) === 0)
  const dopo = await residui(a, [clearA])
  check('nessun residuo in nessuna tabella', somma(dopo) === 0,
    Object.entries(dopo).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(', '))
  check('nemmeno i commenti e i voti di b sul clear di a',
    await num('select count(*) from clear_comment where version_id = $1', [vA]) === 0 &&
    await num('select count(*) from clear_vote where version_id = $1', [vA]) === 0)
  check('le segnalazioni sul clear, la prova e la tip di a sono sparite',
    await num('select count(*) from report where target_id = any($1::uuid[])', [[clearA, prova, tip]]) === 0)
  check('il voto di a sulla tip di b e\' tolto, e il punteggio ricalcolato',
    await num('select score from tip where id = $1', [tipB]) === 0)
  check('il voto di a sul clear di b e\' tolto, e il punteggio ricalcolato',
    await num('select score from clear_version where id = $1', [vB]) === punteggioB - 1)

  const bDopo = await residui(b, [clearB])
  // a b mancano solo voto e commento sul clear di a, il voto sulla tip di a
  // e le sue segnalazioni sulle cose di a: tutto il resto e' intatto
  check('b ha ancora clear, versioni, squadre e accessi',
    bDopo.clear === bPrima.clear && bDopo.clear_version === bPrima.clear_version &&
    bDopo.clear_lineup_build === bPrima.clear_lineup_build && bDopo.team === bPrima.team &&
    bDopo.clear_comment === bPrima.clear_comment - 1 && bDopo.clear_vote === bPrima.clear_vote - 1 &&
    bDopo.tip === bPrima.tip,
    JSON.stringify(bDopo))
  check('b esiste ancora', await num('select count(*) from app_user where id = $1', [b]) === 1)

  // delete_clear passa dallo stesso trigger: la segnalazione se ne va col clear
  await db.query(`insert into report (reporter_id, target_kind, target_id, reason) values ($1, 'clear', $2, 'x')`, [b, clearB])
  await db.query('select delete_clear($1::uuid, $2::uuid)', [b, clearB])
  check('delete_clear porta via anche le segnalazioni sul clear',
    await num('select count(*) from report where target_id = $1', [clearB]) === 0)
}

async function pulizia() {
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  pure()
  await cascate()
  await scollega()
  await rotteSpente()
  await cancella()
} finally {
  await pulizia()
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
