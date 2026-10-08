// Verifica la moderazione (migrazione 0024, lib/moderation/*): segnalare,
// il trigger che toglie le segnalazioni col bersaglio, chi modera,
// nascondere e rimostrare clear e commenti (con le letture vere di
// lib/queries.ts e lib/clears.ts), archiviare, la sospensione, il registro
// solo in aggiunta, i ruoli da script (db/admin/set-role.mjs) e la
// conservazione.
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// modtest+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce. Le righe di moderation_action restano (il registro non si
// cancella): ogni verifica conta solo quelle dei propri bersagli.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { friendlyClearError } from '@/lib/clears/errors'
import { getComments, getVersionCounts } from '@/lib/clears'
import { MODERATION_CONSTRAINTS, friendlyModerationError } from '@/lib/moderation/errors'
import {
  ALL_REASONS, REASONS_BY_KIND, REASON_LABELS, REPORTABLE_KINDS, cleanDetails, isReasonFor, isReportKind,
} from '@/lib/moderation/reasons'
import { getStages, listClears } from '@/lib/queries'
import { parseArgs } from '../admin/set-role.mjs'
import {
  REVISE, SUBMIT, check, dati, esito, guardia, num, one, payload, q, stato, utente, type Dati,
} from '@/db/test/builder-helpers'

guardia()
const P = 'modtest'
const TEST_URL = process.env.TEST_DATABASE_URL ?? ''

const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5) as id'
const HIDE_CLEAR = 'select mod_set_clear_status($1::uuid, $2::uuid, $3, $4) as n'
const HIDE_COMMENT = 'select mod_set_comment_status($1::uuid, $2::uuid, $3, $4) as n'
const DISMISS = 'select mod_dismiss_reports($1::uuid, $2, $3::uuid, $4) as n'
const SUSPEND = 'select mod_suspend_user($1::uuid, $2::uuid, $3::timestamptz, $4) as until'
const UNSUSPEND = 'select mod_unsuspend_user($1::uuid, $2::uuid, $3) as ok'
const VOTE = 'select vote_clear_version($1::uuid, $2::uuid, $3::smallint)'
const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3) as id'
const NESSUNO = '00000000-0000-0000-0000-00000000dead'

const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
const versione = async (clear: string) =>
  (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
const nRighe = async (target: string, action?: string) =>
  num(`select count(*) from moderation_action where target_id = $1 ${action ? 'and action = $2' : ''}`,
    action ? [target, action] : [target])
const aperte = async (target: string) =>
  num(`select count(*) from report where target_id = $1 and status = 'open'`, [target])

type Mondo = {
  d: Dati; reg: 'global' | 'japan'; eventId: string
  autore: string; altro: string; terzo: string; admin: string; admin2: string; editor: string; nuovo: string
  clearA: string; vA: string; commentoA: string; clearAltro: string; vAltro: string
}

async function mondo(): Promise<Mondo> {
  const d = await dati()
  const r = await one<{ reg: 'global' | 'japan'; event_id: string }>(
    'select reg::text as reg, event_id::text from event_run where id = $1', [d.run])
  const autore = await utente(P, 'mt_autore')
  const altro = await utente(P, 'mt_altro')
  const terzo = await utente(P, 'mt_terzo')
  const admin = await utente(P, 'mt_admin')
  const admin2 = await utente(P, 'mt_admin2')
  const editor = await utente(P, 'mt_editor')
  const nuovo = await utente(P, 'mt_nuovo', false)
  await db.query(`update app_user set role = 'admin' where id = any($1::uuid[])`, [[admin, admin2]])
  await db.query(`update app_user set role = 'editor' where id = $1`, [editor])
  const clearA = await id(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards))])
  const vA = await versione(clearA)
  // l'autore risponde sotto il proprio clear: e' il commento da segnalare
  const commentoA = await id(COMMENT, [autore, vA, 'Turn 3 is the hard one.'])
  const clearAltro = await id(SUBMIT, [altro, d.run, d.tier, JSON.stringify(payload(d.cards))])
  const vAltro = await versione(clearAltro)
  return { d, reg: r.reg, eventId: r.event_id, autore, altro, terzo, admin, admin2, editor, nuovo, clearA, vA, commentoA, clearAltro, vAltro }
}

