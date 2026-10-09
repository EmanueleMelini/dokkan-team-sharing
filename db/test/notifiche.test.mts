// Verifica le notifiche nel sito (migrazione 0028): i tre trigger
// (commenti, registro della moderazione, segnalazioni) con il destinatario
// giusto e nessun altro, mai a se stessi, l'accorpamento finche' non e'
// letta e la riga nuova dopo, chi segnala e chi e' segnalato mai avvisati,
// il sospeso che riceve ancora quelle sui suoi contenuti, render con il
// contenuto nascosto, dts.silent, le cascate, la conservazione, le
// preferenze e le due colonne del pallino.
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// notiftest+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce: notifiche e preferenze se ne vanno con loro. Le righe di
// moderation_action restano (il registro non si cancella).
import { readFileSync, readdirSync } from 'node:fs'
import { db } from '@/lib/db'
import {
  SUBMIT, check, dati, esito, guardia, num, one, payload, q, stato, utente, type Dati,
} from '@/db/test/builder-helpers'

guardia()
const P = 'notiftest'

const COMMENT = 'select comment_clear_version($1::uuid, $2::uuid, $3) as id'
const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5) as id'
const HIDE_CLEAR = 'select mod_set_clear_status($1::uuid, $2::uuid, $3, null) as n'
const HIDE_COMMENT = 'select mod_set_comment_status($1::uuid, $2::uuid, $3, null) as n'
const HIDE_TIP = 'select mod_set_tip_status($1::uuid, $2::uuid, $3, null) as n'
const DISMISS = 'select mod_dismiss_reports($1::uuid, $2, $3::uuid, null) as n'
const SUSPEND = 'select mod_suspend_user($1::uuid, $2::uuid, $3::timestamptz, $4) as until'
const UNSUSPEND = 'select mod_unsuspend_user($1::uuid, $2::uuid, null) as ok'
const POST_TIP = 'select post_tip($1::uuid, $2::bigint, $3::bigint, $4, null)::text as id'
const RENDER = 'select * from notification_render($1::uuid, $2::bigint)'
const LIST = 'select * from notification_list($1::uuid, $2)'
const MARK = 'select mark_notifications_read($1::uuid, $2::bigint[]) as n'
const PREF = 'select set_notification_pref($1::uuid, $2, $3, $4) as on'

type Riga = {
  id: string; recipient_id: string; kind: string; group_key: string; actor_id: string | null
  clear_id: string | null; comment_id: string | null; tip_id: string | null
  created_at: Date; updated_at: Date; read_at: Date | null; data: Record<string, unknown>
}
type Vista = {
  id: string; kind: string; n: number; actor_handle: string | null; target: string
  clear_id: string | null; comment_id: string | null; tip_id: string | null
  event_id: string | null; reg: string | null; tier_id: string | null; event_name: string | null
  stage_seq: number | null; difficulty: string | null
  content_visible: boolean | null; visible: boolean; until: Date | null; read_at: Date | null
}

