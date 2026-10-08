// Parte di submit.test.mts: ogni payload sbagliato e' rifiutato con il suo
// nome (CONSTRAINT builder_*), e un rifiuto non lascia niente dietro.
import {
  SUBMIT, check, copia, esito, num, slots, type Ctx, type Payload,
} from '@/db/test/builder-helpers'

type Caso = [nome: string, atteso: string, payload: unknown]

export default async function rifiuti(ctx: Ctx) {
  const { d, autore, base } = ctx
  console.log('\n  -- payload rifiutati, ognuno per il suo motivo')
  const con = (f: (p: Payload) => void): Payload => { const p = copia(base); f(p); return p }
  const slot0 = (f: (s: Payload['lineups'][0]['slots']) => void) => con((p) => f(p.lineups[0].slots))
  const forma = '23514 builder_shape'
  const ruolo = '23514 builder_role'

  const casi: Caso[] = [
    ['payload non oggetto', '23514 builder_payload', [1, 2]],
    ['senza assetti', '23514 builder_lineup_count', { turns: 3 }],
    ['zero assetti', '23514 builder_lineup_count', con((p) => { p.lineups = [] })],
    ['cinque assetti', '23514 builder_lineup_count', con((p) => {
      p.lineups = [0, 1, 2, 3, 4].map((i) => ({ label: `Step ${i}`, slots: slots(d.cards) })) })],
    ['assetto non oggetto', '23514 builder_payload', con((p) => { (p.lineups as unknown[])[1] = 'x' })],
    ['sei unita\'', forma, slot0((s) => { s.pop() })],
    ['otto unita\'', forma, slot0((s) => { s.push({ ...s[1] }) })],
    ['rotazione 4', forma, slot0((s) => { s[1].rot = 4 })],
    ['rotazione 1 posizione 3', forma, slot0((s) => { s[1].pos = 3 })],
    ['posizione 0', forma, slot0((s) => { s[1].pos = 0 })],
    ['posizione ripetuta', forma, slot0((s) => { s[1].pos = 1 })],
    ['rotazione come testo', forma, slot0((s) => { (s[1] as { rot: unknown }).rot = '1' })],
    ['nessun leader', ruolo, slot0((s) => { s[0].role = 'member' })],
    ['nessun friend', ruolo, slot0((s) => { s[6].role = 'member' })],
    ['due leader', ruolo, slot0((s) => { s[1].role = 'leader' })],
    ['due friend', ruolo, slot0((s) => { s[1].role = 'friend' })],
    ['ruolo sconosciuto', ruolo, slot0((s) => { s[1].role = 'captain' })],
    ['ruolo mancante nel cambio', ruolo, con((p) => { p.lineups[1].slots[0].role = 'member' })],
    ['carta inesistente', '23514 builder_card', slot0((s) => { s[2].card_id = 999999999 })],
    ['carta come testo', '23514 builder_card', slot0((s) => { s[2].card_id = String(d.cards[2]) })],
    ['carta decimale', '23514 builder_card', slot0((s) => { s[2].card_id = 1.5 })],
    ['cambio senza nome', '23514 builder_lineup_label', con((p) => { p.lineups[1].label = '  ' })],
    ['nome del cambio di 41 caratteri', '23514 builder_lineup_label', con((p) => { p.lineups[1].label = 'x'.repeat(41) })],
    ['nome del cambio non testo', '23514 builder_lineup_label', con((p) => { p.lineups[1].label = 7 })],
    ['nota dell\'assetto di 501 caratteri', '23514 builder_lineup_note', con((p) => { p.lineups[0].note = 'x'.repeat(501) })],
    ['turni 0', '23514 builder_turns', { ...base, turns: 0 }],
    ['turni 100', '23514 builder_turns', { ...base, turns: 100 }],
    ['turni 1.5', '23514 builder_turns', { ...base, turns: 1.5 }],
    ['turni come testo', '23514 builder_turns', { ...base, turns: '3' }],
    ['nota di 2001 caratteri', '23514 builder_note', { ...base, note: 'x'.repeat(2001) }],
    ['nota non testo', '23514 builder_note', { ...base, note: { a: 1 } }],
    ['lingua sconosciuta', '23514 builder_lang', { ...base, lang: 'xx' }],
    ['no_items come testo', '23514 builder_flags', { ...base, no_items: 'yes' }],
    ['deathless come numero', '23514 builder_flags', { ...base, deathless: 1 }],
    ['quattro prove', '23514 builder_proof_count', { ...base, proofs: [1, 2, 3, 4].map((i) =>
      ({ kind: 'video', url: `https://youtu.be/v${i}` })) }],
    ['prove non lista', '23514 builder_proof_count', { ...base, proofs: { kind: 'video' } }],
    ['tipo di prova sconosciuto', '23514 builder_proof_kind', { ...base, proofs: [{ kind: 'gif', url: 'https://i.imgur.com/a.gif' }] }],
    ['prova in http', '23514 builder_proof_url', { ...base, proofs: [{ kind: 'video', url: 'http://youtu.be/x' }] }],
    ['prova senza schema', '23514 builder_proof_url', { ...base, proofs: [{ kind: 'video', url: 'youtu.be/x' }] }],
    ['prova con spazi', '23514 builder_proof_url', { ...base, proofs: [{ kind: 'video', url: 'https://youtu.be/a b' }] }],
    ['prova di 501 caratteri', '23514 builder_proof_url', { ...base, proofs: [{ kind: 'video', url: `https://youtu.be/${'x'.repeat(490)}` }] }],
    ['la stessa prova due volte', '23514 builder_proof_url', { ...base, proofs: [base.proofs, base.proofs].flat() }],
    ['accorciatore', '23514 builder_proof_host', { ...base, proofs: [{ kind: 'video', url: 'https://bit.ly/abc' }] }],
    ['accorciatore con www', '23514 builder_proof_host', { ...base, proofs: [{ kind: 'screenshot', url: 'https://www.tinyurl.com/abc' }] }],
  ]
  const team0 = await num('select count(*) from team where owner_id = $1', [autore])
  const clear0 = await num('select count(*) from clear where author_id = $1', [autore])
  for (const [nome, atteso, p] of casi) {
    const r = await esito(SUBMIT, [autore, d.run, d.tier, JSON.stringify(p)])
    check(`rifiuta: ${nome}`, r === atteso, r)
  }

  console.log('\n  -- ricorrenza, difficolta\' e autore')
  const ok = JSON.stringify(base)
  let r = await esito(SUBMIT, [autore, d.altraRun, d.tier, ok])
  check('rifiuta una ricorrenza di un altro evento', r === '23514 builder_run', r)
  r = await esito(SUBMIT, [autore, d.futura, d.tier, ok])
  check('rifiuta una ricorrenza non ancora iniziata', r === '23514 builder_run_not_started', r)
  r = await esito(SUBMIT, [autore, '999999999', d.tier, ok])
  check('rifiuta una ricorrenza inesistente', r === '23514 builder_run', r)
  r = await esito(SUBMIT, [autore, d.run, '999999999', ok])
  check('rifiuta una difficolta\' inesistente', r === '23514 builder_tier', r)
  r = await esito(SUBMIT, [ctx.nuovo, d.run, d.tier, ok])
  check('rifiuta un utente che non ha finito /welcome', r === '42501 builder_author', r)
  r = await esito(SUBMIT, ['00000000-0000-4000-8000-000000000000', d.run, d.tier, ok])
  check('rifiuta un utente inesistente', r === '42501 builder_author', r)

  check('i rifiuti non lasciano team ne\' clear a meta\'',
    await num('select count(*) from team where owner_id = $1', [autore]) === team0 &&
    await num('select count(*) from clear where author_id = $1', [autore]) === clear0)
  check('e non contano nel limite per ora', await num(
    "select count(*) from clear_write_log where user_id = $1 and kind = 'submit'", [autore]) === clear0)
}
