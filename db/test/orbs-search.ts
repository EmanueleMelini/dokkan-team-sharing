// La ricerca delle sfere filtrata per carta (0021): searchEquipment con
// card, il conteggio delle nascoste e /api/equipment?card=. Parte di
// orbs.test.mts, che le passa le esclusive trovate (sfera, una carta che
// la monta, una che no).
import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/equipment/route'
import { countHiddenEquipment, searchEquipment } from '@/lib/equipment'
import { check, num } from '@/db/test/builder-helpers'

type Caso = { orb: number; si: number; no: number; nome: string; effetto: string }

const chiama = async (qs: string) => {
  const res = await GET({ nextUrl: new URL(`http://test.invalid/api/equipment?${qs}`) } as NextRequest)
  return { status: res.status, body: await res.json() }
}

/** Tutte le pagine della ricerca, per vedere se una sfera c'e'. */
async function tutte(opts: { q: string; card?: number }): Promise<number[]> {
  const ids: number[] = []
  for (let offset = 0; offset <= 10_000; offset += 30) {
    const page = await searchEquipment({ ...opts, offset })
    ids.push(...page.map((h) => Number(h.id)))
    if (page.length < 30) break
  }
  return ids
}

export default async function ricerca(casi: Caso[]) {
  console.log('\n  -- la ricerca filtrata per carta')
  for (const c of casi) {
    // il nome e la parte della descrizione che dice a chi si monta
    // ("Universe 6", [Uncouth Mercenary]): poche pagine invece di cento
    const chi = c.effetto.match(/\[([^\]]+)\]|"([^"]+)"/)
    const parole = `${c.nome} ${chi?.[1] ?? chi?.[2] ?? ''}`.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2).slice(0, 6).join(' ')
    const conSi = await tutte({ q: parole, card: c.si })
    const conNo = await tutte({ q: parole, card: c.no })
    check(`${c.orb}: la trova per la carta che la monta`, conSi.includes(c.orb), parole)
    check(`${c.orb}: non la mostra a un'altra carta`, !conNo.includes(c.orb))
    const nascoste = await countHiddenEquipment({ q: parole, card: c.no })
    const senza = (await searchEquipment({ q: parole }))[0]?.total ?? 0
    const filtrate = (await searchEquipment({ q: parole, card: c.no }))[0]?.total ?? 0
    check(`${c.orb}: mostrate + nascoste = tutte`, nascoste > 0 && filtrate + nascoste === senza,
      `${filtrate} + ${nascoste} di ${senza}`)
  }

  const carta = casi[0]?.no
  if (carta) {
    const pagina = await searchEquipment({ card: carta })
    check('ogni sfera della pagina e\' montabile da quella carta', pagina.length > 0 && await num(
      'select count(*) from unnest($1::bigint[]) e where not equipment_fits(e, $2)', [pagina.map((h) => h.id), carta]) === 0)
    check('senza carta la ricerca resta quella di prima', ((await searchEquipment({}))[0]?.total ?? 0) ===
      await num(`select count(*) from equipment q join equipment_text et on et.equipment_id = q.id and et.locale = 'en'`))

    console.log('\n  -- /api/equipment?card=')
    const r = await chiama(`card=${carta}`)
    check('risponde con hidden', r.status === 200 && typeof r.body.hidden === 'number' && r.body.hidden > 0 &&
      r.body.total + r.body.hidden === await num(
        `select count(*) from equipment q join equipment_text et on et.equipment_id = q.id and et.locale = 'en'`),
      `${r.body.total} + ${r.body.hidden}`)
    check('senza card hidden e\' 0', (await chiama('')).body.hidden === 0)
    for (const qs of ['card=abc', 'card=-1', 'card=0', 'card=1234567890123', 'card=999999999']) {
      const b = await chiama(qs)
      check(`400 per ${qs}`, b.status === 400 && typeof b.body.error === 'string', JSON.stringify(b.body))
    }
  }
}