async function regole() {
  console.log('\n  -- frasi, motivi e limiti (TypeScript contro SQL)')
  const sql = readFileSync(new URL('../migrations/0024_moderation.sql', import.meta.url), 'utf8')
  // builder_author viene da 0016 (la ridefinizione lo ripete): la frase sta in friendlyClearError
  const nomi = [...new Set([...sql.matchAll(/constraint = '([a-z_]+)'/g)].map((m) => m[1]))]
    .filter((n) => n !== 'builder_author')
  const senza = nomi.filter((n) => !friendlyModerationError({ constraint: n }))
  check('ogni rifiuto di 0024 ha una frase', nomi.length >= 15 && senza.length === 0, senza.join(', '))
  check('e la tabella delle frasi non ha nomi in piu\'',
    MODERATION_CONSTRAINTS.length === nomi.length && MODERATION_CONSTRAINTS.every((n) => nomi.includes(n)),
    MODERATION_CONSTRAINTS.filter((n) => !nomi.includes(n)).join(', '))
  check('builder_author ha ancora la sua frase', friendlyClearError({ constraint: 'builder_author' }) !== null)
  check('nessuna frase con il trattino lungo', MODERATION_CONSTRAINTS.every((n) => !/—/.test(friendlyModerationError({ constraint: n }) ?? '')))
  check('un errore sconosciuto non ha frase (e un guasto)', friendlyModerationError({ code: '42501' }) === null)

  for (const kind of ['clear', 'comment', 'tip'] as const) {
    const r = await one<{ a: string[] }>('select report_reasons($1) as a', [kind])
    check(`i motivi di ${kind} sono gli stessi in SQL e in reasons.ts`,
      JSON.stringify(r.a) === JSON.stringify(REASONS_BY_KIND[kind]), JSON.stringify(r.a))
  }
  check('una prova non ha motivi suoi (si segnala il clear)',
    (await one<{ a: string[] | null }>(`select report_reasons('proof') as a`)).a === null)
  const def = (await one<{ d: string }>(
    `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'report_reason_check'`)).d
  const nelCheck = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  check('il check della tabella e\' l\'unione dei motivi', nelCheck.join() === [...ALL_REASONS].sort().join(), nelCheck.join())
  const unione = new Set(Object.values(REASONS_BY_KIND).flat())
  check('ogni codice ha un\'etichetta ed e\' usato da un tipo',
    ALL_REASONS.every((r) => REASON_LABELS[r] && unione.has(r)) && unione.size === ALL_REASONS.length)
  check('si segnalano clear e commenti (tip con 0025)',
    REPORTABLE_KINDS.join() === 'clear,comment' && isReportKind('comment') && !isReportKind('tip') && !isReportKind('proof'))
  check('isReasonFor segue il tipo', isReasonFor('clear', 'fake_proof') && !isReasonFor('comment', 'fake_proof') &&
    isReasonFor('tip', 'wrong_info') && !isReasonFor('clear', 'wrong_info') && !isReasonFor('clear', 42))
  check('cleanDetails: "other" li vuole, gli altri no',
    cleanDetails('other', '  ') === undefined && cleanDetails('spam', ' ') === null &&
    cleanDetails('other', '  fake video  ') === 'fake video' && cleanDetails('spam', 'x'.repeat(501)) === undefined &&
    cleanDetails('other', '😀'.repeat(500)) === '😀'.repeat(500))

  const lim = await one<Record<string, number>>(
    `select clear_write_limit('submit') as submit, clear_write_limit('revise') as revise,
            clear_write_limit('comment') as comment, clear_write_limit('report') as report,
            clear_write_limit('tip') as tip, clear_write_limit('tip_edit') as tip_edit`)
  check('i limiti per ora: quelli di prima, piu\' report, tip e tip_edit',
    JSON.stringify(lim) === JSON.stringify({ submit: 10, revise: 20, comment: 30, report: 10, tip: 10, tip_edit: 30 }),
    JSON.stringify(lim))
}

async function segnalare(m: Mondo) {
  console.log('\n  -- report_content')
  const r1 = await id(REPORT, [m.altro, 'clear', m.clearA, 'fake_proof', null])
  check('si segnala il clear di un altro', /^[0-9a-f-]{36}$/.test(r1))
  check('e la segnalazione e\' aperta, senza chi l\'ha chiusa',
    await num(`select count(*) from report where id = $1 and status = 'open' and resolved_by is null
                 and resolved_at is null and reporter_id = $2 and details is null`, [r1, m.altro]) === 1)
  const r2 = await id(REPORT, [m.altro, 'comment', m.commentoA, 'spam', '  buy coins here  '])
  check('si segnala un commento, i dettagli ripuliti',
    (await one<{ details: string }>('select details from report where id = $1', [r2])).details === 'buy coins here')
  const r3 = await id(REPORT, [m.terzo, 'clear', m.clearA, 'other', ' The video is from another stage. '])
  check('"other" con i dettagli passa', !!r3 && r3 !== r1)

  check('il proprio clear: report_own', await esito(REPORT, [m.autore, 'clear', m.clearA, 'spam', null]) === '23514 report_own')
  check('il proprio commento: report_own', await esito(REPORT, [m.autore, 'comment', m.commentoA, 'spam', null]) === '23514 report_own')
  for (const k of ['proof', 'tip', 'user', null]) {
    check(`tipo ${k}: report_kind`, await esito(REPORT, [m.altro, k, m.clearA, 'spam', null]) === '23514 report_kind')
  }
  check('un clear che non c\'e\': report_target_missing',
    await esito(REPORT, [m.altro, 'clear', NESSUNO, 'spam', null]) === '23514 report_target_missing')
  check('un commento che non c\'e\': report_target_missing',
    await esito(REPORT, [m.altro, 'comment', NESSUNO, 'spam', null]) === '23514 report_target_missing')
  check('l\'id di un clear come commento: report_target_missing',
    await esito(REPORT, [m.altro, 'comment', m.clearA, 'spam', null]) === '23514 report_target_missing')
  check('fake_proof su un commento: report_reason',
    await esito(REPORT, [m.terzo, 'comment', m.commentoA, 'fake_proof', null]) === '23514 report_reason')
  check('wrong_info (delle tip) su un clear: report_reason',
    await esito(REPORT, [m.terzo, 'clear', m.clearAltro, 'wrong_info', null]) === '23514 report_reason')
  check('un motivo inventato o nullo: report_reason',
    await esito(REPORT, [m.terzo, 'clear', m.clearAltro, 'boring', null]) === '23514 report_reason' &&
    await esito(REPORT, [m.terzo, 'clear', m.clearAltro, null, null]) === '23514 report_reason')
  check('"other" senza dettagli (o solo spazi): report_details',
    await esito(REPORT, [m.terzo, 'clear', m.clearAltro, 'other', null]) === '23514 report_details' &&
    await esito(REPORT, [m.terzo, 'clear', m.clearAltro, 'other', '   ']) === '23514 report_details')
  check('dettagli oltre i 500 caratteri: report_details',
    await esito(REPORT, [m.terzo, 'clear', m.clearAltro, 'spam', 'x'.repeat(501)]) === '23514 report_details')
  check('chi non ha finito /welcome: builder_author',
    await esito(REPORT, [m.nuovo, 'clear', m.clearA, 'spam', null]) === '42501 builder_author')
  check('un utente che non c\'e\': builder_author',
    await esito(REPORT, [NESSUNO, 'clear', m.clearA, 'spam', null]) === '42501 builder_author')

  const log = () => num(`select count(*) from clear_write_log where user_id = $1 and kind = 'report'`, [m.altro])
  const prima = await log()
  const ripetuta = await id(REPORT, [m.altro, 'clear', m.clearA, 'offensive', null])
  check('la stessa segnalazione aperta torna lo stesso id', ripetuta === r1)
  check('e non conta per il limite', await log() === prima && prima === 2, `${prima} -> ${await log()}`)
  check('e non ne crea un\'altra', await aperte(m.clearA) === 2)
}

