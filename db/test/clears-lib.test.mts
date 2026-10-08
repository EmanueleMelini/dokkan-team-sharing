// Verifica la parte TypeScript del builder dei clear: i validatori puri
// delle Server Action (lib/clears/validate.ts), la traduzione degli errori
// (lib/clears/errors.ts), le letture (lib/clears.ts, lib/cards.ts,
// listClears) e la rotta pubblica del picker (app/api/cards/route.ts).
//
// Gira sul database di test (npm run db:test) e crea solo utenti
// clearslib+...@example.invalid, che toglie alla fine.
import { readFileSync } from 'node:fs'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { friendlyClearError } from '@/lib/clears/errors'
import {
  parseBigintId, parseBuilderPayload, parseChangeNote, parseComment, parsePayloadField, parseUuid, parseVote,
} from '@/lib/clears/validate'
import {
  getClearForEdit, getClearVersions, getComments, getVersionCounts, getVersionLineups, getViewerVotes,
  listStartedRuns,
} from '@/lib/clears'
import { searchCards } from '@/lib/cards'
import { listClears } from '@/lib/queries'
import { GET } from '@/app/api/cards/route'
import { SUBMIT, REVISE, check, dati, guardia, num, one, payload, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'clearslib'

function validatori(cards: number[]) {
  console.log('\n  -- validatori delle Server Action (funzioni pure)')
  const base = payload(cards)
  const ok = parseBuilderPayload(base)
  check('un payload valido passa', ok.ok, ok.ok ? '' : ok.error)
  if (ok.ok) check('e torna normalizzato', ok.value.lineups.length === 2 && ok.value.lineups[0].label === null &&
    ok.value.turns === 12 && ok.value.proofs.length === 1)
  const sbagliati: [string, unknown][] = [
    ['non oggetto', 'x'],
    ['cinque assetti', { ...base, lineups: [1, 2, 3, 4, 5].map(() => base.lineups[0]) }],
    ['sei unita\'', { ...base, lineups: [{ slots: base.lineups[0].slots.slice(0, 6) }] }],
    ['posizione 1.3', { ...base, lineups: [{ slots: base.lineups[0].slots.map((s, i) => i === 1 ? { ...s, pos: 3 } : s) }] }],
    ['due leader', { ...base, lineups: [{ slots: base.lineups[0].slots.map((s, i) => i === 1 ? { ...s, role: 'leader' } : s) }] }],
    ['carta come testo', { ...base, lineups: [{ slots: base.lineups[0].slots.map((s, i) => i === 1 ? { ...s, card_id: '12' } : s) }] }],
    ['cambio senza nome', { ...base, lineups: [base.lineups[0], { ...base.lineups[1], label: '' }] }],
    ['turni 100', { ...base, turns: 100 }],
    ['turni 2.5', { ...base, turns: 2.5 }],
    ['nota troppo lunga', { ...base, note: 'x'.repeat(2001) }],
    ['lingua sconosciuta', { ...base, lang: 'it' }],
    ['flag come testo', { ...base, deathless: 'true' }],
    ['prova http', { ...base, proofs: [{ kind: 'video', url: 'http://youtu.be/x' }] }],
    ['accorciatore', { ...base, proofs: [{ kind: 'video', url: 'https://bit.ly/x' }] }],
    ['quattro prove', { ...base, proofs: [1, 2, 3, 4].map((i) => ({ kind: 'video', url: `https://youtu.be/${i}` })) }],
    ['prova doppia', { ...base, proofs: [base.proofs[0], base.proofs[0]] }],
  ]
  for (const [nome, p] of sbagliati) {
    const r = parseBuilderPayload(p)
    check(`il validatore rifiuta: ${nome}`, !r.ok && r.error.length > 0 && !/—/.test(r.error), r.ok ? 'accettato' : r.error)
  }
  check('i turni dal form come testo', (() => { const r = parseBuilderPayload({ ...base, turns: '7' }); return r.ok && r.value.turns === 7 })())
  check('i turni vuoti sono null', (() => { const r = parseBuilderPayload({ ...base, turns: '' }); return r.ok && r.value.turns === null })())
  check('il campo payload: JSON rotto o assente', !parsePayloadField('{').ok && !parsePayloadField(null).ok &&
    parsePayloadField(JSON.stringify(base)).ok)
  check('parseUuid', parseUuid('3B49014B-0000-4000-8000-000000000001') === '3b49014b-0000-4000-8000-000000000001' &&
    parseUuid('x') === null && parseUuid(null) === null)
  check('parseBigintId', parseBigintId('728100') === '728100' && parseBigintId('0') === null &&
    parseBigintId('1;drop') === null && parseBigintId(undefined) === null)
  check('parseVote', parseVote('1') === 1 && parseVote('-1') === -1 && parseVote('0') === 0 &&
    parseVote('') === null && parseVote('2') === null)
  check('parseComment', parseComment('  hi ').ok && !parseComment('   ').ok && !parseComment('x'.repeat(1001)).ok)
  check('parseChangeNote', parseChangeNote('Fixed a slot').ok && !parseChangeNote('').ok && !parseChangeNote('x'.repeat(301)).ok)

  console.log('\n  -- ogni rifiuto del database ha la sua frase')
  // 0016 il builder, 0018 le build degli slot
  const sqlText = ['0016_clear_builder.sql', '0018_slot_builds.sql']
    .map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n')
  const nomi = [...new Set([...sqlText.matchAll(/'(builder_[a-z_]+)'/g)].map((m) => m[1]))]
    .filter((n) => n !== 'builder_fail')
  const senza = nomi.filter((n) => !friendlyClearError({ code: '23514', constraint: n }))
  check(`tutti i ${nomi.length} nomi builder_* della 0016 e della 0018 sono tradotti`,
    nomi.length > 25 && nomi.includes('builder_build_equipment') && senza.length === 0, senza.join(', '))
  check('nessuna frase con il trattino lungo', nomi.every((n) => !/—/.test(friendlyClearError({ constraint: n }) ?? '')))
  check('42501 senza nome e\' "non tuo"', /not yours/.test(friendlyClearError({ code: '42501' }) ?? ''))
  check('un errore sconosciuto non si traduce', friendlyClearError({ code: '23505', constraint: 'altro' }) === null)
}

async function letture() {
  const d = await dati()
  const autore = await utente(P, 'lib_author')
  const altro = await utente(P, 'lib_viewer')
  const base = payload(d.cards)
  const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(base)])).id

  console.log('\n  -- getClearForEdit')
  const e = await getClearForEdit(clear, autore)
  check('l\'autore lo trova', !!e && e.run_id === d.run && e.tier_id === d.tier && e.version_seq === 1)
  check('per un altro non esiste', (await getClearForEdit(clear, altro)) === null)
  const rilegge = e ? parseBuilderPayload(e.payload) : null
  check('il payload riletto passa il validatore', !!rilegge?.ok, rilegge && !rilegge.ok ? rilegge.error : '')
  check('ed e\' lo stesso inviato', !!rilegge?.ok &&
    JSON.stringify(rilegge.value) === JSON.stringify((parseBuilderPayload(base) as { value: unknown }).value))
  check('con nomi e miniature per il builder', !!e && e.lineups.length === 2 && e.lineups[0].cards.length === 7 &&
    e.lineups[0].cards.every((k) => 'thumb_key' in k && 'epithet' in k))
  const v2 = (await one<{ id: string }>(REVISE, [autore, clear, 'Same team, new run.', JSON.stringify(e!.payload)])).id
  check('e si rimanda tale e quale come revisione', !!v2)

  const legacy = await one<{ id: string; author_id: string; version_id: string }>(
    `select c.id::text, c.author_id::text, c.version_id::text from clear_current c
     where not exists (select 1 from clear_lineup l where l.version_id = c.version_id) limit 1`)
  if (legacy) {
    const le = await getClearForEdit(legacy.id, legacy.author_id)
    check('un clear di prima del 0016 si modifica dall\'assetto di partenza',
      !!le && le.lineups.length === 1 && le.payload.lineups[0].slots.length === 7 &&
      parseBuilderPayload(le.payload).ok)
  }

  console.log('\n  -- le letture delle pagine')
  const v1 = (await one<{ id: string }>('select id::text from clear_version where clear_id = $1 and seq = 1', [clear])).id
  const cambi = (await getVersionLineups([v1, v2], 2))
    .map((l) => `${l.version_id === v1 ? 'v1' : 'v2'}:${l.seq}:${l.label}:${l.cards.length}`).sort().join()
  check('getVersionLineups dal #2: solo i cambi, di ogni versione', cambi === 'v1:2:Phase 2:7,v2:2:Phase 2:7', cambi)
  await db.query('select vote_clear_version($1, $2, 1::smallint)', [altro, v2])
  await db.query("select comment_clear_version($1, $2, 'Thanks for the notes.')", [altro, v2])
  await db.query("select comment_clear_version($1, $2, 'You are welcome.')", [autore, v2])
  const votes = await getViewerVotes(altro, [v1, v2])
  check('getViewerVotes: il voto di chi guarda', votes.get(v2) === 1 && !votes.has(v1))
  check('getViewerVotes senza utente', (await getViewerVotes(null, [v2])).size === 0)
  const com = await getComments(v2)
  check('getComments: in ordine, con handle e autore segnato', com.length === 2 && com[0].handle === 'lib_viewer' &&
    !com[0].by_author && com[1].by_author)
  const cnt = (await getVersionCounts([v2])).get(v2)
  check('getVersionCounts', cnt?.votes === 1 && cnt.comments === 2 && cnt.changes === 1, JSON.stringify(cnt))
  const storia = await getClearVersions(clear)
  check('getClearVersions: dalla piu\' recente', storia.length === 2 && storia[0].is_current && storia[0].seq === 2)
  const runs = await listStartedRuns((await one<{ e: string }>('select event_id::text as e from event_run where id = $1', [d.run])).e, 'global')
  check('listStartedRuns: la run c\'e\', la futura no', runs.some((r) => r.id === d.run) && !runs.some((r) => r.id === d.futura))
  const righe = await listClears(d.tier, 'global', { limit: 100 })
  const riga = righe.find((r) => r.id === clear)
  check('listClears: i campi nuovi changes e comments', riga?.changes === 1 && riga.comments === 2 &&
    riga.version_id === v2, JSON.stringify(riga && { c: riga.changes, m: riga.comments }))
  check('listClears: le altre colonne ci sono ancora', !!riga && riga.cards.length === 7 && riga.handle === 'lib_author')
}

