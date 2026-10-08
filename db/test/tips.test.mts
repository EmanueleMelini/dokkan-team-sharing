// Verifica le tip (migrazione 0025, lib/tips.ts, lib/tips/*): il bersaglio
// (evento, e il tier solo se e' di quell'evento), lunghezze e link (gli
// accorciatori rifiutati), il tetto per bersaglio, il doppione, i limiti
// per ora, la modifica che tiene i voti, la cancellazione con voti e
// segnalazioni, il voto solo "helpful" e idempotente, la sospensione,
// report_content sulle tip, mod_set_tip_status (chi, registro,
// segnalazioni), le cascate, e le letture vere di lib/tips.ts con
// l'ordine della pagina.
//
// Gira sul database di test (npm run db:test). Crea solo utenti
// tiptest+...@example.invalid e li toglie alla fine, anche se qualcosa
// fallisce. Le righe di moderation_action restano (il registro non si
// cancella): ogni verifica conta solo quelle dei propri bersagli.
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import { listTips, viewerTipState, tipEvent } from '@/lib/tips'
import { TIP_CONSTRAINTS, friendlyTipError } from '@/lib/tips/errors'
import {
  TIP_LIMITS, hostDi, ordina, parseTipBody, parseTipLink, parseTipScope, parseTipVote,
} from '@/lib/tips/validate'
import { MODERATION_CONSTRAINTS } from '@/lib/moderation/errors'
import { listHidden, listLog, listOpenReports, userModerationSummary } from '@/lib/moderation/queries'
import type { TipRow } from '@/lib/tips'
import { check, esito, guardia, num, one, q, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'tiptest'

const POST = 'select post_tip($1::uuid, $2::bigint, $3::bigint, $4, $5)::text as id'
const EDIT = 'select edit_tip($1::uuid, $2::uuid, $3, $4)::text as event_id'
const DELETE = 'select delete_tip($1::uuid, $2::uuid)::text as event_id'
const VOTE = 'select vote_tip($1::uuid, $2::uuid, $3::smallint) as score'
const REPORT = 'select report_content($1::uuid, $2, $3::uuid, $4, $5)::text as id'
const MOD = 'select mod_set_tip_status($1::uuid, $2::uuid, $3, $4) as n'
const NESSUNO = '00000000-0000-0000-0000-00000000dead'

const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params)).id
const voto = async (u: string, t: string, v: number) => (await one<{ score: number }>(VOTE, [u, t, v])).score
const corpo = (n: number | string) => `Tip ${n}: open with the defensive unit, then swap in the nuker.`

type Mondo = {
  ev: string; tier: string; tier2: string | null; altroEv: string; altroTier: string
  autore: string; altro: string; terzo: string; quarto: string; admin: string; nuovo: string; sospeso: string
}

async function mondo(): Promise<Mondo> {
  // un evento con almeno un tier, e se c'e' un secondo tier dello stesso
  const ev = await one<{ ev: string; tier: string; tier2: string | null }>(
    `select st.event_id::text as ev, min(st.id)::text as tier,
            (select x.id::text from stage_tier x where x.event_id = st.event_id and x.id <> min(st.id) order by x.id limit 1) as tier2
     from stage_tier st group by st.event_id order by count(*) desc, st.event_id limit 1`)
  // un altro evento senza tip (la fixture ne ha una su 5001): le letture contano le sue
  const altro = await one<{ ev: string; tier: string }>(
    `select st.event_id::text as ev, st.id::text as tier from stage_tier st
      where st.event_id <> $1::bigint and not exists (select 1 from tip t where t.event_id = st.event_id)
      order by st.id limit 1`, [ev.ev])
  const m: Mondo = {
    ev: ev.ev, tier: ev.tier, tier2: ev.tier2, altroEv: altro.ev, altroTier: altro.tier,
    autore: await utente(P, 'tt_autore'),
    altro: await utente(P, 'tt_altro'),
    terzo: await utente(P, 'tt_terzo'),
    quarto: await utente(P, 'tt_quarto'),
    admin: await utente(P, 'tt_admin'),
    nuovo: await utente(P, 'tt_nuovo', false),
    sospeso: await utente(P, 'tt_sospeso'),
  }
  await db.query(`update app_user set role = 'admin' where id = $1`, [m.admin])
  return m
}

