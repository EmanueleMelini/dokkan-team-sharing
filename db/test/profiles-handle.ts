// Le regole SQL degli handle (0026), per profiles.test.mts: change_handle,
// la corsa sotto il lock consultivo, /welcome che rifiuta i nomi lasciati
// da altri, la sospensione e la cancellazione che li libera.
import { db } from '@/lib/db'
import { userFootprint } from '@/lib/clears'
import { resolveHandle } from '@/lib/profiles'
import { check, esito, num, one, utente } from '@/db/test/builder-helpers'

export const P = 'profiletest'
const CAMBIA = 'select change_handle($1::uuid, $2)'
const ONBOARD = "select complete_onboarding($1::uuid, $2, 'global')"
const vecchiaData = (id: string) =>
  db.query(`update app_user set handle_changed_at = now() - interval '31 days' where id = $1`, [id])
const handleDi = async (id: string) => (await one<{ h: string }>('select handle::text as h from app_user where id = $1', [id]))?.h

/** Gli handle che la suite crea: le email restano quelle di partenza anche dopo i cambi. */
export const HANDLE_SQL = ['proftest_a', 'proftest_b', 'proftest_c', 'proftest_r1', 'proftest_r2', 'user_proftest0']

export async function cambio() {
  console.log('\n  -- change_handle')
  const a = await utente(P, 'proftest_a')
  const b = await utente(P, 'proftest_b')
  const e = (h: string, u = a) => esito(CAMBIA, [u, h])

  check('forma sbagliata: handle_shape', await e('no-dash') === '23514 handle_shape')
  check('troppo corto: handle_shape', await e('ab') === '23514 handle_shape')
  check('riservato: handle_reserved', await e('Settings') === '23514 handle_reserved')
  check('il prefisso user_: handle_reserved', await e('user_abc') === '23514 handle_reserved')
  check('l\'handle attuale di un altro (maiuscole diverse): handle_taken', await e('PROFTEST_B') === '23505 handle_taken')
  check('lo stesso handle: handle_unchanged', await e('proftest_a') === '23514 handle_unchanged')

  check('solo maiuscole: riesce', await e('ProfTest_A') === 'ok' && await handleDi(a) === 'ProfTest_A')
  check('...e di nuovo, senza attesa', await e('PROFTEST_A') === 'ok' && await handleDi(a) === 'PROFTEST_A')
  check('...senza storico ne\' data del cambio',
    await num('select count(*) from handle_history where user_id = $1', [a]) === 0 &&
    await num('select count(*) from app_user where id = $1 and handle_changed_at is null', [a]) === 1)

  check('un cambio vero riesce', await e('proftest_a2') === 'ok' && await handleDi(a) === 'proftest_a2')
  check('il nome lasciato va nello storico',
    await num(`select count(*) from handle_history where user_id = $1 and handle = 'PROFTEST_A'`, [a]) === 1)
  check('un secondo cambio entro 30 giorni: handle_cooldown', await e('proftest_a3') === '23514 handle_cooldown')
  check('...ma le maiuscole restano libere', await e('Proftest_A2') === 'ok')
  check('il nome lasciato da a: handle_taken per b', await e('proftest_a', b) === '23505 handle_taken')
  check('...anche con altre maiuscole', await e('ProfTest_a', b) === '23505 handle_taken')

  await vecchiaData(a)
  check('dopo 31 giorni si cambia di nuovo', await e('proftest_a3') === 'ok')
  check('lo storico ha i due nomi lasciati',
    await num('select count(*) from handle_history where user_id = $1', [a]) === 2)
  await vecchiaData(a)
  check('a riprende il suo primo nome', await e('proftest_a') === 'ok' && await handleDi(a) === 'proftest_a')
  check('...e la sua riga nello storico se ne va',
    await num(`select count(*) from handle_history where handle = 'proftest_a'`) === 0 &&
    await num(`select count(*) from handle_history where user_id = $1`, [a]) === 2)

  // sospensione e fine sospensione invalidano anche i 404 in cache dei nomi lasciati
  const impronta = (await userFootprint(a)).handles.map((h) => h.toLowerCase())
  check('userFootprint: anche i nomi lasciati',
    ['proftest_a', 'proftest_a2', 'proftest_a3'].every((h) => impronta.includes(h)), JSON.stringify(impronta))

  const r = await resolveHandle('Proftest_A2')
  check('il nome lasciato porta a quello attuale', r?.kind === 'moved' && r.handle === 'proftest_a', JSON.stringify(r))

  const nuovo = await utente(P, 'user_proftest0', false)
  check('chi non ha finito /welcome: handle_change_forbidden', await e('proftest_x', nuovo) === '42501 handle_change_forbidden')
  check('un utente che non esiste: handle_change_forbidden',
    await esito(CAMBIA, ['00000000-0000-0000-0000-000000000000', 'proftest_x']) === '42501 handle_change_forbidden')

  console.log('\n  -- complete_onboarding e i nomi lasciati')
  check('/welcome rifiuta il nome lasciato da un altro', await esito(ONBOARD, [nuovo, 'proftest_a3']) === '23505 handle_taken')
  check('...e l\'handle attuale di un altro', await esito(ONBOARD, [nuovo, 'PROFTEST_B']) === '23505 handle_taken')
  check('...e i riservati come prima', await esito(ONBOARD, [nuovo, 'admin']) === '23514 handle_reserved')
  check('un nome libero va', await esito(ONBOARD, [nuovo, 'proftest_c']) === 'ok' && await handleDi(nuovo) === 'proftest_c')
  check('una seconda volta: already_onboarded', await esito(ONBOARD, [nuovo, 'proftest_c9']) === '23514 already_onboarded')
  return { a, b, c: nuovo }
}

