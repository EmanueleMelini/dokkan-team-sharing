// La moderazione dal lato di chi usa il sito (0024): la sospensione letta
// dalla DAL (lib/moderation/sospensione.ts), la sezione user di /api/me
// (lib/viewer/utente.ts), il form di Report (lib/moderation/report-form.ts)
// e i rifiuti veri di report_content tradotti come li mostra la Server
// Action. Le regole SQL le prova moderation.test.mts: qui si prova la
// parte TypeScript sopra di loro.
//
// Gira sul database di test (npm run db:test) e crea solo utenti
// modapp+...@example.invalid, che toglie alla fine.
import pg from 'pg'
import { db } from '@/lib/db'
import type { CurrentUser } from '@/lib/dal'
import { INDEFINITA, fineInParole, fineSospensione, fraseSospensione, isSospeso } from '@/lib/moderation/sospensione'
import { viewerUserOf } from '@/lib/viewer/utente'
import { canWrite } from '@/lib/viewer/types'
import { REPORT_THANKS, parseReportForm, reportErrorMessage } from '@/lib/moderation/report-form'
import { DETAILS_MAX, REASONS_BY_KIND } from '@/lib/moderation/reasons'
import { SUBMIT, check, dati, guardia, one, payload, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'modapp'

function sospensione() {
  console.log('\n  -- la sospensione letta dalla sessione')
  const fra = new Date(Date.now() + 86_400_000)
  check('null resta null', fineSospensione(null) === null && fineSospensione(undefined) === null)
  check('Infinity (node-postgres) e\' indefinita', fineSospensione(Infinity) === INDEFINITA)
  check('una Date non valida (better-auth su infinity) e\' indefinita', fineSospensione(new Date(Infinity)) === INDEFINITA)
  check('una Date diventa ISO', fineSospensione(fra) === fra.toISOString())
  check('una stringa ISO resta la stessa data', fineSospensione(fra.toISOString()) === fra.toISOString())
  check('una stringa senza senso e\' null', fineSospensione('domani') === null)
  check('isSospeso: futura si, passata no, indefinita si, null no',
    isSospeso(fra.toISOString()) && !isSospeso(new Date(Date.now() - 1000).toISOString()) &&
    isSospeso(INDEFINITA) && !isSospeso(null))
  check('la frase dice fino a quando, in UTC', /^until .*2\d{3}.*UTC$/.test(fineInParole(fra.toISOString())),
    fineInParole(fra.toISOString()))
  const frase = fraseSospensione(INDEFINITA)
  check('la frase indefinita dice "indefinitely" e cosa resta permesso',
    /suspended indefinitely/.test(frase) && /delete your posts or your account/.test(frase) &&
    /cannot post, vote, comment or report/.test(frase), frase)
  check('nessun trattino lungo', !/—/.test(frase + fraseSospensione(fra.toISOString())))
}

function utenteApi() {
  console.log('\n  -- la sezione user di /api/me')
  const base: CurrentUser = {
    id: '00000000-0000-4000-8000-000000000001', handle: 'Someone', image: 'https://cdn.example.invalid/a.png',
    role: 'member', reg: 'global', displayName: 'Real Name', onboarded: true, prefersAnimated: false,
    theme: null, suspendedUntil: null, suspended: false, suspensionReason: null, unread: false,
  }
  const membro = viewerUserOf(base)
  check('member: isAdmin falso, non sospeso', membro.isAdmin === false && membro.suspended === false &&
    membro.suspendedUntil === null && !('suspensionReason' in membro), JSON.stringify(membro))
  check('niente id, email, immagine, nome del provider o ruolo', ['id', 'image', 'displayName', 'role', 'email']
    .every((k) => !(k in membro)), Object.keys(membro).join())
  // la versione del sito dell'account (0035): il provider la rimette sul
  // dispositivo; e' gia' pubblica ("Plays Global" sul profilo)
  check('la versione dell\'account passa (reg)', membro.reg === 'global' && viewerUserOf({ ...base, reg: 'japan' }).reg === 'japan')
  check('il tema dell\'account passa (null = System)', membro.theme === null &&
    viewerUserOf({ ...base, theme: 'oled' }).theme === 'oled')
  check('admin: isAdmin vero', viewerUserOf({ ...base, role: 'admin' }).isAdmin === true)
  check('editor: non e\' admin', viewerUserOf({ ...base, role: 'editor' }).isAdmin === false)
  const fine = new Date(Date.now() + 3_600_000).toISOString()
  const sospeso = viewerUserOf({ ...base, suspendedUntil: fine, suspended: true, suspensionReason: 'Spam links' })
  check('sospeso: la fine e il motivo', sospeso.suspended === true && sospeso.suspendedUntil === fine &&
    sospeso.suspensionReason === 'Spam links', JSON.stringify(sospeso))
  const scaduta = viewerUserOf({ ...base, suspendedUntil: new Date(Date.now() - 1000).toISOString(), suspended: false })
  check('scaduta: come non sospeso, senza la data', scaduta.suspended === false && scaduta.suspendedUntil === null)
  check('canWrite: entrato, con l\'handle e non sospeso', canWrite(membro) && !canWrite(sospeso) &&
    !canWrite({ ...membro, onboarded: false }) && !canWrite(null))
}

const form = (campi: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(campi)) f.set(k, v)
  return f
}

