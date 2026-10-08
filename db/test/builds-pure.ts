// Le build lato sito (0018): i validatori della Server Action, lo stato
// del form del builder, la ricerca delle sfere e /api/equipment. Parte di
// builds.test.mts.
import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/equipment/route'
import { buildDaVersione } from '@/lib/clears'
import {
  buildDaStato, buildPiena, payloadDa, reducer, statoVuoto, type Azione, type BuilderStato, type CartaScelta,
} from '@/lib/clears/builder-stato'
import { parseBuilderPayload, parsePayloadField } from '@/lib/clears/validate'
import { listPotentialSkills, searchEquipment } from '@/lib/equipment'
import { check, copia } from '@/db/test/builder-helpers'
import type { BuildCtx } from '@/db/test/builds-revise'

const carta = (id: number): CartaScelta => ({ id, name: `Card ${id}`, epithet: null, type: 'AGL', class: 'Super', thumb: null })

function validatori({ base, pieno, orbs }: BuildCtx) {
  console.log('\n  -- validatori della Server Action')
  const ok = parseBuilderPayload(pieno)
  check('un payload con le build passa', ok.ok, ok.ok ? '' : ok.error)
  if (ok.ok) {
    const s = ok.value.lineups[0].slots
    check('e le tiene normalizzate', JSON.stringify(s[0].build) === JSON.stringify(
      { hp_routes: 4, hp_path: 'Critical Hit', note: 'Needs the crit for phase 3.', equipment: orbs }) &&
      s[3].build?.note === 'Any build works.' && s[3].build.equipment.length === 0 && !('build' in s[1]))
  }
  const vuota = copia(base)
  vuota.lineups[0].slots[0].build = { hp_path: '  ', equipment: [null] }
  const v = parseBuilderPayload(vuota)
  check('una build vuota sparisce', v.ok && !('build' in v.value.lineups[0].slots[0]))
  const rompi = (b: unknown) => { const p = copia(base); p.lineups[0].slots[0].build = b; return p }
  const casi: [string, unknown][] = [
    ['build come testo', 'rainbow'], ['5 percorsi', { hp_routes: 5 }], ['percorsi 1.5', { hp_routes: 1.5 }],
    ['percorso lungo', { hp_path: 'x'.repeat(41) }], ['nota lunga', { note: 'x'.repeat(201) }],
    ['nota come numero', { note: 7 }], ['quattro sfere', { equipment: [1, 2, 3, 4] }],
    ['sfera come testo', { equipment: ['12'] }], ['sfera 0', { equipment: [0] }], ['sfere non array', { equipment: 5 }],
  ]
  for (const [nome, b] of casi) {
    const r = parseBuilderPayload(rompi(b))
    check(`il validatore rifiuta: ${nome}`, !r.ok && r.error.length > 0 && !/—/.test(r.error), r.ok ? 'accettato' : r.error)
  }
  const testo = parseBuilderPayload(rompi({ hp_routes: '3' }))
  check('i percorsi dal form come testo', testo.ok && testo.value.lineups[0].slots[0].build?.hp_routes === 3)
  check('il campo payload della Server Action legge le build', (() => {
    const r = parsePayloadField(JSON.stringify(pieno))
    return r.ok && r.value.lineups[1].slots[6].build?.equipment.join() === `,${orbs[1]}`
  })())
  check('buildDaVersione: sfere per posizione, senza null in coda', JSON.stringify(buildDaVersione({
    hp_routes: null, hp_path: null, note: null, equipment: [{ slot: 2, id: '812', name: 'x', tier: 1 }],
  }).equipment) === '[null,812]')
}

