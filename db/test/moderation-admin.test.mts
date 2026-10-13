// Le letture dell'area /admin (lib/moderation/queries.ts) sul database
// vero: la coda raggruppata per bersaglio, i nascosti, la ricerca per
// handle, la scheda di un utente e il registro. Le regole SQL le prova
// moderation.test.mts; qui si prova quello che la pagina mostra.
//
// Gira sul database di test (npm run db:test) e crea solo utenti
// modadm+...@example.invalid, che toglie alla fine. Le righe del registro
// restano (moderation_action e' append-only), come in moderation.test.mts.
import { db } from '@/lib/db'
import { pagina } from '@/lib/moderation/pagina'
import {
  cercaHandle, findUserByHandle, listHidden, listLog, listOpenReports, listSuspended, userModerationSummary,
  type GruppoReport,
} from '@/lib/moderation/queries'
import { SUBMIT, check, dati, guardia, one, payload, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'modadm'

function puri() {
  console.log('\n  -- ?page= e la ricerca per handle')
  check('pagina: senza parametro 1', pagina(undefined) === 1 && pagina('') === 1)
  check('pagina: un numero', pagina('3') === 3 && pagina(['2', '9']) === 2)
  check('pagina: 0, zeri iniziali, lettere e numeri enormi sono null',
    [pagina('0'), pagina('01'), pagina('abc'), pagina('-1'), pagina('123456')].every((v) => v === null))
  check('cercaHandle: un handle si, spazi tolti', cercaHandle('  Some_One1 ') === 'Some_One1')
  check('cercaHandle: caratteri estranei, vuoto o troppo lungo sono null',
    [cercaHandle('a b'), cercaHandle('a%'), cercaHandle(''), cercaHandle('x'.repeat(25)), cercaHandle(3)].every((v) => v === null))
}

/** Tutti i gruppi aperti, pagina per pagina: altre suite lasciano segnalazioni. */
async function tuttiIGruppi(): Promise<GruppoReport[]> {
  const out: GruppoReport[] = []
  for (let p = 1; p <= 20; p++) {
    const { gruppi } = await listOpenReports(p)
    out.push(...gruppi)
    if (gruppi.length === 0) break
  }
  return out
}

const segnala = (user: string, kind: string, target: string, reason: string, details: string | null = null) =>
  db.query('select report_content($1::uuid, $2, $3::uuid, $4, $5)', [user, kind, target, reason, details])

async function flusso() {
  const d = await dati()
  const mod = await utente(P, 'modadm_mod')
  await db.query("update app_user set role = 'admin' where id = $1", [mod])
  const autore = await utente(P, 'modadm_author')
  const r1 = await utente(P, 'modadm_r1')
  const r2 = await utente(P, 'modadm_r2')
  await utente(P, 'modadmXr3')
  await utente(P, 'modadm_new', false)

  const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(payload(d.cards, { note: 'My run notes' }))])).id
  const versione = (await one<{ v: string }>('select version_id::text as v from clear_current where id = $1', [clear])).v
  const commento = (await one<{ id: string }>(
    "select comment_clear_version($1::uuid, $2::uuid, 'Rude words here.', null)::text as id", [autore, versione])).id
  const evento = (await one<{ e: string }>('select event_id::text as e from clear where id = $1', [clear])).e

  console.log('\n  -- la coda')
  await segnala(r1, 'clear', clear, 'spam')
  await segnala(r2, 'clear', clear, 'other', 'Fake screenshot')
  await segnala(r1, 'comment', commento, 'offensive')
  let gruppi = await tuttiIGruppi()
  const gc = gruppi.find((g) => g.kind === 'clear' && g.targetId === clear)
  const gm = gruppi.find((g) => g.kind === 'comment' && g.targetId === commento)
  check('un gruppo per bersaglio', !!gc && !!gm && gruppi.filter((g) => g.targetId === clear).length === 1)
  check('il clear: 2 aperte, un motivo ciascuna', gc?.n === 2 && gc.reasons.spam === 1 && gc.reasons.other === 1,
    JSON.stringify(gc?.reasons))
  check('solo le spiegazioni scritte, con chi le ha scritte', gc?.details.length === 1 &&
    gc.details[0].handle === 'modadm_r2' && gc.details[0].details === 'Fake screenshot' && gc.details[0].at instanceof Date)
  check('autore e nota del clear', gc?.author?.handle === 'modadm_author' && gc.author.suspended === false &&
    gc.clear?.note === 'My run notes' && gc.clear.status === 'published', JSON.stringify(gc?.clear))
  // con la versione del clear nell'URL (lib/versione): ?region=global, o il percorso /japan
  check('il link porta alla pagina del clear, con la versione e l\'ancora',
    !!gc?.posto && gc.posto.href.startsWith(`/events/${evento}`) && gc.posto.href.endsWith(`#clear-${clear}`) &&
    (gc.posto.reg === 'japan' ? !gc.posto.href.includes('?') : gc.posto.href.includes(`?region=global#clear-${clear}`)),
    gc?.posto?.href)
  check('il commento: testo, versione attuale, link al suo clear', gm?.comment?.body === 'Rude words here.' &&
    gm.comment.onCurrent && gm.posto?.href.endsWith(`#clear-${clear}`) === true)
  check('la piu\' vecchia per prima', gruppi.indexOf(gc!) < gruppi.indexOf(gm!))
  check('first e last', !!gc && gc.firstAt <= gc.lastAt)

  console.log('\n  -- nascondere')
  await db.query("select mod_set_clear_status($1::uuid, $2::uuid, 'hidden', 'Fake proof')", [mod, clear])
  gruppi = await tuttiIGruppi()
  check('il clear nascosto esce dalla coda', !gruppi.some((g) => g.targetId === clear))
  const gm2 = gruppi.find((g) => g.targetId === commento)
  check('il suo commento resta, col clear nascosto e senza ancora',
    gm2?.clear?.status === 'hidden' && !!gm2.posto && !gm2.posto.href.includes('#'), gm2?.posto?.href)
  const hc = (await listHidden('clear')).righe.find((r) => r.id === clear)
  check('Hidden: il clear, chi e quando', hc?.hiddenBy === 'modadm_mod' && hc.hiddenAt instanceof Date &&
    hc.author === 'modadm_author' && hc.text === 'My run notes')
  check('Hidden: il link non porta a un\'ancora che non c\'e\'', !!hc?.posto && !hc.posto.href.includes('#'))
  await db.query("select mod_set_comment_status($1::uuid, $2::uuid, 'hidden', null)", [mod, commento])
  const hm = (await listHidden('comment')).righe.find((r) => r.id === commento)
  check('Hidden: il commento, col clear', hm?.clearId === clear && hm.clearStatus === 'hidden' && hm.text === 'Rude words here.')
  check('la coda e\' vuota per questi due', !(await tuttiIGruppi()).some((g) => g.targetId === clear || g.targetId === commento))

  return { mod, autore, r1, r2, clear, commento }
}

