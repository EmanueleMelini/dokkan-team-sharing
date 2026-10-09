// I filtri della lista dei clear (lib/clears/filtri.ts) e il loro URL
// (lib/urls.ts filteredClearsHref, clearListHref): ogni valore strano vale
// "non impostato" e non lancia mai, e gli stessi filtri danno sempre lo
// stesso URL.
//
// Funzioni pure, niente database: gira anche da sola,
//   npm run test:filtri
import { readFileSync } from 'node:fs'
import { molti } from '@/lib/parametri'
import {
  VUOTI, filtriAttivi, leggiFiltri, parametriFiltri, soloOrdine, type FiltriClear,
} from '@/lib/clears/filtri'
import { clearListHref, filteredClearsHref } from '@/lib/urls'
import type { Ricerca } from '@/lib/parametri'

let fails = 0
let passes = 0
function vale(nome: string, got: unknown, atteso: unknown) {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  const ok = g === a
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}  (= ${g}${ok ? '' : `, atteso ${a}`})`)
  if (ok) passes++
  else fails++
}
const qs = (f: FiltriClear) => new URLSearchParams(parametriFiltri(f)).toString()

console.log('molti: un parametro ripetibile e\' sempre un array')
vale('assente', molti(undefined), [])
vale('una volta', molti('a'), ['a'])
vale('ripetuto', molti(['a', 'b']), ['a', 'b'])

console.log('senza parametri: i valori di difetto')
vale('nessun parametro', leggiFiltri({}), VUOTI)
vale('nessun filtro attivo', filtriAttivi(leggiFiltri({})), 0)
vale('e nessun parametro nell\'URL', parametriFiltri(leggiFiltri({})), [])

console.log('le tre caselle valgono solo con 1')
for (const v of ['1', ['1', '0']]) vale(`proof=${JSON.stringify(v)}`, leggiFiltri({ proof: v }).proof, true)
for (const v of ['true', 'on', '0', '', 'yes', ['0', '1']]) vale(`proof=${JSON.stringify(v)} no`, leggiFiltri({ proof: v }).proof, false)
vale('noitems e noko', [leggiFiltri({ noitems: '1' }).noItems, leggiFiltri({ noko: '1' }).noKo], [true, true])

console.log('turns: un intero da 1 a 99')
vale('7', leggiFiltri({ turns: '7' }).turns, 7)
vale('99', leggiFiltri({ turns: '99' }).turns, 99)
for (const v of ['0', '100', '7.5', '-1', '1e3', 'abc', '', '07', ' 7', '\u0000']) {
  vale(`"${v}" no`, leggiFiltri({ turns: v }).turns, null)
}

console.log('card: fino a 3, senza doppioni, solo id')
vale('una', leggiFiltri({ card: '1032310' }).cards, ['1032310'])
vale('doppioni tolti', leggiFiltri({ card: ['5', '5', '6'] }).cards, ['5', '6'])
vale('oltre 3 si tagliano, nell\'ordine dell\'URL', leggiFiltri({ card: ['9', '8', '7', '6'] }).cards, ['7', '8', '9'])
vale('in ordine di id, come numeri', leggiFiltri({ card: ['100', '20', '3'] }).cards, ['3', '20', '100'])
vale('non numeri e zeri iniziali via', leggiFiltri({ card: ['abc', '1;drop table card', '01', '0', '-5', '2'] }).cards, ['2'])
vale('19 cifre via, 18 vanno', leggiFiltri({ card: ['1234567890123456789', '123456789012345678'] }).cards, ['123456789012345678'])
vale('i doppioni non consumano i 3 posti', leggiFiltri({ card: ['1', '1', '1', '2', '3'] }).cards, ['1', '2', '3'])

console.log('leader, mono, class, cat, sort')
vale('leader', leggiFiltri({ leader: '1032310' }).leader, '1032310')
vale('leader ripetuto: il primo', leggiFiltri({ leader: ['4', '5'] }).leader, '4')
vale('leader non valido', leggiFiltri({ leader: '1 or 1=1' }).leader, null)
vale('mono TEQ', leggiFiltri({ mono: 'TEQ' }).mono, 'TEQ')
vale('mono minuscolo no', leggiFiltri({ mono: 'teq' }).mono, null)
vale('mono sconosciuto no', leggiFiltri({ mono: 'RAINBOW' }).mono, null)
vale('class super', leggiFiltri({ class: 'super' }).cls, 'Super')
vale('class extreme', leggiFiltri({ class: 'extreme' }).cls, 'Extreme')
vale('class Super (maiuscola) no', leggiFiltri({ class: 'Super' }).cls, null)
vale('cat 89', leggiFiltri({ cat: '89' }).cat, 89)
vale('cat 32767', leggiFiltri({ cat: '32767' }).cat, 32767)
for (const v of ['32768', '0', '-1', '1.5', 'x', '099999']) vale(`cat "${v}" no`, leggiFiltri({ cat: v }).cat, null)
vale('sort new', leggiFiltri({ sort: 'new' }).sort, 'new')
vale('sort turns', leggiFiltri({ sort: 'turns' }).sort, 'turns')
vale('sort sconosciuto: top', leggiFiltri({ sort: 'zzz' }).sort, 'top')
vale('sort TOP maiuscolo: top', leggiFiltri({ sort: 'TOP' }).sort, 'top')

console.log('valori brutti non lanciano')
let lancia = false
try {
  const brutti: Ricerca[] = [
    { card: '\u0000', turns: '\u0000', mono: '\u0000', cat: '\u0000' },
    { card: [], leader: [], proof: [] },
    { card: Array.from({ length: 1000 }, (_, i) => String(i + 1)) },
    { sort: ['turns', 'new'], class: ['extreme', 'super'] },
  ]
  for (const b of brutti) leggiFiltri(b)
} catch { lancia = true }
vale('nessuna eccezione', lancia, false)
vale('mille carte: tre', leggiFiltri({ card: Array.from({ length: 1000 }, (_, i) => String(i + 1)) }).cards.length, 3)

console.log('l\'URL canonico')
const tutto = leggiFiltri({
  sort: 'turns', cat: '89', class: 'super', mono: 'TEQ', leader: '7', card: ['30', '4'],
  turns: '12', noko: '1', noitems: '1', proof: '1',
})
vale('ordine canonico', qs(tutto), 'proof=1&noitems=1&noko=1&turns=12&card=4&card=30&leader=7&mono=TEQ&class=super&cat=89&sort=turns')
vale('andata e ritorno', qs(leggiFiltri(Object.fromEntries(
  [...new URLSearchParams(qs(tutto))].reduce((m, [k, v]) => m.set(k, [...(m.get(k) ?? []), v]), new Map<string, string[]>()),
))), qs(tutto))
vale('i valori sbagliati non arrivano all\'URL', qs(leggiFiltri({ proof: 'yes', turns: '999', card: 'abc', sort: 'zzz' })), '')
vale('sort top non si scrive', qs(leggiFiltri({ sort: 'top', proof: '1' })), 'proof=1')

console.log('quanti filtri')
vale('tutti: 10 (due carte), l\'ordine non conta', filtriAttivi(tutto), 10)
vale('solo l\'ordine: 0', filtriAttivi(leggiFiltri({ sort: 'new' })), 0)
vale('soloOrdine tiene l\'ordine e toglie il resto', [filtriAttivi(soloOrdine(tutto)), soloOrdine(tutto).sort], [0, 'turns'])

console.log('gli URL della lista')
vale('filtrata, Global', filteredClearsHref({ id: '5', tier: '9', filtri: leggiFiltri({ proof: '1' }) }), '/events/5/clears?tier=9&proof=1')
vale('Japan e pagina', filteredClearsHref({ id: '5', reg: 'japan', tier: '9', filtri: leggiFiltri({ card: '3' }), page: 2 }),
  '/events/5/clears?region=japan&tier=9&card=3&page=2')
vale('senza filtri: la pagina statica del tier', clearListHref({ id: '5', tier: '9', filtri: VUOTI }), '/events/5/t/9')
vale('...con la pagina nel percorso', clearListHref({ id: '5', reg: 'japan', tier: '9', filtri: VUOTI, page: 3 }), '/events/5/japan/t/9/p/3')
vale('solo un ordine: la lista filtrata', clearListHref({ id: '5', tier: '9', filtri: leggiFiltri({ sort: 'new' }) }), '/events/5/clears?tier=9&sort=new')

console.log('i moduli puri non chiamano la cache di Next (i test li importano fuori da Next)')
for (const f of ['lib/clears/filtri.ts', 'lib/queries.ts', 'lib/urls.ts']) {
  const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  vale(`${f} senza 'use cache', cacheTag, cacheLife`, /['"]use cache|cacheTag\(|cacheLife\(|next\/cache/.test(src), false)
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