/** Il limite: 10 segnalazioni nuove per ora, il doppione resta gratis. */
async function limite(m: Mondo) {
  console.log('\n  -- il limite per ora')
  const veloce = await utente(P, 'mt_veloce')
  const commenti: string[] = []
  for (let i = 0; i < 11; i++) commenti.push(await id(COMMENT, [m.altro, m.vA, `Comment number ${i + 1}.`]))
  let ok = 0
  for (const c of commenti.slice(0, 10)) if (await esito(REPORT, [veloce, 'comment', c, 'spam', null]) === 'ok') ok++
  check('dieci segnalazioni diverse in un\'ora passano', ok === 10, String(ok))
  check('l\'undicesima: report_rate_limit',
    await esito(REPORT, [veloce, 'comment', commenti[10], 'spam', null]) === '54000 report_rate_limit')
  check('un doppione passa anche al limite', await esito(REPORT, [veloce, 'comment', commenti[0], 'spam', null]) === 'ok')
  check('il limite e\' per persona: un altro segnala ancora',
    await esito(REPORT, [m.terzo, 'comment', commenti[10], 'spam', null]) === 'ok')
  // via i commenti di prova: le segnalazioni se ne vanno col trigger
  await db.query('delete from clear_comment where id = any($1::uuid[])', [commenti])
  check('cancellare i commenti toglie le loro segnalazioni',
    await num('select count(*) from report where target_id = any($1::uuid[])', [commenti]) === 0)
}

async function trigger(m: Mondo) {
  console.log('\n  -- le segnalazioni se ne vanno col bersaglio')
  const c1 = await id(COMMENT, [m.terzo, m.vA, 'Same team here.'])
  await db.query(REPORT, [m.altro, 'comment', c1, 'offensive', null])
  await db.query('delete from clear_comment where id = $1', [c1])
  check('cancellare un commento toglie le sue segnalazioni', await num('select count(*) from report where target_id = $1', [c1]) === 0)

  const clearD = await id(SUBMIT, [m.autore, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))])
  const vD = await versione(clearD)
  const cD = await id(COMMENT, [m.autore, vD, 'Notes for later.'])
  await db.query(REPORT, [m.altro, 'clear', clearD, 'spam', null])
  await db.query(REPORT, [m.altro, 'comment', cD, 'spam', null])
  await db.query('select delete_clear($1::uuid, $2::uuid)', [m.autore, clearD])
  check('delete_clear toglie le segnalazioni del clear e dei suoi commenti (cascata)',
    await num('select count(*) from report where target_id = any($1::uuid[])', [[clearD, cD]]) === 0)

  const via = await utente(P, 'mt_via')
  await db.query(REPORT, [via, 'clear', m.clearA, 'spam', null])
  const primaA = await aperte(m.clearA)
  await db.query('select delete_account($1::uuid, $2)', [via, 'mt_via'])
  check('delete_account di chi segnala porta via le sue segnalazioni',
    await num('select count(*) from report where reporter_id = $1', [via]) === 0 && await aperte(m.clearA) === primaA - 1)
}