const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
const versione = async (clear: string) =>
  (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
/** Le notifiche di un utente, le piu' recenti prima. */
const di = async (user: string) =>
  q<Riga>(`select id::text, recipient_id::text, kind, group_key, actor_id::text, clear_id::text,
                  comment_id::text, tip_id::text, created_at, updated_at, read_at, data
             from notification where recipient_id = $1 order by updated_at desc, id desc`, [user])
const nDi = async (user: string, kind?: string) =>
  num(`select count(*) from notification where recipient_id = $1 ${kind ? 'and kind = $2' : ''}`,
    kind ? [user, kind] : [user])
const gruppo = async (user: string, key: string) =>
  q<Riga>(`select id::text, kind, actor_id::text, created_at, updated_at, read_at, data
             from notification where recipient_id = $1 and group_key = $2 order by id`, [user, key])
const vista = async (user: string, nid: string) => (await q<Vista>(RENDER, [user, nid]))[0]
/** Il pallino come lo calcola l'app: notif_last_at > notif_seen_at (null = mai). */
const pallino = async (user: string) =>
  (await one<{ on: boolean }>(
    `select coalesce(notif_last_at > coalesce(notif_seen_at, '-infinity'), false) as on
       from app_user where id = $1`, [user])).on

type Mondo = {
  d: Dati; eventId: string
  autore: string; altro: string; terzo: string; admin: string; admin2: string
  clearA: string; vA: string; clearB: string; vB: string; clearAltro: string; clearAdmin2: string
}

/**
 * Come dati() di builder-helpers, ma senza chiedere una ricorrenza futura:
 * qui serve solo un tier su una run gia' iniziata e otto carte uscite, e la
 * cache dei dati puo' non avere eventi in arrivo.
 */
async function datiMinimi(): Promise<Dati> {
  try { return await dati() } catch { /* nessuna ricorrenza futura: va bene lo stesso */ }
  const base = await one<{ run: string; tier: string }>(
    `select r.id::text as run, st.id::text as tier
       from event_run r join stage_tier st on st.event_id = r.event_id
      where r.starts_at <= now()
      order by r.event_id, r.id, st.id limit 1`)
  const cards = (await q<{ id: string }>(
    `select c.id::text from card c join card_release r on r.card_id = c.id and r.reg = 'global'
      where r.released_at <= current_date order by c.id limit 8`)).map((r) => Number(r.id))
  return { run: base.run, tier: base.tier, futura: '', altraRun: '', cards }
}

async function mondo(): Promise<Mondo> {
  const d = await datiMinimi()
  const eventId = (await one<{ e: string }>('select event_id::text as e from event_run where id = $1', [d.run])).e
  const autore = await utente(P, 'nt_autore')
  const altro = await utente(P, 'nt_altro')
  const terzo = await utente(P, 'nt_terzo')
  const admin = await utente(P, 'nt_admin')
  const admin2 = await utente(P, 'nt_admin2')
  await db.query(`update app_user set role = 'admin' where id = any($1::uuid[])`, [[admin, admin2]])
  const clear = async (u: string) => id(SUBMIT, [u, d.run, d.tier, JSON.stringify(payload(d.cards))])
  const clearA = await clear(autore)
  const clearB = await clear(autore)
  const clearAltro = await clear(altro)
  const clearAdmin2 = await clear(admin2)
  return {
    d, eventId, autore, altro, terzo, admin, admin2,
    clearA, vA: await versione(clearA), clearB, vB: await versione(clearB), clearAltro, clearAdmin2,
  }
}

async function regole() {
  console.log('\n  -- tipi, colonne e tabelle (0028)')
  const kinds = (await one<{ k: string[] }>('select notification_kinds() as k')).k
  check('notification_kinds: i sei tipi della v1',
    kinds.join(',') === 'clear_comment,content_hidden,content_unhidden,suspended,suspension_lifted,reports_open',
    kinds.join(','))
  for (const [tab, nome] of [['notification', 'notification_kind_check'], ['notification_pref', 'notification_pref_kind_check']]) {
    const def = (await one<{ d: string }>(
      `select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = $1::regclass and conname = $2`,
      [tab, nome])).d
    const nelCheck = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
    check(`${nome} coincide con notification_kinds()`, nelCheck.join(',') === [...kinds].sort().join(','), def)
  }
  const col = await q<{ t: string; c: string; ty: string }>(
    `select table_name as t, column_name as c, data_type as ty from information_schema.columns
      where (table_name = 'app_user' and column_name in ('notif_last_at', 'notif_seen_at'))
         or (table_name = 'tip_vote' and column_name = 'voted_at')
      order by 1, 2`)
  check('app_user.notif_last_at/notif_seen_at e tip_vote.voted_at, timestamptz',
    col.map((r) => `${r.t}.${r.c}`).join(',') === 'app_user.notif_last_at,app_user.notif_seen_at,tip_vote.voted_at' &&
    col.every((r) => r.ty === 'timestamp with time zone'), col.map((r) => `${r.t}.${r.c}`).join(','))
  const idx = await num(`select count(*) from pg_indexes where tablename = 'notification'
                            and indexname = 'notification_one_unread' and indexdef like '%WHERE (read_at IS NULL)%'`)
  check('l\'accorpamento e\' un indice unico parziale sulle non lette', idx === 1)
}

async function commenti(m: Mondo) {
  console.log('\n  -- clear_comment: al solo autore del clear, accorpato finche\' non e\' letto')
  const key = `comments:${m.clearA}`
  const c1 = await id(COMMENT, [m.altro, m.vA, 'Nice run, what about turn 4?'])
  let g = await gruppo(m.autore, key)
  check('un commento di un altro avvisa l\'autore del clear', g.length === 1 && g[0].kind === 'clear_comment' &&
    g[0].actor_id === m.altro, JSON.stringify(g))
  const riga = (await di(m.autore))[0]
  check('con il clear e senza commento salvato (il conteggio lo fa render)',
    riga.clear_id === m.clearA && riga.comment_id === null && riga.tip_id === null)
  check('chi commenta non riceve niente, ne\' gli altri', await nDi(m.altro) === 0 && await nDi(m.terzo) === 0 &&
    await nDi(m.admin) === 0 && await nDi(m.admin2) === 0)

  const prima = g[0].updated_at
  await id(COMMENT, [m.autore, m.vA, 'Thanks, I used the item on turn 3.'])
  g = await gruppo(m.autore, key)
  check('mai a se stessi: il commento sul proprio clear non scrive',
    g.length === 1 && g[0].updated_at.getTime() === prima.getTime() && await nDi(m.autore) === 1)

  const c3 = await id(COMMENT, [m.terzo, m.vA, 'Works with the F2P box too.'])
  g = await gruppo(m.autore, key)
  // in SQL: i microsecondi, che un Date di JS perde
  const toccata = (await one<{ t: boolean }>(
    'select updated_at > created_at as t from notification where id = $1', [g[0]?.id])).t
  check('un secondo commento accorpa nella stessa riga non letta (updated_at, ultimo attore)',
    g.length === 1 && g[0].actor_id === m.terzo && toccata, JSON.stringify(g))
  let v = await vista(m.autore, g[0].id)
  check('render: due commenti di altri (non il proprio), l\'handle dell\'ultimo',
    v.n === 2 && v.actor_handle === 'nt_terzo' && v.target === 'clear', JSON.stringify(v))
  check('render: evento, regione, tier e nomi per il link e il testo',
    v.event_id === m.eventId && v.tier_id === m.d.tier && (v.reg === 'global' || v.reg === 'japan') &&
    !!v.event_name && v.stage_seq !== null && !!v.difficulty, JSON.stringify(v))
  check('render: contenuto pubblicato, notifica visibile', v.content_visible === true && v.visible === true)
  check('render di una notifica di un altro: nessuna riga', (await q(RENDER, [m.altro, g[0].id])).length === 0)
  check('la lista di un altro non la contiene', !(await q<Vista>(LIST, [m.altro, 50])).some((r) => r.id === g[0].id))

  // nascondere un commento lo toglie dal conteggio, e l'ultimo autore torna quello di prima
  await db.query(HIDE_COMMENT, [m.admin, c3, 'hidden'])
  v = await vista(m.autore, g[0].id)
  check('un commento nascosto smette di contare', v.n === 1 && v.actor_handle === 'nt_altro', JSON.stringify(v))
  await db.query(HIDE_COMMENT, [m.admin, c3, 'published'])

  console.log('\n  -- letta: il commento dopo apre una riga nuova')
  check('mark_notifications_read su quella riga: 1', (await one<{ n: number }>(MARK, [m.autore, [g[0].id]])).n === 1)
  check('e una seconda volta: 0', (await one<{ n: number }>(MARK, [m.autore, [g[0].id]])).n === 0)
  await id(COMMENT, [m.altro, m.vA, 'One more question about the friend slot.'])
  g = await gruppo(m.autore, key)
  check('dopo la lettura il commento nuovo apre una riga nuova', g.length === 2 && g[0].read_at !== null &&
    g[1].read_at === null, JSON.stringify(g.map((r) => r.read_at)))
  const vecchia = await vista(m.autore, g[0].id)
  const nuova = await vista(m.autore, g[1].id)
  check('la letta conta i suoi commenti, la nuova solo il nuovo', vecchia.n === 2 && nuova.n === 1 &&
    nuova.actor_handle === 'nt_altro', `${vecchia.n} ${nuova.n}`)
  return { c1, c3 }
}

async function pallinoColonne(m: Mondo) {
  console.log('\n  -- il pallino: notif_last_at > notif_seen_at')
  const u = await one<{ last: Date | null; seen: Date | null }>(
    'select notif_last_at as last, notif_seen_at as seen from app_user where id = $1', [m.autore])
  check('una notifica non letta accende il pallino (notif_last_at dopo notif_seen_at)', u.last !== null &&
    await pallino(m.autore), JSON.stringify(u))
  check('chi non ha notifiche non ha il pallino', !(await pallino(m.altro)) || await nDi(m.altro) > 0)
  // una seconda non letta, poi se ne segna una sola: il pallino resta
  await id(COMMENT, [m.terzo, m.vB, 'Clean team, saving this one.'])
  const nonLette = (await di(m.autore)).filter((r) => r.read_at === null)
  check('due non lette (due clear diversi, due gruppi)', nonLette.length === 2, String(nonLette.length))
  const seen = async () => (await one<{ s: string | null }>(
    'select notif_seen_at::text as s from app_user where id = $1', [m.autore])).s
  const seenPrima = await seen()
  await db.query(MARK, [m.autore, [nonLette[0].id]])
  check('segnarne una sola con altre non lette non spegne il pallino (notif_seen_at fermo)',
    await pallino(m.autore) && await seen() === seenPrima)
  check('segnare tutte (null) spegne il pallino', (await one<{ n: number }>(MARK, [m.autore, null])).n === 1 &&
    !(await pallino(m.autore)) && await num(
      'select count(*) from notification where recipient_id = $1 and read_at is null', [m.autore]) === 0)
  check('mark_notifications_read non tocca le notifiche degli altri',
    (await one<{ n: number }>(MARK, [m.altro, (await di(m.autore)).map((r) => r.id)])).n === 0)
  await id(COMMENT, [m.altro, m.vB, 'Which leader skill did you run?'])
  check('una notifica nuova lo riaccende', await pallino(m.autore))
  // la corsa con la lista segnata letta "nel futuro" (un now() piu' recente del nostro): resta acceso
  await db.query(MARK, [m.autore, null])
  await db.query(`update app_user set notif_seen_at = now() + interval '1 hour' where id = $1`, [m.autore])
  await id(COMMENT, [m.terzo, m.vB, 'Swapped the floater and it still works.'])
  check('notif_last_at finisce sempre dopo notif_seen_at', await pallino(m.autore))
  await db.query(MARK, [m.autore, null])
  check('e la lista letta lo spegne di nuovo', !(await pallino(m.autore)))
  // una notifica sparita col suo contenuto: segnare (anche zero righe) spegne il pallino
  await db.query(`update app_user set notif_last_at = now() where id = $1`, [m.autore])
  check('zero righe da segnare spengono comunque il pallino',
    (await one<{ n: number }>(MARK, [m.autore, []])).n === 0 && !(await pallino(m.autore)))
}

async function moderazione(m: Mondo, c: { c1: string }) {
  console.log('\n  -- moderazione dei miei contenuti (dal registro)')
  const altriPrima = await nDi(m.admin) + await nDi(m.admin2)
  await db.query(HIDE_CLEAR, [m.admin, m.clearA, 'hidden'])
  let g = await gruppo(m.autore, `mod:content_hidden:${m.clearA}`)
  check('nascondere un clear avvisa il suo autore', g.length === 1 && g[0].kind === 'content_hidden' &&
    g[0].actor_id === m.admin, JSON.stringify(g))
  const vh = await vista(m.autore, g[0].id)
  check('render: target clear, contenuto non visibile, la notifica si mostra',
    vh.target === 'clear' && vh.clear_id === m.clearA && vh.content_visible === false && vh.visible === true &&
    vh.actor_handle === null, JSON.stringify(vh))
  check('il moderatore e gli altri admin non ricevono niente', await nDi(m.admin) + await nDi(m.admin2) === altriPrima)
  const commentiA = (await di(m.autore)).find((r) => r.group_key === `comments:${m.clearA}`)!
  const vc = await vista(m.autore, commentiA.id)
  check('contenuto nascosto: la notifica dei commenti non e\' visibile', vc.content_visible === false &&
    vc.visible === false, JSON.stringify(vc))
  // un commento sul clear nascosto (dall'API di 0002, che non guarda lo stato) non avvisa
  await db.query('select add_clear_comment($1::uuid, $2::uuid, $3)', [m.terzo, m.vA, 'Hidden clear comment.'])
  check('un commento su un clear nascosto non avvisa',
    (await gruppo(m.autore, `comments:${m.clearA}`)).filter((r) => r.read_at === null).length === 0)

  await db.query(HIDE_CLEAR, [m.admin, m.clearA, 'published'])
  g = await gruppo(m.autore, `mod:content_unhidden:${m.clearA}`)
  check('rimostrarlo avvisa (content_unhidden), con il contenuto visibile',
    g.length === 1 && (await vista(m.autore, g[0].id)).content_visible === true)
  await db.query(HIDE_CLEAR, [m.admin2, m.clearA, 'hidden'])
  g = await gruppo(m.autore, `mod:content_hidden:${m.clearA}`)
  check('nasconderlo di nuovo mentre e\' non letta: la stessa riga, l\'ultimo moderatore',
    g.length === 1 && g[0].actor_id === m.admin2, JSON.stringify(g))
  await db.query(HIDE_CLEAR, [m.admin2, m.clearA, 'published'])
  check('lo stesso stato due volte non scrive il registro, quindi niente notifica',
    (await one<{ n: number }>(HIDE_CLEAR, [m.admin, m.clearA, 'published'])).n === 0 &&
    (await gruppo(m.autore, `mod:content_unhidden:${m.clearA}`)).length === 1)

  // un commento: la notifica porta commento e clear
  await db.query(HIDE_COMMENT, [m.admin, c.c1, 'hidden'])
  g = await gruppo(m.altro, `mod:content_hidden:${c.c1}`)
  const vcm = g.length ? await vista(m.altro, g[0].id) : null
  check('nascondere un commento avvisa chi l\'ha scritto, con commento e clear',
    vcm?.target === 'comment' && vcm.comment_id === c.c1 && vcm.clear_id === m.clearA &&
    vcm.content_visible === false && vcm.visible === true, JSON.stringify(vcm))

  // una tip
  const tip = await id(POST_TIP, [m.autore, m.eventId, m.d.tier, 'Bring two Super INT links for the boss.'])
  await db.query(HIDE_TIP, [m.admin, tip, 'hidden'])
  g = await gruppo(m.autore, `mod:content_hidden:${tip}`)
  const vt = g.length ? await vista(m.autore, g[0].id) : null
  check('nascondere una tip avvisa l\'autore (target tip, evento della tip)',
    vt?.target === 'tip' && vt.tip_id === tip && vt.event_id === m.eventId && vt.content_visible === false,
    JSON.stringify(vt))

  // archiviare le segnalazioni non dice all'autore che e' stato segnalato
  const primaAltro = await nDi(m.altro)
  await db.query(REPORT, [m.terzo, 'clear', m.clearAltro, 'spam', null])
  await db.query(DISMISS, [m.admin, 'clear', m.clearAltro])
  check('dismiss: niente all\'autore segnalato', await nDi(m.altro) === primaAltro)

  // un admin che nasconde un proprio contenuto non avvisa se stesso
  const primaAdmin2 = await nDi(m.admin2)
  await db.query(HIDE_CLEAR, [m.admin2, m.clearAdmin2, 'hidden'])
  await db.query(HIDE_CLEAR, [m.admin2, m.clearAdmin2, 'published'])
  check('mai a se stessi: l\'admin che nasconde il proprio clear', await nDi(m.admin2) === primaAdmin2)
  return { tip }
}

async function sospensione(m: Mondo) {
  console.log('\n  -- sospensione: avvisata, e chi e\' sospeso riceve ancora le sue')
  const until = new Date(Date.now() + 3 * 86400_000)
  await db.query(SUSPEND, [m.admin, m.autore, until.toISOString(), 'Spam in comments.'])
  let g = await gruppo(m.autore, `mod:suspended:${m.autore}`)
  const vs = g.length ? await vista(m.autore, g[0].id) : null
  check('la sospensione avvisa l\'interessato, con la data di fine e senza il motivo',
    vs?.kind === 'suspended' && vs.target === 'account' && vs.content_visible === null && vs.visible &&
    Math.abs((vs.until?.getTime() ?? 0) - until.getTime()) < 1000 && !JSON.stringify(g[0].data).includes('Spam'),
    JSON.stringify({ vs, data: g[0]?.data }))
  // sospeso: un commento di un altro sul suo clear e una moderazione dei suoi contenuti arrivano lo stesso
  await db.query(MARK, [m.autore, null])
  await id(COMMENT, [m.altro, m.vA, 'Still the best team for this stage.'])
  check('sospeso: il commento sul suo clear lo avvisa ancora',
    (await gruppo(m.autore, `comments:${m.clearA}`)).some((r) => r.read_at === null))
  await db.query(HIDE_CLEAR, [m.admin, m.clearB, 'hidden'])
  check('sospeso: la moderazione dei suoi contenuti lo avvisa ancora',
    (await gruppo(m.autore, `mod:content_hidden:${m.clearB}`)).length === 1)
  await db.query(HIDE_CLEAR, [m.admin, m.clearB, 'published'])
  check('sospeso: il pallino si accende', await pallino(m.autore))

  await db.query(UNSUSPEND, [m.admin, m.autore])
  g = await gruppo(m.autore, `mod:suspension_lifted:${m.autore}`)
  check('riattivarlo avvisa (suspension_lifted)', g.length === 1 && g[0].actor_id === m.admin)
  await db.query(SUSPEND, [m.admin, m.terzo, null, null])
  g = await gruppo(m.terzo, `mod:suspended:${m.terzo}`)
  check('a tempo indeterminato: until infinito', g.length === 1 && (await one<{ inf: boolean }>(
    `select until = 'infinity' as inf from notification_render($1::uuid, $2::bigint)`, [m.terzo, g[0].id])).inf)
  await db.query(UNSUSPEND, [m.admin, m.terzo])
  // una sospensione gia' scaduta si ripulisce senza registro: niente notifica
  await db.query(`update app_user set suspended_until = now() - interval '1 minute' where id = $1`, [m.terzo])
  const primaTerzo = await nDi(m.terzo)
  check('riattivare una sospensione scaduta non avvisa',
    (await one<{ ok: boolean }>(UNSUSPEND, [m.admin, m.terzo])).ok === false && await nDi(m.terzo) === primaTerzo)
  // i ruoli da script non avvisano
  await db.query(`select set_user_role('nt_terzo', 'editor')`)
  await db.query(`select set_user_role('nt_terzo', 'member')`)
  check('set_user_role non avvisa', await nDi(m.terzo) === primaTerzo)
}

async function segnalazioni(m: Mondo) {
  console.log('\n  -- reports_open: agli admin, mai a chi segnala ne\' a chi e\' segnalato')
  await db.query(MARK, [m.admin, null])
  await db.query(MARK, [m.admin2, null])
  const primaAltro = await nDi(m.altro)
  const primaTerzo = await nDi(m.terzo)
  const r1 = await id(REPORT, [m.terzo, 'clear', m.clearAltro, 'offensive', null])
  const coda = async (u: string) =>
    (await gruppo(u, 'reports_queue')).filter((r) => r.read_at === null)
  let a1 = await coda(m.admin)
  let a2 = await coda(m.admin2)
  check('una segnalazione avvisa ogni admin', a1.length === 1 && a2.length === 1 && a1[0].kind === 'reports_open')
  check('chi segnala non riceve niente', await nDi(m.terzo) === primaTerzo)
  check('chi e\' segnalato non riceve niente', await nDi(m.altro) === primaAltro)
  let v = await vista(m.admin, a1[0].id)
  check('render: una aperta, senza handle (ne\' di chi segnala), target reports',
    v.n === 1 && v.actor_handle === null && v.target === 'reports' && v.visible && v.content_visible === null,
    JSON.stringify(v))

  await id(REPORT, [m.autore, 'clear', m.clearAltro, 'spam', null])
  a1 = await coda(m.admin)
  v = await vista(m.admin, a1[0].id)
  check('una seconda accorpa: una riga, due aperte', a1.length === 1 && v.n === 2, String(v.n))

  // un admin che segnala non avvisa se stesso, l'altro admin si'
  const primaA1 = (await gruppo(m.admin, 'reports_queue')).length
  await id(REPORT, [m.admin, 'comment', (await one<{ id: string }>(
    `select m.id::text from clear_comment m where m.version_id = $1 and m.author_id = $2 and m.status = 'published'
      order by m.created_at desc limit 1`, [m.vA, m.altro])).id, 'spam', null])
  a2 = await coda(m.admin2)
  check('l\'admin che segnala non e\' avvisato, l\'altro si\'',
    (await gruppo(m.admin, 'reports_queue')).length === primaA1 && (await vista(m.admin2, a2[0].id)).n === 3)

  // un admin segnalato non e' avvisato (non deve sapere di esserlo), e il
  // suo conteggio non conta le segnalazioni sui propri contenuti
  await db.query(MARK, [m.admin, null])
  await db.query(MARK, [m.admin2, null])
  await id(REPORT, [m.autore, 'comment', (await one<{ id: string }>(
    `select m.id::text from clear_comment m where m.version_id = $1 and m.author_id = $2 and m.status = 'published'
      order by m.created_at desc limit 1`, [m.vA, m.terzo])).id, 'offensive', null])
  const riga2 = (await coda(m.admin2))[0]
  await id(REPORT, [m.terzo, 'clear', m.clearAdmin2, 'wrong_stage', null])
  const dopo2 = (await coda(m.admin2))[0]
  check('l\'admin segnalato non riceve niente (la sua riga non si muove)',
    dopo2?.id === riga2?.id && dopo2.updated_at.getTime() === riga2.updated_at.getTime())
  check('e non la conta, l\'altro admin si\'', (await vista(m.admin2, riga2.id)).n === 1 &&
    (await vista(m.admin, (await coda(m.admin))[0].id)).n === 2)

  // un admin sospeso (solo da SQL: mod_suspend_user non sospende gli admin) non e' avvisato
  await db.query(MARK, [m.admin, null])
  await db.query(MARK, [m.admin2, null])
  await db.query(`update app_user set suspended_until = now() + interval '1 hour' where id = $1`, [m.admin2])
  await id(REPORT, [m.terzo, 'comment', (await one<{ id: string }>(
    `select m.id::text from clear_comment m where m.version_id = $1 and m.author_id = $2 and m.status = 'published'
      order by m.created_at desc limit 1`, [m.vA, m.autore])).id, 'spam', null])
  check('un admin sospeso non e\' avvisato delle segnalazioni', (await coda(m.admin2)).length === 0 &&
    (await coda(m.admin)).length === 1)
  await db.query(`update app_user set suspended_until = null where id = $1`, [m.admin2])

  // chi non e' piu' admin non la vede piu'
  await db.query(`update app_user set role = 'member' where id = $1`, [m.admin])
  check('chi non e\' piu\' admin non la vede piu\'', !(await vista(m.admin, (await coda(m.admin))[0].id)).visible)
  await db.query(`update app_user set role = 'admin' where id = $1`, [m.admin])
  // chiuse tutte: la notifica non e' piu' visibile
  const aperte = await q<{ target_kind: string; target_id: string }>(
    `select distinct target_kind, target_id::text from report where status = 'open' and created_at >= $1`,
    [(await coda(m.admin))[0].created_at])
  for (const r of aperte) await db.query(DISMISS, [m.admin, r.target_kind, r.target_id])
  v = await vista(m.admin, (await coda(m.admin))[0].id)
  check('archiviate le segnalazioni: n = 0, non visibile', v.n === 0 && v.visible === false, JSON.stringify(v))
  void r1
}

async function silenzio(m: Mondo) {
  console.log('\n  -- dts.silent: seed, fixture e import non avvisano')
  const tutte = () => num(`select count(*) from notification`)
  const prima = await tutte()
  const last = async () => (await one<{ l: Date | null }>(
    'select notif_last_at as l from app_user where id = $1', [m.autore])).l?.getTime() ?? 0
  const lastPrima = await last()
  const c = await db.connect()
  try {
    await c.query('begin')
    await c.query(`set local dts.silent = 'on'`)
    await c.query(COMMENT, [m.altro, m.vA, 'Silent import comment.'])
    await c.query(REPORT, [m.altro, 'clear', m.clearAdmin2, 'spam', null])
    await c.query(HIDE_CLEAR, [m.admin, m.clearB, 'hidden'])
    await c.query(HIDE_CLEAR, [m.admin, m.clearB, 'published'])
    await c.query('commit')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
  check('con dts.silent nessun trigger scrive (commento, segnalazione, moderazione)', await tutte() === prima,
    `${prima} -> ${await tutte()}`)
  check('e il pallino non si muove', await last() === lastPrima)
  await id(COMMENT, [m.terzo, m.vA, 'Not silent anymore.'])
  check('set local finisce con la transazione: dopo si avvisa di nuovo', await last() > lastPrima)

  // la fixture: il commento di 02_community.sql non ha lasciato notifiche
  const fixture = await num(
    `select count(*) from notification x
       join clear_comment k on k.author_id = x.actor_id and k.created_at = x.created_at
      where k.author_id = '33333333-3333-3333-3333-333333333333'`)
  check('il commento della fixture non ha avvisato nessuno (reset.mjs con dts.silent)', fixture === 0, String(fixture))

  // gli script che scrivono dati della community lo devono dire: seed, fixture, import
  const root = new URL('../../', import.meta.url)
  const scritture = /\b(insert\s+into\s+(clear_comment|report|moderation_action|clear)\b|(comment_clear_version|add_clear_comment|report_content|mod_set_\w+|mod_suspend_user|mod_unsuspend_user|submit_clear\w*|post_tip)\s*\()/i
  const file = ['db/seed', 'db/import'].flatMap((dir) =>
    readdirSync(new URL(dir, root)).filter((f) => f.endsWith('.mjs')).map((f) => `${dir}/${f}`))
  const senza = file.filter((f) => {
    const src = readFileSync(new URL(f, root), 'utf8')
    return scritture.test(src) && !/set local dts\.silent = 'on'/.test(src)
  })
  check('ogni seed e import che scrive dati della community imposta dts.silent', senza.length === 0, senza.join(', '))
  check('db/seed/demo-clears.mjs lo imposta',
    /set local dts\.silent = 'on'/.test(readFileSync(new URL('db/seed/demo-clears.mjs', root), 'utf8')))
  check('db/reset.mjs lo imposta per la fixture',
    /set local dts\.silent = 'on'/.test(readFileSync(new URL('db/reset.mjs', root), 'utf8')))
}

async function preferenze(m: Mondo) {
  console.log('\n  -- set_notification_pref (push ed email delle fasi 3 e 4)')
  const righe = (u: string) => num('select count(*) from notification_pref where user_id = $1', [u])
  check('accendere scrive una riga', (await one<{ on: boolean }>(PREF, [m.altro, 'clear_comment', 'push', true])).on &&
    await righe(m.altro) === 1)
  await db.query(PREF, [m.altro, 'clear_comment', 'push', true])
  check('due volte resta una riga', await righe(m.altro) === 1)
  await db.query(PREF, [m.altro, 'content_hidden', 'email', true])
  check('spegnere la toglie', !(await one<{ on: boolean }>(PREF, [m.altro, 'clear_comment', 'push', false])).on &&
    await righe(m.altro) === 1)
  check('un tipo sconosciuto e\' rifiutato', await esito(PREF, [m.altro, 'clear_upvotes', 'push', true]) ===
    '23514 notification_pref_kind')
  check('un canale sconosciuto e\' rifiutato', await esito(PREF, [m.altro, 'clear_comment', 'sms', true]) ===
    '23514 notification_pref_channel')
  check('null non e\' un valore', await esito(PREF, [m.altro, 'clear_comment', 'push', null]) ===
    '23514 notification_pref_value')
  check('reports_open solo per gli admin', await esito(PREF, [m.altro, 'reports_open', 'email', true]) ===
    '42501 notification_pref_admin_only' && await esito(PREF, [m.admin, 'reports_open', 'email', true]) === 'ok')
  check('spegnere reports_open si puo\' sempre', await esito(PREF, [m.altro, 'reports_open', 'email', false]) === 'ok')
  const nuovo = await utente(P, 'nt_nuovo', false)
  check('senza onboarding: user_not_found', await esito(PREF, [nuovo, 'clear_comment', 'push', true]) ===
    'P0002 user_not_found')
}

async function cascate(m: Mondo, t: { tip: string }) {
  console.log('\n  -- cascate: account e contenuti cancellati')
  // un utente che riceve (notifiche, preferenze) e che agisce (attore negli altri)
  const x = await utente(P, 'nt_cancella')
  const clearX = await id(SUBMIT, [x, m.d.run, m.d.tier, JSON.stringify(payload(m.d.cards))])
  await id(COMMENT, [m.altro, await versione(clearX), 'Comment on a soon deleted account.'])
  await db.query(PREF, [x, 'clear_comment', 'email', true])
  await db.query(MARK, [m.autore, null])
  await id(COMMENT, [x, m.vB, 'I am the actor here.'])
  const suAutore = (await gruppo(m.autore, `comments:${m.clearB}`)).find((r) => r.read_at === null)!
  check('prima: x ha notifiche e preferenze, ed e\' l\'attore di una dell\'autore',
    await nDi(x) === 1 && suAutore?.actor_id === x &&
    await num('select count(*) from notification_pref where user_id = $1', [x]) === 1)
  await db.query('select delete_account($1::uuid, $2)', [x, 'nt_cancella'])
  check('delete_account: le sue notifiche e preferenze se ne vanno',
    await num('select count(*) from notification where recipient_id = $1', [x]) === 0 &&
    await num('select count(*) from notification_pref where user_id = $1', [x]) === 0)
  const dopo = await one<{ actor_id: string | null }>('select actor_id::text from notification where id = $1', [suAutore.id])
  const v = await vista(m.autore, suAutore.id)
  check('quelle in cui era l\'attore restano, con actor_id null, e senza i suoi commenti non contano piu\'',
    dopo !== undefined && dopo.actor_id === null && v.n === 0 && v.visible === false, JSON.stringify(v))

  // i contenuti: tip e commento cancellati portano via le loro notifiche
  const gTip = await gruppo(m.autore, `mod:content_hidden:${t.tip}`)
  await db.query('select delete_tip($1::uuid, $2::uuid)', [m.autore, t.tip])
  check('una tip cancellata porta via le sue notifiche', gTip.length === 1 &&
    await num('select count(*) from notification where tip_id = $1', [t.tip]) === 0)
  const nascosto = await one<{ comment_id: string }>(
    `select comment_id::text from notification where recipient_id = $1 and comment_id is not null limit 1`, [m.altro])
  await db.query('delete from clear_comment where id = $1', [nascosto.comment_id])
  check('un commento cancellato porta via le sue notifiche',
    await num('select count(*) from notification where comment_id = $1', [nascosto.comment_id]) === 0)
  const primaClear = await num('select count(*) from notification where clear_id = $1', [m.clearB])
  await db.query('select delete_clear($1::uuid, $2::uuid)', [m.autore, m.clearB])
  check('un clear cancellato porta via le sue notifiche', primaClear > 0 &&
    await num('select count(*) from notification where clear_id = $1', [m.clearB]) === 0, String(primaClear))
}

async function conservazione(m: Mondo) {
  console.log('\n  -- purge_notifications: lette dopo 30 giorni, non lette dopo 90')
  const crea = async (giorni: number, letta: boolean) => (await one<{ id: string }>(
    `insert into notification (recipient_id, kind, group_key, created_at, updated_at, read_at)
     values ($1, 'suspension_lifted', $2, now() - make_interval(days => $3 + 1), now() - make_interval(days => $3),
             case when $4 then now() - make_interval(days => $3) end)
     returning id::text`, [m.terzo, `purge:${giorni}:${letta}:${Math.random()}`, giorni, letta])).id
  const letta31 = await crea(31, true)
  const letta29 = await crea(29, true)
  const nonLetta91 = await crea(91, false)
  const nonLetta89 = await crea(89, false)
  const n = (await one<{ n: number }>('select purge_notifications() as n')).n
  const resta = async (r: string) => await num('select count(*) from notification where id = $1', [r]) === 1
  check('toglie le lette da oltre 30 giorni e le non lette da oltre 90', n >= 2 &&
    !(await resta(letta31)) && !(await resta(nonLetta91)), String(n))
  check('lascia le lette da 29 giorni e le non lette da 89', await resta(letta29) && await resta(nonLetta89))
  const route = readFileSync(new URL('../../app/api/cron/purge/route.ts', import.meta.url), 'utf8')
  check('il cron giornaliero la chiama', /select purge_notifications\(\)/.test(route))
}

async function pulizia() {
  await db.query('delete from app_user where email like $1', [`${P}+%@example.invalid`])
}

try {
  await pulizia()
  await regole()
  const m = await mondo()
  const c = await commenti(m)
  await pallinoColonne(m)
  const t = await moderazione(m, c)
  await sospensione(m)
  await segnalazioni(m)
  await silenzio(m)
  await preferenze(m)
  await cascate(m, t)
  await conservazione(m)
} finally {
  await pulizia()
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