/**
 * Due richieste per lo stesso nome: la seconda aspetta il lock della
 * prima e poi la vede, e risponde handle_taken (non l'unique di app_user).
 */
export async function corsa() {
  console.log('\n  -- la corsa per lo stesso nome (lock consultivo)')
  const r1 = await utente(P, 'proftest_r1')
  const r2 = await utente(P, 'proftest_r2')
  const c1 = await db.connect()
  const c2 = await db.connect()
  try {
    await c1.query('begin')
    await c1.query(CAMBIA, [r1, 'proftest_race'])
    let finita = false
    const seconda = c2.query(CAMBIA, [r2, 'proftest_race']).then(
      () => 'ok', (err: { code?: string; constraint?: string }) => `${err.code} ${err.constraint ?? ''}`.trim(),
    ).finally(() => { finita = true })
    await new Promise((r) => setTimeout(r, 300))
    const attesa = await num(
      `select count(*) from pg_locks where locktype = 'advisory' and not granted and database = (
         select oid from pg_database where datname = current_database())`)
    check('la seconda aspetta il lock della prima', !finita && attesa >= 1, `in attesa ${attesa}`)
    await c1.query('commit')
    check('...poi vede il nome preso: handle_taken', await seconda === '23505 handle_taken')
    check('il nome e\' di chi e\' arrivato prima', await handleDi(r1) === 'proftest_race' && await handleDi(r2) === 'proftest_r2')
  } finally {
    await c1.query('rollback').catch(() => {})
    c1.release()
    c2.release()
  }
}

/** La sospensione (0024) nasconde il profilo e ferma il cambio; la cancellazione libera i nomi. */
export async function sospesoECancellato(ids: { a: string; b: string }) {
  console.log('\n  -- sospensione')
  const { a, b } = ids
  const sospendi = (fino: string | null) =>
    db.query('update app_user set suspended_until = $2::timestamptz where id = $1', [a, fino])
  await sospendi(new Date(Date.now() + 86_400_000).toISOString())
  check('sospeso: fuori da public_profile', await num('select count(*) from public_profile where id = $1', [a]) === 0)
  check('...il profilo e\' un 404', await resolveHandle('proftest_a') === null)
  check('...e il suo nome lasciato anche', await resolveHandle('proftest_a3') === null)
  await vecchiaData(a)
  check('...e non cambia handle: account_suspended', await esito(CAMBIA, [a, 'proftest_a9']) === '42501 account_suspended')
  check('...nemmeno solo le maiuscole', await esito(CAMBIA, [a, 'PROFTEST_A']) === '42501 account_suspended')
  await sospendi(new Date(Date.now() - 60_000).toISOString())
  const r = await resolveHandle('proftest_a')
  check('una sospensione finita: il profilo torna', r?.kind === 'found' && r.profile.handle === 'proftest_a')
  await sospendi(null)

  console.log('\n  -- la cancellazione libera i nomi')
  const prima = await num('select count(*) from handle_history where user_id = $1', [a])
  check('a ha nomi lasciati prima di cancellarsi', prima === 2, `${prima}`)
  check('delete_account riesce', await esito('select delete_account($1::uuid, $2)', [a, 'proftest_a']) === 'ok')
  check('lo storico se ne va con l\'account (cascata)', await num('select count(*) from handle_history where user_id = $1', [a]) === 0)
  check('il nome lasciato non porta piu\' a niente', await resolveHandle('proftest_a3') === null)
  check('...e b puo\' prenderlo', await esito(CAMBIA, [b, 'proftest_a3']) === 'ok')
}