async function moderatore(m: Mondo) {
  console.log('\n  -- chi modera (mod_assert)')
  await db.query(`update app_user set suspended_until = now() + interval '1 day' where id = $1`, [m.admin2])
  const chi: [string, string][] = [
    ['un member', m.altro], ['un editor', m.editor], ['un admin sospeso', m.admin2],
    ['chi non ha finito /welcome', m.nuovo], ['un utente che non c\'e\'', NESSUNO],
  ]
  const chiamate: [string, (u: string) => unknown[]][] = [
    [HIDE_CLEAR, (u) => [u, m.clearA, 'hidden', null]],
    [HIDE_COMMENT, (u) => [u, m.commentoA, 'hidden', null]],
    [DISMISS, (u) => [u, 'clear', m.clearA, null]],
    [SUSPEND, (u) => [u, m.terzo, null, null]],
    [UNSUSPEND, (u) => [u, m.terzo, null]],
    ['select mod_assert($1::uuid)', (u) => [u]],
  ]
  for (const [nome, u] of chi) {
    const esiti = await Promise.all(chiamate.map(([s, a]) => esito(s, a(u))))
    check(`${nome}: ogni mod_* risponde 42501 mod_not_allowed`, esiti.every((e) => e === '42501 mod_not_allowed'), esiti.join(', '))
  }
  await db.query('update app_user set suspended_until = null where id = $1', [m.admin2])
  check('l\'admin torna l\'handle per il registro',
    (await one<{ h: string }>('select mod_assert($1::uuid)::text as h', [m.admin])).h === 'mt_admin')
  check('niente e\' cambiato', await aperte(m.clearA) === 2 &&
    await num(`select count(*) from clear where id = $1 and status = 'published'`, [m.clearA]) === 1 &&
    await nRighe(m.clearA) === 0)
  check('uno stato non previsto (anche flagged): mod_status',
    await esito(HIDE_CLEAR, [m.admin, m.clearA, 'flagged', null]) === '23514 mod_status' &&
    await esito(HIDE_COMMENT, [m.admin, m.commentoA, null, null]) === '23514 mod_status')
  check('un bersaglio che non c\'e\': mod_target_missing',
    await esito(HIDE_CLEAR, [m.admin, NESSUNO, 'hidden', null]) === '23514 mod_target_missing' &&
    await esito(HIDE_COMMENT, [m.admin, NESSUNO, 'hidden', null]) === '23514 mod_target_missing')
  check('una nota oltre i 500 caratteri: mod_note',
    await esito(HIDE_CLEAR, [m.admin, m.clearA, 'hidden', 'x'.repeat(501)]) === '23514 mod_note')
  check('archiviare un tipo non previsto: mod_kind',
    await esito(DISMISS, [m.admin, 'user', m.autore, null]) === '23514 mod_kind' &&
    await esito(DISMISS, [m.admin, 'proof', m.clearA, null]) === '23514 mod_kind')
}

const inLista = async (m: Mondo, clear: string) =>
  (await listClears(m.d.tier, m.reg, { limit: 200 })).find((c) => c.id === clear)
const nelTier = async (m: Mondo) =>
  (await getStages(m.eventId, m.reg)).find((s) => s.tier_id === m.d.tier)?.clears ?? -1