function statoForm({ orbs }: BuildCtx) {
  console.log('\n  -- lo stato del form')
  const applica = (s: BuilderStato, ...az: Azione[]) => az.reduce(reducer, s)
  let s = statoVuoto('42')
  check('ogni slot parte con una build vuota', s.squadre[0].slots.every((x) => !buildPiena(x.build) && x.build.sfere.length === 3))
  s = applica(s, ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ t: 'carta', l: 0, i, carta: carta(100 + i) }) as Azione),
    { t: 'ruolo', l: 0, i: 6, role: 'friend' },
    { t: 'build', l: 0, i: 0, campo: 'routes', valore: '4' },
    { t: 'build', l: 0, i: 0, campo: 'path', valore: ' Critical Hit ' },
    { t: 'sfera', l: 0, i: 0, k: 1, sfera: { id: orbs[0], name: 'Gold orb', tier: 3 } })
  check('build e sfera nello slot giusto', s.squadre[0].slots[0].build.routes === '4' &&
    s.squadre[0].slots[0].build.sfere[1]?.id === orbs[0] && !buildPiena(s.squadre[0].slots[1].build))
  check('nel payload: sfere per posizione, testo ripulito', JSON.stringify(payloadDa(s).lineups[0].slots[0].build) ===
    JSON.stringify({ hp_routes: 4, hp_path: 'Critical Hit', note: null, equipment: [null, orbs[0]] }))
  check('gli slot senza build non la mandano', !('build' in payloadDa(s).lineups[0].slots[1]))
  check('il payload del form passa il validatore', parseBuilderPayload(payloadDa(s)).ok)
  check('una sfera fuori dai tre posti si ignora', applica(s, { t: 'sfera', l: 0, i: 0, k: 3, sfera: null }) === s)
  const cambio = applica(s, { t: 'aggiungi_cambio' })
  check('il cambio copia anche le build', cambio.squadre[1].slots[0].build.sfere[1]?.id === orbs[0] &&
    cambio.squadre[1].slots[0].build !== cambio.squadre[0].slots[0].build)
  const tolta = applica(cambio, { t: 'togli_build', l: 1, i: 0 })
  check('togliere la build del cambio non tocca la partenza', !buildPiena(tolta.squadre[1].slots[0].build) &&
    buildPiena(tolta.squadre[0].slots[0].build))
  const sostituita = applica(s, { t: 'carta', l: 0, i: 0, carta: carta(999) })
  check('sostituire la carta tiene la build', sostituita.squadre[0].slots[0].build.routes === '4')
  check('svuotare lo slot toglie anche la build', !buildPiena(applica(s, { t: 'svuota', l: 0, i: 0 }).squadre[0].slots[0].build))
  check('buildDaStato: una build vuota e\' null', buildDaStato({ routes: '', path: ' ', note: '', sfere: [null, null, null] }) === null)
}

async function sfere() {
  console.log('\n  -- la ricerca delle sfere e /api/equipment')
  const bardock = await searchEquipment({ q: 'evasion bardock', tier: 1 })
  check('cerca nel nome e nella descrizione, tutte le parole', bardock.length > 0 && bardock.every((h) =>
    /evasion/i.test(h.name + h.effect) && /bardock/i.test(h.name + h.effect) && h.tier === 1))
  check('i jolly di ilike sono letterali', (await searchEquipment({ q: '%' })).every((h) => `${h.name}${h.effect}`.includes('%')))
  check('al massimo 30 per pagina', (await searchEquipment({ limit: 500 })).length === 30)
  const abilita = await listPotentialSkills()
  check('le abilita\' del Hidden Potential nell\'ordine del gioco', abilita[0] === 'Combo Attack' && abilita.includes('Evasion'),
    abilita.join(', '))
  const chiama = async (qs: string) => {
    const res = await GET({ nextUrl: new URL(`http://test.invalid/api/equipment?${qs}`) } as NextRequest)
    return { status: res.status, cache: res.headers.get('cache-control') ?? '', body: await res.json() }
  }
  const r = await chiama('q=combo&tier=3')
  check('la rotta risponde in JSON compatto', r.status === 200 && r.body.items.length > 0 &&
    r.body.items.every((x: Record<string, unknown>) => Object.keys(x).sort().join() === 'effect,id,name,tier' && x.tier === 3),
    JSON.stringify(r.body.items?.[0]))
  check('con la cache pubblica e il prossimo offset', /public/.test(r.cache) && (r.body.next === null || r.body.next === 30))
  for (const qs of ['tier=4', 'tier=x', 'offset=-1', 'offset=99999', `q=${'x'.repeat(61)}`]) {
    const b = await chiama(qs)
    check(`400 per ${qs.slice(0, 20)}`, b.status === 400 && typeof b.body.error === 'string' && /no-store/.test(b.cache))
  }
}

export default async function pure(ctx: BuildCtx) {
  validatori(ctx)
  statoForm(ctx)
  await sfere()
}