async function carte() {
  console.log('\n  -- searchCards e la rotta /api/cards')
  const goku = await searchCards({ q: 'goku', limit: 40 })
  check('cerca per nome', goku.length > 0 && goku.every((c) => /goku/i.test(`${c.name} ${c.epithet ?? ''}`)))
  check('limite 40 anche se ne chiedi di piu\'', (await searchCards({ limit: 500 })).length === 40)
  const agl = await searchCards({ type: 'AGL', rarity: 'LR', class: 'Super' })
  check('filtri tipo, rarita\', classe', agl.length > 0 && agl.every((c) => c.type === 'AGL' && c.rarity === 'LR' && c.class === 'Super'))
  const cat = await one<{ id: number }>('select category_id as id from card_category group by 1 order by count(*) desc limit 1')
  const perCat = await searchCards({ category: cat.id, limit: 5 })
  check('filtro categoria', perCat.length === 5 && await num(
    'select count(*) from card_category where category_id = $1 and card_id = any ($2::bigint[])',
    [cat.id, perCat.map((c) => c.id)]) === 5)
  const soloJp = await one<{ id: string }>(
    `select c.id::text from card c where exists (select 1 from card_release r where r.card_id = c.id and r.reg = 'japan')
       and not exists (select 1 from card_release r where r.card_id = c.id and r.reg = 'global') limit 1`)
  if (soloJp) {
    const nome = (await one<{ n: string }>("select name as n from card_text where card_id = $1 and locale = 'en'", [soloJp.id])).n
    check('solo carte uscite su Global', !(await searchCards({ q: nome })).some((c) => c.id === soloJp.id))
  }
  const senzaEpiteto = await one<{ id: string; name: string }>(
    `select ct.card_id::text as id, ct.name from card_text ct join card_release r on r.card_id = ct.card_id and r.reg = 'global'
     where ct.epithet is null and ct.locale = 'en' and r.released_at <= current_date limit 1`)
  if (senzaEpiteto) {
    const hit = (await searchCards({ q: senzaEpiteto.name, limit: 40 })).find((c) => c.id === senzaEpiteto.id)
      ?? (await searchCards({ q: senzaEpiteto.name, offset: 40, limit: 40 })).find((c) => c.id === senzaEpiteto.id)
    check('trova le carte senza epiteto (0015)', !!hit && hit.epithet === null)
  }
  check('i jolly di ilike sono letterali', (await searchCards({ q: '%' })).every((c) => `${c.name}${c.epithet}`.includes('%')))
  const linked = await searchCards({ q: 'goku', limit: 3, withLinks: true })
  check('le link skill a richiesta', linked.every((c) => Array.isArray(c.links)))

  const chiama = async (qs: string) => {
    const res = await GET({ nextUrl: new URL(`http://test.invalid/api/cards?${qs}`) } as NextRequest)
    return { status: res.status, cache: res.headers.get('cache-control') ?? '', body: await res.json() }
  }
  const r = await chiama('q=goku&type=AGL')
  check('la rotta risponde in JSON compatto', r.status === 200 && Array.isArray(r.body.cards) &&
    r.body.cards.every((c: Record<string, unknown>) =>
      Object.keys(c).sort().join() === 'class,epithet,id,name,rarity,thumb,type'), JSON.stringify(r.body.cards?.[0]))
  check('con la cache pubblica', /public/.test(r.cache) && /s-maxage/.test(r.cache), r.cache)
  const tutte = await chiama('')
  check('pagina da 40 con il prossimo offset', tutte.body.cards.length === 40 && tutte.body.next === 40)
  for (const qs of ['type=XXX', 'class=Mega', 'rarity=SSSR', 'category=abc', 'offset=-1', 'offset=99999', `q=${'x'.repeat(61)}`]) {
    const b = await chiama(qs)
    check(`400 per ${qs.slice(0, 20)}`, b.status === 400 && typeof b.body.error === 'string' && /no-store/.test(b.cache))
  }
}

try {
  validatori((await dati()).cards)
  await letture()
  await carte()
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
} finally {
  await db.query(`delete from app_user where email like '${P}+%@example.invalid'`)
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