/** Le frasi: ogni nome 'tip_*' della migrazione ne ha una, e nessuna in piu'. */
function frasi() {
  console.log('\n  -- le frasi dei rifiuti')
  const sql = readFileSync(new URL('../migrations/0025_tips.sql', import.meta.url), 'utf8')
  const nomi = new Set<string>()
  for (const m of sql.matchAll(/tip_fail\('([a-z_]+)'/g)) nomi.add(m[1])
  // drop constraint tip_has_target: quello se ne va, non ha frase
  for (const m of sql.matchAll(/(?<!drop )constraint (tip_[a-z_]+)/gi)) nomi.add(m[1])
  for (const m of sql.matchAll(/unique index (tip_[a-z_]+)/gi)) nomi.add(m[1])
  const lista = [...nomi]
  const senza = lista.filter((n) => !friendlyTipError({ constraint: n }))
  check('ogni rifiuto di 0025 ha una frase', lista.length >= 15 && senza.length === 0, senza.join(', ') || String(lista.length))
  check('e la tabella delle frasi non ha nomi in piu\'',
    TIP_CONSTRAINTS.length === lista.length && TIP_CONSTRAINTS.every((n) => nomi.has(n)),
    TIP_CONSTRAINTS.filter((n) => !nomi.has(n)).join(', '))
  check('le frasi della moderazione restano quelle di 0024', MODERATION_CONSTRAINTS.every((n) => !n.startsWith('tip_')))
  check('nessuna frase con il trattino lungo', TIP_CONSTRAINTS.every((n) => !/—/.test(friendlyTipError({ constraint: n }) ?? '')))
  check('builder_author, il limite per ora e la sospensione hanno la loro frase',
    /Finish setting up/.test(friendlyTipError({ constraint: 'builder_author' }) ?? '') &&
    /last hour/.test(friendlyTipError({ constraint: 'builder_rate_limit' }) ?? '') &&
    /suspended/.test(friendlyTipError({ code: '42501', constraint: 'account_suspended' }) ?? ''))
  check('le segnalazioni (report_*) parlano come per clear e commenti',
    friendlyTipError({ constraint: 'report_own' }) === 'You cannot report your own post.')
  check('un 42501 senza nome, o un altro builder_*, e\' un guasto',
    friendlyTipError({ code: '42501' }) === null && friendlyTipError({ constraint: 'builder_shape' }) === null)
}

/** Le letture restano pure: i test le importano fuori da Next (come cache-tags.test.mts per gli altri). */
function puri() {
  console.log('\n  -- moduli puri e cache')
  for (const f of ['lib/tips.ts', 'lib/tips/validate.ts', 'lib/tips/errors.ts']) {
    const testo = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
    const trovato = testo.match(/['"]use cache|cacheTag\(|cacheLife\(|from 'next\/cache'/)
    check(`${f} senza 'use cache', cacheTag, cacheLife`, !trovato, trovato?.[0] ?? '')
  }
  const cache = readFileSync(new URL('../../lib/cache/tips.ts', import.meta.url), 'utf8')
  check('lib/cache/tips.ts: il tag dell\'evento, mai la sessione',
    /cacheTag\(eventTag\(eventId\)/.test(cache) && !/lib\/dal|next\/headers|lib\/auth/.test(cache))
}

function parser() {
  console.log('\n  -- i parser dei form')
  const b = parseTipBody('   Stall turn one.   ')
  check('il testo si ripulisce ai lati', b.ok && b.value === 'Stall turn one.')
  check('9 caratteri no, 10 si\'', !parseTipBody('x'.repeat(9)).ok && parseTipBody('x'.repeat(10)).ok)
  check('500 si\', 501 no', parseTipBody('y'.repeat(500)).ok && !parseTipBody('y'.repeat(501)).ok)
  check('per caratteri, come char_length: 500 emoji passano', parseTipBody('😀'.repeat(500)).ok)
  check('un non-testo no', !parseTipBody(null).ok && !parseTipBody(42).ok)
  const vuoto = parseTipLink('   ')
  check('link vuoto = null', vuoto.ok && vuoto.value === null)
  const yt = parseTipLink(' https://youtu.be/abc ')
  check('link https ripulito', yt.ok && yt.value === 'https://youtu.be/abc')
  check('http, spazi, javascript: e oltre 500 no',
    !parseTipLink('http://youtu.be/abc').ok && !parseTipLink('https://you tu.be').ok &&
    !parseTipLink('javascript:alert(1)').ok && !parseTipLink(`https://a.com/${'x'.repeat(490)}`).ok)
  check('scope: stage o event', parseTipScope('stage') === 'stage' && parseTipScope('event') === 'event' && parseTipScope('tier') === null)
  check('voto: 1 o 0, niente -1', parseTipVote('1') === 1 && parseTipVote('0') === 0 && parseTipVote('-1') === null && parseTipVote(null) === null)
  check('host senza www', hostDi('https://www.reddit.com/r/DBZDokkanBattle') === 'reddit.com' && hostDi('nonsense') === null)
  check('limiti: 10-500, 3 per bersaglio, 3 visibili, 50 per gruppo',
    TIP_LIMITS.bodyMin === 10 && TIP_LIMITS.body === 500 && TIP_LIMITS.perTarget === 3 &&
    TIP_LIMITS.shown === 3 && TIP_LIMITS.perScope === 50)
  const t = (id: string, score: number, giorno: number): TipRow => ({
    id, tierId: null, body: '', linkUrl: null, linkProvider: null, score,
    createdAt: new Date(Date.UTC(2026, 0, giorno)), editedAt: null, handle: 'x',
  })
  const righe = [t('a', 1, 1), t('b', 3, 2), t('c', 1, 5), t('d', 0, 9)]
  check('Top: punteggio, poi le piu\' nuove', ordina(righe, 'top').map((r) => r.id).join() === 'b,c,a,d')
  check('New: le piu\' nuove', ordina(righe, 'new').map((r) => r.id).join() === 'd,c,b,a')
  const tante = Array.from({ length: 60 }, (_, i) => t(`t${String(i).padStart(2, '0')}`, i % 7, i + 1))
  check('al massimo 50 per gruppo', ordina(tante, 'top').length === 50 && ordina(tante, 'new').length === 50)
}

/** post_tip: torna le tip che le sezioni dopo usano. */
async function scrivere(m: Mondo): Promise<{ evento: string; stage: string; conLink: string }> {
  console.log('\n  -- post_tip')
  const evento = await id(POST, [m.autore, m.ev, null, `  ${corpo('evento')}  `, null])
  const r = await one<{ event_id: string; stage_tier_id: string | null; body: string; status: string; lang: string; score: number }>(
    'select event_id::text, stage_tier_id::text, body, status, lang, score from tip where id = $1', [evento])
  check('una tip di tutto l\'evento, ripulita, pubblicata', r.event_id === m.ev && r.stage_tier_id === null &&
    r.body === corpo('evento') && r.status === 'published' && r.score === 0, JSON.stringify(r))
  const stage = await id(POST, [m.autore, m.ev, m.tier, corpo('stage'), ''])
  check('una tip del tier, link vuoto = nessun link',
    await num(`select count(*) from tip where id = $1 and stage_tier_id = $2 and link_url is null and link_provider is null`,
      [stage, m.tier]) === 1)
  const conLink = await id(POST, [m.altro, m.ev, m.tier, corpo('link'), ' https://www.youtube.com/watch?v=abc '])
  check('un link YouTube: provider youtube',
    await num(`select count(*) from tip where id = $1 and link_url = 'https://www.youtube.com/watch?v=abc' and link_provider = 'youtube'`, [conLink]) === 1)
  const altroHost = await id(POST, [m.altro, m.ev, null, corpo('host'), 'https://dokkan.wiki/wiki/Some_Page'])
  check('un host fuori lista: link senza provider',
    await num('select count(*) from tip where id = $1 and link_provider is null and link_url is not null', [altroHost]) === 1)
  await db.query('delete from tip where id = $1', [altroHost])

  check('9 caratteri: tip_body', await esito(POST, [m.autore, m.ev, null, ' 123456789 ', null]) === '23514 tip_body')
  check('501 caratteri: tip_body', await esito(POST, [m.autore, m.ev, null, 'x'.repeat(501), null]) === '23514 tip_body')
  check('testo nullo: tip_body', await esito(POST, [m.autore, m.ev, null, null, null]) === '23514 tip_body')
  check('il tier di un altro evento: tip_target', await esito(POST, [m.autore, m.ev, m.altroTier, corpo('x1'), null]) === '23514 tip_target')
  check('un evento che non c\'e\': tip_target', await esito(POST, [m.autore, '999999999', null, corpo('x2'), null]) === '23514 tip_target')
  check('un tier che non c\'e\': tip_target', await esito(POST, [m.autore, m.ev, '999999999', corpo('x3'), null]) === '23514 tip_target')
  for (const [nome, link] of [
    ['bit.ly (accorciatore)', 'https://bit.ly/abc'], ['t.co (accorciatore)', 'https://t.co/abc'],
    ['http://', 'http://youtu.be/abc'], ['uno spazio', 'https://youtu.be/a b'], ['javascript:', 'javascript:alert(1)'],
    ['oltre 500 caratteri', `https://youtu.be/${'x'.repeat(490)}`],
  ]) {
    check(`link ${nome}: tip_link`, await esito(POST, [m.terzo, m.ev, null, corpo(nome), link]) === '23514 tip_link')
  }

  check('la stessa tip due volte: tip_duplicate', await esito(POST, [m.autore, m.ev, null, corpo('evento'), null]) === '23514 tip_duplicate')
  check('anche con maiuscole e spazi diversi',
    await esito(POST, [m.autore, m.ev, null, `TIP EVENTO:   open with the defensive unit, then swap in the nuker.`, null]) === '23514 tip_duplicate')
  check('la stessa tip su un altro bersaglio passa', /^[0-9a-f-]{36}$/.test(await id(POST, [m.terzo, m.ev, m.tier, corpo('evento'), null])))

  // il tetto: 3 vive per autore sullo stesso bersaglio
  await id(POST, [m.autore, m.ev, m.tier, corpo('stage 2'), null])
  await id(POST, [m.autore, m.ev, m.tier, corpo('stage 3'), null])
  check('la quarta sullo stesso tier: tip_per_target', await esito(POST, [m.autore, m.ev, m.tier, corpo('stage 4'), null]) === '23514 tip_per_target')
  check('ma su tutto l\'evento si puo\' ancora', /^[0-9a-f-]{36}$/.test(await id(POST, [m.autore, m.ev, null, corpo('evento 2'), null])))

  check('senza handle: builder_author', await esito(POST, [m.nuovo, m.ev, null, corpo('nuovo'), null]) === '42501 builder_author')
  check('un utente che non c\'e\': builder_author', await esito(POST, [NESSUNO, m.ev, null, corpo('nessuno'), null]) === '42501 builder_author')

  // il limite per ora: 10 tip (le righe del registro restano anche se la tip se ne va)
  await db.query(`insert into clear_write_log (user_id, kind) select $1, 'tip' from generate_series(1, 10)`, [m.quarto])
  check('l\'undicesima tip dell\'ora: builder_rate_limit',
    await esito(POST, [m.quarto, m.ev, null, corpo('limite'), null]) === '54000 builder_rate_limit')
  check('un rifiuto non scrive nel registro', await num(`select count(*) from clear_write_log where user_id = $1 and kind = 'tip'`, [m.quarto]) === 10)
  await db.query('delete from clear_write_log where user_id = $1', [m.quarto])
  const prima = await num(`select count(*) from clear_write_log where user_id = $1 and kind = 'tip'`, [m.autore])
  check('ogni tip scritta conta nel registro, i rifiuti no', prima === 5, String(prima))
  return { evento, stage, conLink }
}

async function modificare(m: Mondo, t: { stage: string }) {
  console.log('\n  -- edit_tip')
  await voto(m.altro, t.stage, 1)
  const ev = (await one<{ event_id: string }>(EDIT, [m.autore, t.stage, corpo('stage, rivista'), 'https://imgur.com/a/xyz'])).event_id
  const r = await one<{ body: string; link_provider: string; score: number; edited: boolean }>(
    'select body, link_provider, score, edited_at is not null as edited from tip where id = $1', [t.stage])
  check('l\'autore modifica: testo, link, edited_at, e i voti restano',
    ev === m.ev && r.body === corpo('stage, rivista') && r.link_provider === 'imgur' && r.edited && r.score === 1, JSON.stringify(r))
  check('la modifica conta per tip_edit', await num(`select count(*) from clear_write_log where user_id = $1 and kind = 'tip_edit'`, [m.autore]) === 1)
  await one(EDIT, [m.autore, t.stage, corpo('stage, rivista'), ' https://imgur.com/a/xyz '])
  check('una modifica che non cambia niente non scrive', await num(`select count(*) from clear_write_log where user_id = $1 and kind = 'tip_edit'`, [m.autore]) === 1)
  await one(EDIT, [m.autore, t.stage, corpo('stage, rivista'), null])
  check('togliere il link toglie anche il provider',
    await num('select count(*) from tip where id = $1 and link_url is null and link_provider is null', [t.stage]) === 1)
  check('un altro utente: tip_not_yours', await esito(EDIT, [m.altro, t.stage, corpo('altrui'), null]) === '42501 tip_not_yours')
  check('troppo lunga: tip_body', await esito(EDIT, [m.autore, t.stage, 'z'.repeat(501), null]) === '23514 tip_body')
  check('un accorciatore: tip_link', await esito(EDIT, [m.autore, t.stage, corpo('stage, rivista'), 'https://tinyurl.com/x']) === '23514 tip_link')
  check('come un\'altra propria tip dello stesso bersaglio: tip_duplicate',
    await esito(EDIT, [m.autore, t.stage, corpo('stage 2'), null]) === '23514 tip_duplicate')
  check('una tip che non c\'e\': tip_missing', await esito(EDIT, [m.autore, NESSUNO, corpo('x'), null]) === '23514 tip_missing')
  await db.query(`update tip set status = 'hidden' where id = $1`, [t.stage])
  check('una tip nascosta: tip_missing', await esito(EDIT, [m.autore, t.stage, corpo('nascosta'), null]) === '23514 tip_missing')
  await db.query(`update tip set status = 'published' where id = $1`, [t.stage])
}

async function votare(m: Mondo, t: { evento: string }) {
  console.log('\n  -- vote_tip')
  check('1: punteggio 1', await voto(m.altro, t.evento, 1) === 1)
  check('1 di nuovo: resta 1 (idempotente)', await voto(m.altro, t.evento, 1) === 1)
  check('un secondo utente: 2', await voto(m.terzo, t.evento, 1) === 2)
  check('0: ritirato, 1', await voto(m.altro, t.evento, 0) === 1)
  check('0 di nuovo: niente da togliere, resta 1', await voto(m.altro, t.evento, 0) === 1)
  check('il voto ha la sua data', await num('select count(*) from tip_vote where tip_id = $1 and voted_at is not null', [t.evento]) === 1)
  check('l\'autore: tip_own_vote', await esito(VOTE, [m.autore, t.evento, 1]) === '42501 tip_own_vote')
  check('-1: tip_vote_value', await esito(VOTE, [m.altro, t.evento, -1]) === '23514 tip_vote_value')
  check('2: tip_vote_value', await esito(VOTE, [m.altro, t.evento, 2]) === '23514 tip_vote_value')
  check('una tip che non c\'e\': tip_missing', await esito(VOTE, [m.altro, NESSUNO, 1]) === '23514 tip_missing')
  check('senza handle: builder_author', await esito(VOTE, [m.nuovo, t.evento, 1]) === '42501 builder_author')
  await db.query(`update tip set status = 'hidden' where id = $1`, [t.evento])
  check('una tip nascosta: tip_missing', await esito(VOTE, [m.quarto, t.evento, 1]) === '23514 tip_missing')
  await db.query(`update tip set status = 'published' where id = $1`, [t.evento])
  check('il punteggio e\' la somma dei voti, su ogni tip',
    await num(`select count(*) from tip t where t.score <> (select coalesce(sum(value), 0) from tip_vote v where v.tip_id = t.id)`) === 0)
}

async function segnalare(m: Mondo, t: { conLink: string }): Promise<string> {
  console.log('\n  -- report_content sulle tip')
  const r1 = await id(REPORT, [m.autore, 'tip', t.conLink, 'wrong_info', null])
  check('si segnala la tip di un altro (wrong_info)', /^[0-9a-f-]{36}$/.test(r1))
  check('la stessa persona di nuovo: lo stesso id, nessuna riga in piu\'',
    await id(REPORT, [m.autore, 'tip', t.conLink, 'spam', null]) === r1 &&
    await num(`select count(*) from report where target_id = $1 and reporter_id = $2`, [t.conLink, m.autore]) === 1)
  await id(REPORT, [m.terzo, 'tip', t.conLink, 'other', ' Link is a scam. '])
  check('i dettagli ripuliti', await num(`select count(*) from report where target_id = $1 and details = 'Link is a scam.'`, [t.conLink]) === 1)
  check('la propria tip: report_own', await esito(REPORT, [m.altro, 'tip', t.conLink, 'spam', null]) === '23514 report_own')
  check('fake_proof (dei clear) su una tip: report_reason',
    await esito(REPORT, [m.quarto, 'tip', t.conLink, 'fake_proof', null]) === '23514 report_reason')
  check('"other" senza dettagli: report_details', await esito(REPORT, [m.quarto, 'tip', t.conLink, 'other', ' ']) === '23514 report_details')
  check('una tip che non c\'e\': report_target_missing',
    await esito(REPORT, [m.quarto, 'tip', NESSUNO, 'spam', null]) === '23514 report_target_missing')
  check('nessun nascondimento automatico dopo le segnalazioni',
    await num(`select count(*) from tip where id = $1 and status = 'published'`, [t.conLink]) === 1)
  check('ogni segnalazione nuova conta per il limite, il doppione no',
    await num(`select count(*) from clear_write_log where user_id = $1 and kind = 'report'`, [m.autore]) === 1)
  return r1
}

async function moderare(m: Mondo, t: { conLink: string }) {
  console.log('\n  -- mod_set_tip_status')
  check('un membro: mod_not_allowed', await esito(MOD, [m.terzo, t.conLink, 'hidden', null]) === '42501 mod_not_allowed')
  check('uno stato inventato: mod_status', await esito(MOD, [m.admin, t.conLink, 'flagged', null]) === '23514 mod_status')
  check('una tip che non c\'e\': mod_target_missing', await esito(MOD, [m.admin, NESSUNO, 'hidden', null]) === '23514 mod_target_missing')
  const aperte = await num(`select count(*) from report where target_id = $1 and status = 'open'`, [t.conLink])
  const coda = (await listOpenReports()).gruppi.find((g) => g.kind === 'tip' && g.targetId === t.conLink)
  check('la coda di /admin: la tip, il suo autore, il link come testo, il posto con #tips',
    !!coda && coda.n === 2 && coda.tip?.body === corpo('link') && coda.tip.link === 'https://www.youtube.com/watch?v=abc' &&
    coda.author?.handle === 'tt_altro' && coda.posto?.href === `/events/${m.ev}/t/${m.tier}#tips` &&
    coda.posto.tierId === m.tier && coda.reasons.wrong_info === 1 && coda.reasons.other === 1,
    JSON.stringify({ ...coda, details: undefined }))
  const n = (await one<{ n: number }>(MOD, [m.admin, t.conLink, 'hidden', ' Scam link. '])).n
  check('nascondere chiude le segnalazioni aperte come actioned', n === aperte && aperte === 2 &&
    await num(`select count(*) from report where target_id = $1 and status = 'actioned' and resolved_by = $2`, [t.conLink, m.admin]) === 2,
    `${n}/${aperte}`)
  const riga = await one<{ action: string; target_author_id: string; reports_closed: number; note: string; detail: Record<string, string> }>(
    `select action, target_author_id::text, reports_closed, note, detail from moderation_action
      where target_kind = 'tip' and target_id = $1 order by id desc limit 1`, [t.conLink])
  check('il registro: hide, l\'autore, quante chiuse, la nota, evento e tier (mai il testo)',
    riga.action === 'hide' && riga.target_author_id === m.altro && riga.reports_closed === 2 && riga.note === 'Scam link.' &&
    String(riga.detail.event_id) === m.ev && String(riga.detail.tier_id) === m.tier && !JSON.stringify(riga).includes('Tip link'),
    JSON.stringify(riga))
  check('di nuovo hidden: 0, e nessuna riga nel registro',
    (await one<{ n: number }>(MOD, [m.admin, t.conLink, 'hidden', null])).n === 0 &&
    await num(`select count(*) from moderation_action where target_kind = 'tip' and target_id = $1`, [t.conLink]) === 1)
  const nascoste = await listHidden('tip')
  const h = nascoste.righe.find((r) => r.id === t.conLink)
  check('la scheda Hidden delle tip: il testo, chi l\'ha nascosta, il posto',
    !!h && h.kind === 'tip' && h.text === corpo('link') && h.hiddenBy === 'tt_admin' && h.author === 'tt_altro' &&
    h.clearId === null && h.posto?.href === `/events/${m.ev}/t/${m.tier}#tips` && nascoste.totale >= 1, JSON.stringify(h))
  const scheda = await userModerationSummary('tt_altro')
  check('la scheda dell\'utente conta le tip e quelle nascoste', !!scheda && scheda.tips === 1 && scheda.tipsHidden === 1,
    JSON.stringify({ tips: scheda?.tips, nascoste: scheda?.tipsHidden }))
  const voce = (await listLog(0, { authorId: m.altro })).voci.find((v) => v.targetKind === 'tip' && v.targetId === t.conLink)
  check('il registro porta all\'evento della tip', voce?.posto?.href === `/events/${m.ev}/t/${m.tier}#tips`, JSON.stringify(voce?.posto))
  check('una tip nascosta non si segnala', await esito(REPORT, [m.quarto, 'tip', t.conLink, 'spam', null]) === '23514 report_target_missing')
  const nascosta = await listTips(m.ev, m.tier)
  check('ne\' si legge nella pagina', !nascosta.stage.tips.some((x) => x.id === t.conLink))
  const viewer = await viewerTipState(m.altro, m.tier)
  check('ne\' nello stato del suo autore', !viewer.ownTips.includes(t.conLink))
  await one(MOD, [m.admin, t.conLink, 'published', null])
  check('rimostrare: unhide nel registro, la tip torna',
    await num(`select count(*) from moderation_action where target_kind = 'tip' and target_id = $1 and action = 'unhide'`, [t.conLink]) === 1 &&
    (await listTips(m.ev, m.tier)).stage.tips.some((x) => x.id === t.conLink))
  check('e si puo\' segnalare di nuovo', /^[0-9a-f-]{36}$/.test(await id(REPORT, [m.autore, 'tip', t.conLink, 'spam', null])))
  const archiviate = (await one<{ n: number }>('select mod_dismiss_reports($1::uuid, $2, $3::uuid, $4) as n',
    [m.admin, 'tip', t.conLink, null])).n
  check('mod_dismiss_reports (0024) vale anche per le tip', archiviate === 1 &&
    await num(`select count(*) from moderation_action where target_kind = 'tip' and target_id = $1 and action = 'dismiss'`, [t.conLink]) === 1)
}

async function sospensione(m: Mondo) {
  console.log('\n  -- chi e\' sospeso')
  const sua = await id(POST, [m.sospeso, m.ev, null, corpo('sospeso'), null])
  const resta = await id(POST, [m.sospeso, m.ev, null, corpo('sospeso resta'), null])
  const altrui = await id(POST, [m.quarto, m.ev, null, corpo('quarto'), null])
  await one('select mod_suspend_user($1::uuid, $2::uuid, null, $3)', [m.admin, m.sospeso, 'test'])
  check('non scrive: account_suspended', await esito(POST, [m.sospeso, m.ev, null, corpo('sospeso 2'), null]) === '42501 account_suspended')
  check('non modifica', await esito(EDIT, [m.sospeso, sua, corpo('sospeso 3'), null]) === '42501 account_suspended')
  check('non vota', await esito(VOTE, [m.sospeso, altrui, 1]) === '42501 account_suspended')
  check('non segnala', await esito(REPORT, [m.sospeso, 'tip', altrui, 'spam', null]) === '42501 account_suspended')
  check('ma cancella la propria tip (come delete_clear)',
    (await one<{ event_id: string }>(DELETE, [m.sospeso, sua])).event_id === m.ev &&
    await num('select count(*) from tip where id = $1', [sua]) === 0)
  check('le altre sue tip restano visibili', (await listTips(m.ev, m.tier)).event.tips.some((x) => x.id === resta))
  await db.query('delete from tip where id = any($1::uuid[])', [[altrui, resta]])
}

async function cancellare(m: Mondo, t: { evento: string }) {
  console.log('\n  -- delete_tip e le cascate')
  await id(REPORT, [m.quarto, 'tip', t.evento, 'spam', null])
  const voti = await num('select count(*) from tip_vote where tip_id = $1', [t.evento])
  check('un altro utente: tip_not_yours', await esito(DELETE, [m.altro, t.evento]) === '42501 tip_not_yours')
  check('una tip che non c\'e\': tip_not_yours', await esito(DELETE, [m.autore, NESSUNO]) === '42501 tip_not_yours')
  check('l\'autore cancella: torna l\'evento', voti > 0 && (await one<{ event_id: string }>(DELETE, [m.autore, t.evento])).event_id === m.ev)
  check('i voti se ne vanno con la tip', await num('select count(*) from tip_vote where tip_id = $1', [t.evento]) === 0)
  check('e le segnalazioni (report_target_gone)', await num(`select count(*) from report where target_kind = 'tip' and target_id = $1`, [t.evento]) === 0)
  check('il registro delle scritture resta: ripubblicarla conta ancora',
    await num(`select count(*) from clear_write_log where user_id = $1 and kind = 'tip'`, [m.autore]) === 5)

  // un tier senza clear: cancellarlo porta via le sue tip (FK composita)
  const libero = await one<{ id: string; ev: string }>(
    `select st.id::text, st.event_id::text as ev from stage_tier st
      where not exists (select 1 from clear c where c.stage_tier_id = st.id) order by st.id desc limit 1`)
  const sulTier = await id(POST, [m.quarto, libero.ev, libero.id, corpo('tier che se ne va'), null])
  const c = await db.connect()
  try {
    await c.query('begin')
    await c.query('delete from stage_tier where id = $1', [libero.id])
    const n = Number((await c.query('select count(*) from tip where id = $1', [sulTier])).rows[0].count)
    check('cancellare il tier cancella le sue tip', n === 0)
  } finally {
    await c.query('rollback')
    c.release()
  }
  await db.query('delete from tip where id = $1', [sulTier])
}

async function letture(m: Mondo) {
  console.log('\n  -- lib/tips.ts: listTips e viewerTipState')
  const ev = m.altroEv, tier = m.altroTier
  const t1 = await id(POST, [m.autore, ev, tier, corpo('ordine 1'), null])
  const t2 = await id(POST, [m.altro, ev, tier, corpo('ordine 2'), 'https://youtu.be/ordine'])
  const t3 = await id(POST, [m.terzo, ev, tier, corpo('ordine 3'), null])
  const e1 = await id(POST, [m.quarto, ev, null, corpo('ordine evento'), null])
  // date distinte al millisecondo: una Date di JS non vede i microsecondi
  await db.query(`update tip set created_at = now() - make_interval(mins => x.n)
    from (values ($1::uuid, 30), ($2::uuid, 20), ($3::uuid, 10)) as x(id, n) where tip.id = x.id`, [t1, t2, t3])
  for (const u of [m.autore, m.terzo, m.quarto]) await voto(u, t2, 1)
  await voto(m.quarto, t1, 1)

  const tutte = await listTips(ev, tier)
  check('Top: punteggio, poi le piu\' nuove', tutte.stage.tips.map((x) => x.id).join() === [t2, t1, t3].join(),
    tutte.stage.tips.map((x) => x.score).join())
  check('i totali per gruppo', tutte.stage.total === 3 && tutte.event.total === 1 && tutte.event.tips[0]?.id === e1)
  const r2 = tutte.stage.tips[0]
  check('la riga: handle, link, provider, date', r2.handle === 'tt_altro' && r2.linkUrl === 'https://youtu.be/ordine' &&
    r2.linkProvider === 'youtube' && r2.createdAt instanceof Date && r2.editedAt === null && r2.tierId === tier)
  check('ordina() della pagina da\' lo stesso Top e il New giusto',
    ordina(tutte.stage.tips, 'top').map((x) => x.id).join() === [t2, t1, t3].join() &&
    ordina(tutte.stage.tips, 'new').map((x) => x.id).join() === [t3, t2, t1].join())
  const una = await listTips(ev, tier, 1)
  check('con limite 1: la prima in Top piu\' la piu\' nuova, il totale resta 3',
    una.stage.tips.map((x) => x.id).sort().join() === [t2, t3].sort().join() && una.stage.total === 3)
  const soloEvento = await listTips(ev, null)
  check('senza tier: solo quelle di tutto l\'evento', soloEvento.stage.tips.length === 0 && soloEvento.event.tips.length === 1)
  check('le tip di un altro evento non ci sono', !(await listTips(m.ev, m.tier)).stage.tips.some((x) => [t1, t2, t3, e1].includes(x.id)))
  if (m.tier2) {
    const altroTier = await listTips(m.ev, m.tier2)
    check('un altro tier dello stesso evento non mostra le tip del primo',
      altroTier.stage.total === 0 && altroTier.event.total === (await listTips(m.ev, m.tier)).event.total)
  }

  const a = await viewerTipState(m.autore, tier)
  check('lo stato di chi guarda: le sue, i suoi voti, i punteggi vivi (tier ed evento)',
    a.ownTips.join() === t1 && a.tipVotes.join() === t2 && a.tipScores[t2] === 3 && a.tipScores[e1] === 0 &&
    Object.keys(a.tipScores).length === 4, JSON.stringify(a))
  const q4 = await viewerTipState(m.quarto, tier)
  check('un altro utente: la sua tip di evento, due voti', q4.ownTips.join() === e1 && [...q4.tipVotes].sort().join() === [t1, t2].sort().join())
  check('tipEvent dal database', await tipEvent(t1) === ev && await tipEvent(NESSUNO) === null)

  // l'account se ne va: tip e voti con lui, i punteggi ricalcolati
  await db.query('delete from app_user where id = $1', [m.quarto])
  check('cancellare l\'utente toglie le sue tip e i suoi voti',
    await num('select count(*) from tip where id = $1', [e1]) === 0 &&
    await num('select score from tip where id = $1', [t1]) === 0 && await num('select score from tip where id = $1', [t2]) === 2)
}

async function main() {
  await q(`delete from app_user where email like $1`, [`${P}+%@example.invalid`])
  const m = await mondo()
  try {
    frasi()
    puri()
    parser()
    const t = await scrivere(m)
    await modificare(m, t)
    await votare(m, t)
    await segnalare(m, t)
    await moderare(m, t)
    await sospensione(m)
    await cancellare(m, t)
    await letture(m)
  } finally {
    // con gli utenti se ne vanno tip, voti, segnalazioni e registro delle scritture
    await q(`delete from app_user where email like $1`, [`${P}+%@example.invalid`])
    await db.end()
  }
  console.log(stato.fails ? `\n  ${stato.passes} verdi, ${stato.fails} rosse\n` : `\n  ${stato.passes} verifiche, TUTTO VERDE\n`)
  process.exit(stato.fails ? 1 : 0)
}

await main()