async function nascondere(m: Mondo) {
  console.log('\n  -- nascondere e rimostrare un clear')
  await db.query(VOTE, [m.terzo, m.vA, 1])
  const punteggio = await num('select score from clear_version where id = $1', [m.vA])
  const conto = await nelTier(m)
  const daChiudere = await aperte(m.clearA)
  check('prima: il clear e\' nella lista, con il voto', !!(await inLista(m, m.clearA)) && punteggio === 1 && daChiudere === 2)

  const n = (await one<{ n: number }>(HIDE_CLEAR, [m.admin, m.clearA, 'hidden', '  Proof is a different stage.  '])).n
  check('nascondere torna quante segnalazioni ha chiuso', n === daChiudere, String(n))
  check('listClears non lo mostra piu\'', !(await inLista(m, m.clearA)))
  check('il conto del tier scende di uno', await nelTier(m) === conto - 1, `${conto} -> ${await nelTier(m)}`)
  check('votarlo: builder_version_missing', await esito(VOTE, [m.altro, m.vA, 1]) === '23514 builder_version_missing')
  check('commentarlo: builder_version_missing', await esito(COMMENT, [m.altro, m.vA, 'Hello?']) === '23514 builder_version_missing')
  check('segnalarlo: report_target_missing',
    await esito(REPORT, [m.editor, 'clear', m.clearA, 'spam', null]) === '23514 report_target_missing')
  check('anche un suo commento: report_target_missing (il genitore e\' nascosto)',
    await esito(REPORT, [m.editor, 'comment', m.commentoA, 'spam', null]) === '23514 report_target_missing')
  check('i suoi commenti non si leggono', (await getComments(m.vA)).length === 0)
  const chiuse = await q<{ status: string; resolved_by: string; resolved_at: Date | null }>(
    `select status, resolved_by::text, resolved_at from report where target_kind = 'clear' and target_id = $1`, [m.clearA])
  check('le segnalazioni aperte ora sono actioned, con chi e quando',
    chiuse.length === 2 && chiuse.every((r) => r.status === 'actioned' && r.resolved_by === m.admin && r.resolved_at),
    JSON.stringify(chiuse.map((r) => r.status)))
  const riga = await q<Record<string, unknown>>(
    `select action, target_kind, moderator_id::text, moderator_handle::text, target_author_id::text, reports_closed, note
       from moderation_action where target_id = $1`, [m.clearA])
  check('una riga hide nel registro, con l\'autore e la nota ripulita',
    riga.length === 1 && riga[0].action === 'hide' && riga[0].target_kind === 'clear' &&
    riga[0].moderator_id === m.admin && riga[0].moderator_handle === 'mt_admin' &&
    riga[0].target_author_id === m.autore && riga[0].reports_closed === n &&
    riga[0].note === 'Proof is a different stage.', JSON.stringify(riga))
  check('nasconderlo di nuovo torna 0 e non scrive',
    (await one<{ n: number }>(HIDE_CLEAR, [m.admin2, m.clearA, 'hidden', null])).n === 0 && await nRighe(m.clearA) === 1)

  const u = (await one<{ n: number }>(HIDE_CLEAR, [m.admin, m.clearA, 'published', null])).n
  check('rimostrarlo torna 0 e scrive unhide', u === 0 && await nRighe(m.clearA, 'unhide') === 1)
  const torna = await inLista(m, m.clearA)
  check('e torna nella lista con il punteggio intatto', !!torna && torna.score === punteggio, String(torna?.score))
  check('il conto del tier torna com\'era', await nelTier(m) === conto)
  check('le segnalazioni chiuse restano chiuse', await aperte(m.clearA) === 0)

  // un clear nascosto si puo' ancora rivedere dal suo autore, e resta nascosto
  await db.query(HIDE_CLEAR, [m.admin, m.clearA, 'hidden', null])
  const rivisto = await esito(REVISE, [m.autore, m.clearA, 'Fixed the proof link', JSON.stringify(payload(m.d.cards))])
  check('l\'autore rivede un clear nascosto', rivisto === 'ok', rivisto)
  check('e resta nascosto', await num(`select count(*) from clear where id = $1 and status = 'hidden'`, [m.clearA]) === 1)
  await db.query(HIDE_CLEAR, [m.admin, m.clearA, 'published', null])
  m.vA = await versione(m.clearA)
}

async function nascondereCommento(m: Mondo) {
  console.log('\n  -- nascondere e rimostrare un commento')
  const c = await id(COMMENT, [m.autore, m.vA, 'Use the item on turn 2.'])
  const altro = await id(COMMENT, [m.terzo, m.vA, 'Worked for me.'])
  await db.query(REPORT, [m.altro, 'comment', c, 'offensive', null])
  const contaRiga = async () => (await inLista(m, m.clearA))?.comments ?? -1
  const contaVersione = async () => (await getVersionCounts([m.vA])).get(m.vA)?.comments ?? -1
  const [riga0, ver0] = [await contaRiga(), await contaVersione()]
  check('prima: due commenti, contati ovunque', riga0 === 2 && ver0 === 2 && (await getComments(m.vA)).length === 2)

  const n = (await one<{ n: number }>(HIDE_COMMENT, [m.admin, c, 'hidden', null])).n
  check('nascondere il commento chiude la sua segnalazione', n === 1 && await aperte(c) === 0)
  const letti = await getComments(m.vA)
  check('getComments non lo mostra (senza segnaposto)', letti.length === 1 && letti[0].id === altro)
  check('il conto della riga in listClears scende', await contaRiga() === riga0 - 1)
  check('e quello di getVersionCounts', await contaVersione() === ver0 - 1)
  check('segnalarlo: report_target_missing',
    await esito(REPORT, [m.terzo, 'comment', c, 'spam', null]) === '23514 report_target_missing')
  const riga = await one<{ action: string; target_kind: string; autore: string; clear_id: string }>(
    `select action, target_kind, target_author_id::text as autore, detail->>'clear_id' as clear_id
       from moderation_action where target_id = $1`, [c])
  check('il registro dice commento, autore e clear',
    riga.action === 'hide' && riga.target_kind === 'comment' && riga.autore === m.autore && riga.clear_id === m.clearA,
    JSON.stringify(riga))
  check('nasconderlo di nuovo torna 0', (await one<{ n: number }>(HIDE_COMMENT, [m.admin, c, 'hidden', null])).n === 0 &&
    await nRighe(c) === 1)
  await db.query(HIDE_COMMENT, [m.admin, c, 'published', 'Context was a joke.'])
  check('rimostrato torna ovunque', (await getComments(m.vA)).length === 2 && await contaRiga() === riga0 &&
    await nRighe(c, 'unhide') === 1)
  await db.query('delete from clear_comment where id = any($1::uuid[])', [[c, altro]])
}