function formReport() {
  console.log('\n  -- il form di Report')
  const t = '3B49014B-0000-4000-8000-000000000001'
  const ok = parseReportForm(form({ kind: 'clear', target: t, reason: 'fake_proof', details: '  ' }))
  check('un clear con un motivo: passa, dettagli vuoti = null, id in minuscolo', ok.ok && ok.value.details === null &&
    ok.value.target === t.toLowerCase(), JSON.stringify(ok))
  const altro = parseReportForm(form({ kind: 'comment', target: t, reason: 'other', details: ' Rude ' }))
  check('"other" con i dettagli: passa, senza spazi ai lati', altro.ok && altro.value.details === 'Rude')
  const rifiuti: [string, Record<string, string>, RegExp][] = [
    ['tipo sconosciuto', { kind: 'proof', target: t, reason: 'spam' }, /no longer available/],
    ['tip (ha la sua azione, reportTip)', { kind: 'tip', target: t, reason: 'spam' }, /no longer available/],
    ['bersaglio non uuid', { kind: 'clear', target: '1 or 1=1', reason: 'spam' }, /no longer available/],
    ['fake_proof su un commento', { kind: 'comment', target: t, reason: 'fake_proof' }, /reasons in the list/],
    ['nessun motivo', { kind: 'clear', target: t }, /reasons in the list/],
    ['"other" senza dettagli', { kind: 'clear', target: t, reason: 'other', details: '   ' }, /under 500/],
    ['dettagli troppo lunghi', { kind: 'clear', target: t, reason: 'spam', details: 'x'.repeat(DETAILS_MAX + 1) }, /under 500/],
  ]
  for (const [nome, campi, frase] of rifiuti) {
    const r = parseReportForm(form(campi))
    check(`rifiuta: ${nome}`, !r.ok && frase.test(r.error), r.ok ? 'accettato' : r.error)
  }
  const emoji = parseReportForm(form({ kind: 'clear', target: t, reason: 'spam', details: '😀'.repeat(DETAILS_MAX) }))
  check('500 emoji sono 500 caratteri, come char_length', emoji.ok)
  check('il grazie della spec', REPORT_THANKS === 'Thanks. A moderator will look at it.')
  check('i motivi del form per commento sono quattro', REASONS_BY_KIND.comment.length === 4)
}

/** report_content vero: ogni rifiuto diventa la frase che vede chi segnala. */
async function rifiutiVeri() {
  console.log('\n  -- report_content: i rifiuti come frasi')
  const d = await dati()
  const autore = await utente(P, 'modapp_author')
  const chi = await utente(P, 'modapp_reporter')
  const nuovo = await utente(P, 'modapp_new', false)
  const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards))])).id
  const versione = (await one<{ v: string }>('select version_id::text as v from clear_current where id = $1', [clear])).v
  const commento = (await one<{ id: string }>(
    "select comment_clear_version($1::uuid, $2::uuid, 'Nice run.', null)::text as id", [autore, versione])).id

  const segnala = async (user: string, kind: string, target: string, reason: string, details: string | null = null) => {
    try {
      await db.query('select report_content($1::uuid, $2, $3::uuid, $4, $5)', [user, kind, target, reason, details])
      return 'ok'
    } catch (e) {
      if (e instanceof pg.DatabaseError) return reportErrorMessage(e) ?? `non tradotto: ${e.code} ${e.constraint}`
      throw e
    }
  }
  const casi: [string, Promise<string>, RegExp][] = [
    ['il proprio clear', segnala(autore, 'clear', clear, 'spam'), /^You cannot report your own post\.$/],
    ['il proprio commento', segnala(autore, 'comment', commento, 'spam'), /^You cannot report your own post\.$/],
    ['un clear che non c\'e\'', segnala(chi, 'clear', '00000000-0000-4000-8000-000000000000', 'spam'), /no longer available/],
    ['"other" senza dettagli', segnala(chi, 'clear', clear, 'other'), /under 500/],
    ['un motivo di un altro tipo', segnala(chi, 'comment', commento, 'wrong_stage'), /reasons in the list/],
    ['chi non ha finito l\'account', segnala(nuovo, 'clear', clear, 'spam'), /Finish setting up/],
  ]
  for (const [nome, p, frase] of casi) {
    const r = await p
    check(`${nome}: ${r}`, frase.test(r))
  }
  check('una segnalazione buona passa', (await segnala(chi, 'comment', commento, 'offensive')) === 'ok')
  check('il doppione passa ancora (stesso grazie)', (await segnala(chi, 'comment', commento, 'spam')) === 'ok')

  await db.query("update app_user set suspended_until = now() + interval '1 day' where id = $1", [chi])
  const sospeso = await segnala(chi, 'clear', clear, 'spam')
  check(`sospeso: ${sospeso}`, /^Your account is suspended\./.test(sospeso))
  const voto = await (async () => {
    try { await db.query('select vote_clear_version($1::uuid, $2::uuid, 1::smallint)', [chi, versione]); return 'ok' }
    catch (e) { return e instanceof pg.DatabaseError ? reportErrorMessage(e) ?? 'non tradotto' : String(e) }
  })()
  check(`sospeso, il voto nel form dei clear: ${voto}`, /suspended/.test(voto) && !/not yours/.test(voto))
}

try {
  sospensione()
  utenteApi()
  formReport()
  await rifiutiVeri()
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
} finally {
  await db.query(`delete from app_user where email like '${P}+%@example.invalid'`)
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