async function utenti({ mod, autore, r1, r2, clear }: Awaited<ReturnType<typeof flusso>>) {
  console.log('\n  -- utenti, sospensioni e registro')
  const trovati = await findUserByHandle('modadm_')
  check('il prefisso con _ non e\' un jolly di LIKE', trovati.some((u) => u.handle === 'modadm_r1') &&
    !trovati.some((u) => u.handle === 'modadmXr3'), trovati.map((u) => u.handle).join())
  check('chi non ha finito l\'account non si trova', !trovati.some((u) => u.handle === 'modadm_new') &&
    (await userModerationSummary('modadm_new')) === null)
  const esatto = await findUserByHandle('MODADM_R1')
  check('l\'handle esatto per primo, senza badare alle maiuscole', esatto[0]?.handle === 'modadm_r1')
  check('un handle non valido non cerca', (await findUserByHandle('a%b')).length === 0)

  await db.query("select mod_suspend_user($1::uuid, $2::uuid, now() + interval '1 day', ' Spam links ')", [mod, autore])
  await db.query('select mod_suspend_user($1::uuid, $2::uuid, null, null)', [mod, r2])
  const sospesi = await listSuspended()
  const a = sospesi.find((u) => u.id === autore)
  const b = sospesi.find((u) => u.id === r2)
  check('sospeso a tempo: la data e il motivo', a?.until instanceof Date && !a.indefinite && a.reason === 'Spam links')
  check('sospeso per sempre: indefinite, senza data', b?.indefinite === true && b.until === null)
  check('prima chi torna prima', !!a && !!b && sospesi.indexOf(a) < sospesi.indexOf(b))
  check('chi non e\' sospeso non c\'e\'', !sospesi.some((u) => u.id === r1))

  const s = await userModerationSummary('modadm_author')
  check('la scheda: clear e commenti, quanti nascosti', s?.clears === 1 && s.clearsHidden === 1 &&
    s.comments === 1 && s.commentsHidden === 1, JSON.stringify(s))
  check('la scheda: segnalazioni aperte 0, in tutto 3', s?.openReports === 0 && s.allReports === 3)
  check('la scheda: sospeso, col motivo', s?.suspended === true && s.reason === 'Spam links')
  check('la scheda di chi segnala: 2 mandate', (await userModerationSummary('modadm_r1'))?.reportsSent === 2)

  const storia = (await listLog(0, { authorId: autore })).voci
  check('la storia dell\'utente: sospensione, commento e clear nascosti, l\'ultima per prima',
    storia.map((v) => `${v.action}:${v.targetKind}`).join() === 'suspend:user,hide:comment,hide:clear',
    storia.map((v) => `${v.action}:${v.targetKind}`).join())
  const sosp = storia[0]
  check('la riga della sospensione: chi, il motivo, la data', sosp?.moderator === 'modadm_mod' &&
    sosp.targetHandle === 'modadm_author' && sosp.detail.reason === 'Spam links' && typeof sosp.detail.until === 'string')
  const hide = storia.find((v) => v.targetKind === 'clear')
  check('la riga del clear: nota, segnalazioni chiuse, il tier', hide?.note === 'Fake proof' && hide.reportsClosed === 2 &&
    !!hide.posto && !hide.posto.href.includes('#'))
  check('la riga del commento porta al suo clear', !!storia.find((v) => v.targetKind === 'comment')?.posto)

  await db.query("select mod_set_clear_status($1::uuid, $2::uuid, 'published', null)", [mod, clear])
  await db.query("select mod_unsuspend_user($1::uuid, $2::uuid, 'Appealed')", [mod, autore])
  check('rimesso: non e\' piu\' tra i nascosti', !(await listHidden('clear')).righe.some((r) => r.id === clear))
  check('riattivato: non e\' piu\' tra i sospesi', !(await listSuspended()).some((u) => u.id === autore))
  const tutto = await listLog(0)
  check('il registro: l\'ultima azione per prima', tutto.voci[0]?.action === 'unsuspend' &&
    tutto.voci[0].note === 'Appealed' && tutto.voci[1]?.action === 'unhide')
  const oltre = await listLog(1_000_000)
  check('oltre la fine: vuoto, niente altre', oltre.voci.length === 0 && !oltre.altre)
}

try {
  puri()
  await utenti(await flusso())
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
} finally {
  await db.query(`delete from app_user where email like '${P}+%@example.invalid'`)
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