async function archiviare(m: Mondo) {
  console.log('\n  -- archiviare le segnalazioni')
  const prima = await id(REPORT, [m.altro, 'clear', m.clearA, 'spam', null])
  await db.query(REPORT, [m.terzo, 'clear', m.clearA, 'wrong_stage', null])
  check('dopo un hide la stessa persona segnala di nuovo (l\'indice vale solo per le aperte)', !!prima && await aperte(m.clearA) === 2)
  const n = (await one<{ n: number }>(DISMISS, [m.admin, 'clear', m.clearA, 'Proof checks out.'])).n
  check('archiviare torna quante ne ha chiuse', n === 2, String(n))
  check('sono dismissed, con chi le ha chiuse',
    await num(`select count(*) from report where target_id = $1 and status = 'dismissed' and resolved_by = $2`,
      [m.clearA, m.admin]) === 2)
  check('il clear resta pubblicato', !!(await inLista(m, m.clearA)))
  const riga = await one<{ n: string; closed: number; autore: string }>(
    `select count(*) over () as n, reports_closed as closed, target_author_id::text as autore
       from moderation_action where target_id = $1 and action = 'dismiss'`, [m.clearA])
  check('una riga dismiss nel registro', Number(riga.n) === 1 && riga.closed === 2 && riga.autore === m.autore)
  check('senza segnalazioni aperte torna 0 e non scrive',
    (await one<{ n: number }>(DISMISS, [m.admin, 'clear', m.clearA, null])).n === 0 && await nRighe(m.clearA, 'dismiss') === 1)
  const dopo = await id(REPORT, [m.altro, 'clear', m.clearA, 'spam', null])
  check('dopo l\'archiviazione si segnala di nuovo, con un id nuovo', !!dopo && dopo !== prima && await aperte(m.clearA) === 1)
}

async function sospensione(m: Mondo) {
  console.log('\n  -- sospendere e riattivare')
  const clearB = await id(SUBMIT, [m.autore, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))])
  const until = (await one<{ until: Date }>(SUSPEND, [m.admin, m.autore, new Date(Date.now() + 86400e3), '  Spamming comments. '])).until
  const u = await one<{ s: boolean; until: Date; reason: string }>(
    'select user_suspended(id) as s, suspended_until as until, suspension_reason as reason from app_user where id = $1', [m.autore])
  check('sospeso per un giorno, con il motivo ripulito',
    u.s && u.until.getTime() === until.getTime() && Math.abs(until.getTime() - Date.now() - 86400e3) < 60e3 &&
    u.reason === 'Spamming comments.')
  const riga = await one<{ action: string; until: string; reason: string; autore: string }>(
    `select action, detail->>'until' as until, detail->>'reason' as reason, target_author_id::text as autore
       from moderation_action where target_id = $1 and target_kind = 'user' order by id desc limit 1`, [m.autore])
  check('una riga suspend nel registro, con la data', riga.action === 'suspend' && !!riga.until &&
    riga.reason === 'Spamming comments.' && riga.autore === m.autore)

  const S = '42501 account_suspended'
  check('inviare: account_suspended', await esito(SUBMIT, [m.autore, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))]) === S)
  check('rivedere: account_suspended',
    await esito(REVISE, [m.autore, clearB, 'Another try', JSON.stringify(payload(m.d.cards))]) === S)
  check('votare: account_suspended', await esito(VOTE, [m.autore, m.vAltro, 1]) === S)
  check('ritirare un voto: account_suspended', await esito(VOTE, [m.autore, m.vAltro, 0]) === S)
  check('commentare: account_suspended', await esito(COMMENT, [m.autore, m.vAltro, 'Hi.']) === S)
  check('segnalare: account_suspended', await esito(REPORT, [m.autore, 'clear', m.clearAltro, 'spam', null]) === S)
  check('ma cancellare un proprio clear si puo\'', await esito('select delete_clear($1::uuid, $2::uuid)', [m.autore, clearB]) === 'ok')
  check('i suoi contenuti restano visibili', !!(await inLista(m, m.clearA)))

  await db.query(`update app_user set suspended_until = now() - interval '1 minute' where id = $1`, [m.autore])
  check('con la data passata scrive di nuovo', await esito(COMMENT, [m.autore, m.vAltro, 'Back again.']) === 'ok' &&
    !(await one<{ s: boolean }>('select user_suspended($1::uuid) as s', [m.autore])).s)

  check('se stesso: mod_suspend_forbidden', await esito(SUSPEND, [m.admin, m.admin, null, null]) === '42501 mod_suspend_forbidden')
  check('un altro admin: mod_suspend_forbidden', await esito(SUSPEND, [m.admin, m.admin2, null, null]) === '42501 mod_suspend_forbidden')
  check('una data passata: mod_suspend_until',
    await esito(SUSPEND, [m.admin, m.autore, new Date(Date.now() - 60e3), null]) === '23514 mod_suspend_until')
  check('un utente che non c\'e\': mod_user_missing', await esito(SUSPEND, [m.admin, NESSUNO, null, null]) === '23514 mod_user_missing' &&
    await esito(UNSUSPEND, [m.admin, NESSUNO, null]) === '23514 mod_user_missing')
  check('un motivo oltre i 300 caratteri: mod_suspend_reason',
    await esito(SUSPEND, [m.admin, m.autore, null, 'x'.repeat(301)]) === '23514 mod_suspend_reason')

  const sempre = (await one<{ until: string }>(
    `select mod_suspend_user($1::uuid, $2::uuid, null, null)::text as until`, [m.admin, m.autore])).until
  check('senza data e\' a tempo indeterminato', sempre === 'infinity' &&
    (await one<{ s: boolean }>('select user_suspended($1::uuid) as s', [m.autore])).s)
  const righe = await nRighe(m.autore)
  check('riattivare torna true', (await one<{ ok: boolean }>(UNSUSPEND, [m.admin, m.autore, 'Appeal accepted.'])).ok === true)
  check('e pulisce le due colonne', await num(
    'select count(*) from app_user where id = $1 and suspended_until is null and suspension_reason is null', [m.autore]) === 1)
  check('e scrive unsuspend', await nRighe(m.autore, 'unsuspend') === 1 && await nRighe(m.autore) === righe + 1)
  check('riattivare chi non e\' sospeso torna false e non scrive',
    (await one<{ ok: boolean }>(UNSUSPEND, [m.admin, m.autore, null])).ok === false && await nRighe(m.autore) === righe + 1)

  // chi e' sospeso puo' sempre cancellare l'account, e il registro resta
  const via = await utente(P, 'mt_sospeso')
  await db.query(SUSPEND, [m.admin, via, null, 'Ban evasion.'])
  check('un sospeso cancella l\'account', await esito('select delete_account($1::uuid, $2)', [via, 'mt_sospeso']) === 'ok')
  check('la riga del registro resta, senza la persona',
    await num(`select count(*) from moderation_action where target_id = $1 and target_author_id is null
                 and moderator_id = $2`, [via, m.admin]) === 1)
}

