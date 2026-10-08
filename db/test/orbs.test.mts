// Verifica le Skill Orb esclusive (migrazione 0021): la lettura delle
// regole del gioco (equipment-limits.mjs), le regole importate sulle
// nostre carte, il rifiuto in invio e revisione di una sfera che la carta
// dello slot non puo' montare (per tipo e classe, categoria, lista di
// carte e nome), e la ricerca del builder che mostra solo quelle giuste.
//
// Gira sul database di test (npm run db:test), dopo load-equipment. Crea
// solo utenti orbtest+...@example.invalid, che toglie alla fine.
import { db } from '@/lib/db'
import { decodeElementBits, ourCard } from '../import/equipment-limits.mjs'
import {
  DOMINIO, REVISE, SUBMIT, check, copia, dati, esito, guardia, num, one, payload, q, stato, utente, type Payload,
} from '@/db/test/builder-helpers'
import ricerca from '@/db/test/orbs-search'

guardia()
const P = 'orbtest'

function pure() {
  console.log('\n  -- le regole del gioco lette in JS')
  const coppie = (b: number) => (decodeElementBits(b) ?? []).map(([t, c]: string[]) => `${c} ${t}`).sort().join()
  check('bit 0: AGL, tutte e due le classi', coppie(1) === 'Extreme AGL,Super AGL', coppie(1))
  check('4096: solo Super AGL', coppie(4096) === 'Super AGL')
  check('131072: solo Extreme AGL', coppie(131072) === 'Extreme AGL')
  check('31: tutti i tipi e le classi', decodeElementBits(31)?.length === 10)
  check('126976: la classe Super intera', coppie(126976) === 'Super AGL,Super INT,Super PHY,Super STR,Super TEQ')
  check('AGL e Super AGL insieme senza doppioni', decodeElementBits(1 | 4096)?.length === 2)
  check('un bit sconosciuto non si legge', decodeElementBits(32) === null && decodeElementBits(1 << 22) === null &&
    decodeElementBits(0) === null)
  const nostre = new Set([1019160, 1019170])
  check('ourCard: la forma Z-awakened torna alla base', ourCard(1019161, nostre) === 1019160 &&
    ourCard(1019170, nostre) === 1019170 && ourCard(1019171, nostre) === 1019170)
  check('ourCard: una carta che non abbiamo e\' null', ourCard(1019181, nostre) === null && ourCard(1019162, nostre) === null)
}

type Caso = { orb: number; si: number; no: number; nome: string; effetto: string }

/** Una sfera della regola data, una carta che la monta e una che no. */
async function caso(kind: string, extra = ''): Promise<Caso | null> {
  const r = await one<{ orb: string; si: string; no: string; nome: string; effetto: string | null }>(
    `select l.equipment_id::text as orb, et.name as nome, et.effect as effetto,
            (select min(c.id) from card c where equipment_fits(l.equipment_id, c.id))::text as si,
            (select min(c.id) from card c where not equipment_fits(l.equipment_id, c.id))::text as no
     from equipment_limit l join equipment_text et on et.equipment_id = l.equipment_id and et.locale = 'en'
     where l.kind = $1 ${extra}
       and exists (select 1 from card c where equipment_fits(l.equipment_id, c.id))
     order by l.equipment_id limit 1`, [kind])
  return r && r.si && r.no
    ? { orb: Number(r.orb), si: Number(r.si), no: Number(r.no), nome: r.nome, effetto: r.effetto ?? '' } : null
}

async function importate() {
  console.log('\n  -- le regole importate')
  check('una regola per ogni sfera del gioco', await num('select count(*) from equipment_limit') > 8000 &&
    await num(`select count(*) from equipment e where e.id < 9000
               and not exists (select 1 from equipment_limit l where l.equipment_id = e.id)`) === 0)
  check('tutti e quattro i tipi di regola', await num('select count(distinct kind) from equipment_limit') === 4)
  check('le regole per tipo sono solo nella loro tabella', await num(
    `select count(*) from equipment_limit l where l.kind = 'type' and (
       exists (select 1 from equipment_limit_card x where x.equipment_id = l.equipment_id)
       or exists (select 1 from equipment_limit_category x where x.equipment_id = l.equipment_id))`) === 0)
  check('"Skill Orb (Super AGL)" ammette solo Super AGL', await num(
    `select count(*) from equipment_text et join equipment_limit_type t on t.equipment_id = et.equipment_id
     where et.locale = 'en' and et.name like 'Skill Orb (Super AGL)%' and (t.type, t.class) <> ('AGL', 'Super')`) === 0 &&
    await num(`select count(*) from equipment_text where locale = 'en' and name like 'Skill Orb (Super AGL)%'`) > 0)
  // Le esclusive per carta nominano l'epiteto della forma finale:
  // [Uncouth Mercenary] Borgos. Quasi sempre fra le carte ammesse ce n'e'
  // una con quell'epiteto; le poche altre hanno la forma finale non ancora
  // nostra (abbiamo solo quelle prima del Dokkan Awakening).
  const nominate = await one<{ n: string; ok: string }>(
    `select count(*) as n, count(*) filter (where exists (
       select 1 from equipment_limit_card x join card_text ct on ct.card_id = x.card_id and ct.locale = 'en'
       where x.equipment_id = l.equipment_id and strpos(et.effect, '[' || ct.epithet || ']') > 0)) as ok
     from equipment_limit l join equipment_text et on et.equipment_id = l.equipment_id and et.locale = 'en'
     where l.kind = 'card' and et.effect like '%equipped to [%'
       and exists (select 1 from equipment_limit_card x where x.equipment_id = l.equipment_id)`)
  check('le carte di un\'esclusiva sono quelle che la descrizione nomina',
    Number(nominate.n) > 1000 && Number(nominate.ok) >= Number(nominate.n) * 0.95, `${nominate.ok} su ${nominate.n}`)
  check('la Z-awakened del gioco diventa la nostra base: 1019161 -> 1019160', await num(
    `select count(*) from equipment_limit_card x join equipment_text et on et.equipment_id = x.equipment_id
     where et.effect like '%[Uncouth Mercenary] Borgos%' and x.card_id = 1019160`) > 0)
  const libera = await one<{ id: string }>(
    `select e.id::text from equipment e where not exists (select 1 from equipment_limit l where l.equipment_id = e.id) limit 1`)
  if (libera) {
    check('una sfera senza regola si monta su tutte', await num(
      'select count(*) from card c where not equipment_fits($1, c.id)', [libera.id]) === 0)
  }
}

