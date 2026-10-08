// Verifica gli ingressi SQL del builder dei clear (migrazione 0016):
// submit_clear_from_builder, revise_clear_from_builder, gli assetti
// congelati, il limite per ora, i voti e i commenti sulla versione
// corrente, e chi puo' fare cosa.
//
// Gira sul database di test (npm run db:test). Ogni utente che crea ha
// un'email submittest+...@example.invalid e se ne va alla fine (con lui, in
// cascata, team, clear, voti, commenti e registro), anche se qualcosa
// fallisce.
import { db } from '@/lib/db'
import {
  SUBMIT, check, copia, dati, esito, guardia, num, one, payload, q, stato, utente, type Ctx,
} from '@/db/test/builder-helpers'
import rifiuti from '@/db/test/submit-rejects'
import revisioni from '@/db/test/submit-revise'
import voti from '@/db/test/submit-votes'

guardia()
const P = 'submittest'
let ctx: Ctx | null = null

try {
  const d = await dati()
  check('dati di partenza: ricorrenze e otto carte', !!d.run && !!d.futura && !!d.altraRun && d.cards.length === 8,
    JSON.stringify(d))
  const autore = await utente(P, 'sub_author')
  const altro = await utente(P, 'sub_other')
  const nuovo = await utente(P, 'sub_new', false)
  const base = payload(d.cards)

  // ------------------------------------------------------------ invio valido
  console.log('\n  -- invio valido')
  const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, JSON.stringify(base)])).id
  check('submit_clear_from_builder torna l\'id del clear', /^[0-9a-f-]{36}$/.test(clear), clear)
  const v1 = (await one<{ id: string }>(
    'select id::text from clear_version where clear_id = $1 and is_current', [clear])).id
  const testa = await one<Record<string, unknown>>(
    `select c.run_id::text as run, c.stage_tier_id::text as tier, v.seq, v.no_items, v.deathless,
            v.turns, v.note, v.lang, v.lineup_snapshot->>'lineup_seq' as snap_seq,
            (select count(*)::int from team t where t.id = c.team_id and t.owner_id = c.author_id) as team
     from clear c join clear_version v on v.clear_id = c.id where c.id = $1`, [clear])
  check('intestazione e versione 1 come il payload',
    testa.run === d.run && testa.tier === d.tier && testa.seq === 1 && testa.no_items === true &&
    testa.deathless === false && testa.turns === 12 && testa.lang === 'en' && testa.team === 1,
    JSON.stringify(testa))
  check('lo snapshot e clear_card sono l\'assetto di partenza',
    testa.snap_seq === '1' && await num('select count(*) from clear_card where version_id = $1', [v1]) === 7)
  check('clear_card ha il leader e il friend del #1', await num(
    `select count(*) from clear_card where version_id = $1 and
       ((role = 'leader' and card_id = $2) or (role = 'friend' and card_id = $3))`,
    [v1, d.cards[0], d.cards[6]]) === 2)
  const lin = await q<{ seq: number; label: string | null; note: string | null; n: number }>(
    `select l.seq, l.label, l.note,
            (select count(*)::int from clear_lineup_card k where k.version_id = l.version_id and k.seq = l.seq) as n
     from clear_lineup l where l.version_id = $1 order by l.seq`, [v1])
  check('due assetti congelati, sette carte ciascuno', lin.length === 2 && lin.every((l) => l.n === 7),
    JSON.stringify(lin))
  check('il cambio ha nome e nota', lin[1]?.label === 'Phase 2' && lin[1]?.note === 'Swap the support in.')
  check('il cambio ha la carta nuova in 1.2', await num(
    'select count(*) from clear_lineup_card where version_id = $1 and seq = 2 and rotation_index = 1 and pos = 2 and card_id = $2',
    [v1, d.cards[7]]) === 1)
  check('la prova c\'e\' con il provider', (await one<{ p: string }>(
    'select provider as p from clear_proof where version_id = $1', [v1]))?.p === 'youtube')

  const stesso = copia(base)
  stesso.lineups = [{ label: null, slots: base.lineups[0].slots.map((s, i) =>
    i === 6 ? { ...s, card_id: d.cards[0] } : s) }]
  check('leader e friend possono essere la stessa carta',
    await esito(SUBMIT, [autore, d.run, d.tier, JSON.stringify(stesso)]) === 'ok')
  const minimo = { lineups: [{ slots: base.lineups[0].slots }] }
  check('un payload minimo (niente flag, turni, nota, prove) passa',
    await esito(SUBMIT, [autore, d.run, d.tier, JSON.stringify(minimo)]) === 'ok')
  check('il payload minimo prende i default (turni null, flag falsi, nessuna prova)', await num(
    `select count(*) from clear c join clear_version v on v.clear_id = c.id
     where c.author_id = $1 and v.turns is null and not v.no_items and not v.deathless
       and v.note is null and not exists (select 1 from clear_proof p where p.version_id = v.id)`, [autore]) === 1)

  ctx = { d, autore, altro, nuovo, clear, v1, base, prefisso: P }
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

// Le altre parti stanno in moduli a se', per restare leggibili. L'ordine
// conta: le revisioni e i voti usano il clear inviato qui.
for (const [nome, parte] of [['rifiuti', rifiuti], ['revisioni', revisioni], ['voti', voti]] as const) {
  if (!ctx) break
  try { await parte(ctx) }
  catch (e) { check(`nessuna eccezione inattesa (${nome})`, false, e instanceof Error ? e.stack ?? e.message : String(e)) }
}

try {
  await db.query(`delete from app_user where email like '${P}+%@example.invalid'`)
  check('pulizia: nessun utente di prova rimasto', await num(
    `select count(*) from app_user where email like '${P}+%@example.invalid'`) === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