async function registro(m: Mondo) {
  console.log('\n  -- il registro, solo in aggiunta')
  const riga = (await one<{ id: string }>(
    'select id::text from moderation_action where target_id = $1 order by id limit 1', [m.clearA])).id
  const R = '23514 moderation_action_append_only'
  check('UPDATE della nota: rifiutato', await esito('update moderation_action set note = $2 where id = $1', [riga, 'edited']) === R)
  check('UPDATE del moderatore verso un altro: rifiutato',
    await esito('update moderation_action set moderator_id = $2 where id = $1', [riga, m.admin2]) === R)
  check('UPDATE che azzera il moderatore ma cambia altro: rifiutato',
    await esito(`update moderation_action set moderator_id = null, action = 'unhide' where id = $1`, [riga]) === R)
  check('DELETE: rifiutato', await esito('delete from moderation_action where id = $1', [riga]) === R)
  check('TRUNCATE: rifiutato', await esito('truncate moderation_action') === R)

  // l'admin che se ne va: le sue righe restano con l'handle, le segnalazioni chiuse anche
  const admin3 = await utente(P, 'mt_admin3')
  await db.query(`update app_user set role = 'admin' where id = $1`, [admin3])
  const c = await id(COMMENT, [m.terzo, m.vA, 'Report me.'])
  const r = await id(REPORT, [m.altro, 'comment', c, 'spam', null])
  await db.query(DISMISS, [admin3, 'comment', c, null])
  await db.query('delete from app_user where id = $1', [admin3])
  const dopo = await one<{ mod: string | null; h: string }>(
    `select moderator_id::text as mod, moderator_handle::text as h from moderation_action where target_id = $1`, [c])
  check('cancellare il moderatore: moderator_id null, l\'handle resta', dopo.mod === null && dopo.h === 'mt_admin3')
  check('e la segnalazione che ha chiuso resta, senza chi l\'ha chiusa',
    await num(`select count(*) from report where id = $1 and status = 'dismissed' and resolved_by is null
                 and resolved_at is not null`, [r]) === 1)
  await db.query('delete from clear_comment where id = $1', [c])
}

const SET_ROLE = 'select set_user_role($1::citext, $2) as old'
const ruolo = async (u: string) => (await one<{ role: string }>('select role from app_user where id = $1', [u])).role