/** Il payload base con la sfera sulla carta data, nello slot 1.1 (o nel cambio, sul friend). */
function con(base: Payload, card: number, orb: number, cambio = false): string {
  const p = copia(base)
  const s = cambio ? p.lineups[1].slots[6] : p.lineups[0].slots[0]
  s.card_id = card
  s.build = { note: 'Exclusive orb test.', equipment: [null, orb] }
  return JSON.stringify(p)
}

async function builder() {
  const d = await dati()
  const autore = await utente(P, 'orb_author')
  const base = payload(d.cards)
  const casi: [string, Caso | null][] = [
    ['tipo e classe', await caso('type', `and (select count(*) from equipment_limit_type t
       where t.equipment_id = l.equipment_id) = 1`)],
    ['categoria', await caso('category')],
    ['lista di carte', await caso('card')],
    ['nome', await caso('name')],
  ]
  for (const [nome, c] of casi) {
    console.log(`\n  -- esclusiva per ${nome}`)
    if (!check(`c'e' una sfera per ${nome} con una carta che la monta e una che no`, !!c) || !c) continue
    console.log(`     sfera ${c.orb} (${c.nome}): si' ${c.si}, no ${c.no}`)
    check('accettata sulla carta giusta', await esito(SUBMIT, [autore, d.run, d.tier, con(base, c.si, c.orb)]) === 'ok')
    check('rifiutata su un\'altra', await esito(SUBMIT, [autore, d.run, d.tier, con(base, c.no, c.orb)]) ===
      '23514 builder_build_equipment_card')
    check('rifiutata anche nel cambio, sul friend', await esito(SUBMIT,
      [autore, d.run, d.tier, con(base, c.no, c.orb, true)]) === '23514 builder_build_equipment_card')
  }

  const tipo = casi[0][1]
  if (tipo) {
    console.log('\n  -- la classe conta')
    const altra = await one<{ id: string }>(
      `select min(c.id)::text as id from card c join equipment_limit_type t on t.type = c.type and t.class <> c.class
       where t.equipment_id = $1`, [tipo.orb])
    check('stesso tipo, altra classe: rifiutata', !!altra?.id && await esito(SUBMIT,
      [autore, d.run, d.tier, con(base, Number(altra.id), tipo.orb)]) === '23514 builder_build_equipment_card')

    console.log('\n  -- la revisione')
    const clear = (await one<{ id: string }>(SUBMIT, [autore, d.run, d.tier, con(base, tipo.si, tipo.orb)])).id
    check('una revisione con la sfera sulla carta sbagliata si rifiuta', await esito(REVISE,
      [autore, clear, 'Swapped the card', con(base, tipo.no, tipo.orb)]) === '23514 builder_build_equipment_card')
    check('e il clear resta alla versione 1', await num(
      'select count(*) from clear_version where clear_id = $1', [clear]) === 1)
    check('una revisione con la carta giusta passa', await esito(REVISE,
      [autore, clear, 'Kept the card', con(base, tipo.si, tipo.orb)]) === 'ok')
    check('una sfera inesistente resta builder_build_equipment', await esito(SUBMIT,
      [autore, d.run, d.tier, con(base, tipo.no, 999999999)]) === '23514 builder_build_equipment')
  }
  return casi.map(([, c]) => c).filter((c): c is Caso => !!c)
}

try {
  pure()
  await importate()
  const casi = await builder()
  await ricerca(casi)
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  // l'unico utente della suite, per email esatta
  const email = `${P}+orb_author${DOMINIO}`
  await db.query('delete from app_user where email = $1', [email])
  check('pulizia: nessun utente di prova rimasto', (await q('select 1 from app_user where email = $1', [email])).length === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