function script(args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['db/admin/set-role.mjs', ...args], {
    encoding: 'utf8',
    // niente .env.local: il bersaglio e' solo quello passato qui
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DOKKAN_ENV_FILES: 'off', ...env },
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

async function ruoli() {
  console.log('\n  -- set_user_role e db/admin/set-role.mjs')
  const u = await utente(P, 'mt_ruolo')
  check('un handle che non c\'e\': role_user_missing', await esito(SET_ROLE, ['mt_nessuno', 'admin']) === '23514 role_user_missing')
  check('un ruolo inventato: role_invalid', await esito(SET_ROLE, ['mt_ruolo', 'owner']) === '23514 role_invalid')
  check('admin, senza badare alle maiuscole: torna il ruolo di prima',
    (await one<{ old: string }>(SET_ROLE, ['MT_Ruolo', 'admin'])).old === 'member' && await ruolo(u) === 'admin')
  const riga = await one<{ action: string; mod: string | null; h: string | null; role: string; from: string }>(
    `select action, moderator_id::text as mod, moderator_handle::text as h, detail->>'role' as role, detail->>'from' as from
       from moderation_action where target_id = $1`, [u])
  check('una riga set_role, senza moderatore (e\' uno script)',
    riga.action === 'set_role' && riga.mod === null && riga.h === null && riga.role === 'admin' && riga.from === 'member')
  check('lo stesso ruolo non scrive', (await one<{ old: string }>(SET_ROLE, ['mt_ruolo', 'admin'])).old === 'admin' &&
    await nRighe(u) === 1)

  check('parseArgs', parseArgs(['mt_ruolo', 'admin']).ok && !parseArgs(['mt_ruolo']).ok &&
    !parseArgs(['mt_ruolo', 'boss']).ok && !parseArgs(['a', 'admin', 'b']).ok &&
    parseArgs(['--prod', 'x', 'member', '--yes']).prod && parseArgs(['--prod', 'x', 'member', '--yes']).ok)
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')).scripts
  check('npm run db:role e prod:role', pkg['db:role'] === 'node db/admin/set-role.mjs' &&
    pkg['prod:role'] === 'node db/admin/set-role.mjs --prod')

  const dev = { DATABASE_URL: TEST_URL }
  const giu = script(['mt_ruolo', 'member'], dev)
  check('db:role: esce 0 e stampa prima e dopo', giu.code === 0 && giu.out.includes('mt_ruolo: admin -> member') &&
    await ruolo(u) === 'member', giu.out.trim())
  const ignoto = script(['mt_nessuno', 'admin'], dev)
  check('db:role con un handle che non c\'e\': esce 1', ignoto.code === 1 && ignoto.out.includes('nessun utente'), ignoto.out.trim())
  check('db:role con un ruolo inventato: esce 2', script(['mt_ruolo', 'boss'], dev).code === 2)
  const altrui = script(['mt_ruolo', 'admin'], { DATABASE_URL: TEST_URL.replace(/\/[^/]+$/, '/dokkanteamsharing') })
  check('db:role su dokkanteamsharing: esce 1 senza connettersi', altrui.code === 1 && altrui.out.includes('non lo tocco'))

  // prod:role passa da resolveTarget: i rifiuti, poi il giro intero sul
  // database di test con --allow-local (come la simulazione di prod:setup)
  const prod = (url: string, ...flag: string[]) => script(['--prod', 'mt_ruolo', 'admin', ...flag], { PROD_DATABASE_URL: url })
  const remoto = 'postgres://u@db.example.com:5432'
  const rifiuti: [string, ReturnType<typeof prod>, string][] = [
    ['dokkanteamsharing', prod(`${remoto}/dokkanteamsharing`, '--yes'), 'non lo tocco'],
    ['un nome *_dev', prod(`${remoto}/dokkan_dev`, '--yes'), 'sembra sviluppo'],
    ['un nome *_test', prod(`${remoto}/dokkan_test`, '--yes'), 'sembra sviluppo'],
    ['localhost', prod(TEST_URL, '--yes'), 'sembra sviluppo'],
    ['senza PROD_DATABASE_URL', script(['--prod', 'mt_ruolo', 'admin', '--yes'], dev), 'manca PROD_DATABASE_URL'],
  ]
  for (const [nome, r, pezzo] of rifiuti) {
    check(`prod:role rifiuta ${nome} (esce 1)`, r.code === 1 && r.out.includes(pezzo), r.out.trim())
  }
  const senzaSi = prod(TEST_URL, '--allow-local')
  check('prod:role senza --yes esce 2 e non tocca niente', senzaSi.code === 2 && await ruolo(u) === 'member')
  const giro = prod(TEST_URL, '--allow-local', '--yes')
  check('prod:role con --yes cambia il ruolo', giro.code === 0 && giro.out.includes('member -> admin') &&
    await ruolo(u) === 'admin', giro.out.trim())
}

async function conservazione(m: Mondo) {
  console.log('\n  -- purge_resolved_reports (180 giorni)')
  const vecchia = await id(REPORT, [m.terzo, 'clear', m.clearAltro, 'spam', null])
  await db.query(DISMISS, [m.admin, 'clear', m.clearAltro, null])
  await db.query(`update report set resolved_at = now() - interval '181 days' where id = $1`, [vecchia])
  const recente = await id(REPORT, [m.terzo, 'clear', m.clearAltro, 'spam', null])
  await db.query(DISMISS, [m.admin, 'clear', m.clearAltro, null])
  const aperta = await id(REPORT, [m.terzo, 'clear', m.clearAltro, 'offensive', null])
  await db.query(`update report set created_at = now() - interval '200 days' where id = $1`, [aperta])
  const n = (await one<{ n: number }>('select purge_resolved_reports() as n')).n
  const resta = async (r: string) => await num('select count(*) from report where id = $1', [r]) === 1
  check('toglie le chiuse da oltre 180 giorni', n >= 1 && !(await resta(vecchia)), String(n))
  check('lascia le chiuse di recente e le aperte, anche vecchie', await resta(recente) && await resta(aperta))
  check('il registro non si tocca', await nRighe(m.clearAltro, 'dismiss') === 2)
}

async function pulizia() {
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  await regole()
  const m = await mondo()
  await segnalare(m)
  await limite(m)
  await trigger(m)
  await moderatore(m)
  await nascondere(m)
  await nascondereCommento(m)
  await archiviare(m)
  await sospensione(m)
  await registro(m)
  await ruoli()
  await conservazione(m)
} finally {
  await pulizia()
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
