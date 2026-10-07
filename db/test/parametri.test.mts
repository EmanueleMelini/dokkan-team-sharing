// I parametri dell'URL arrivano da chiunque: link vecchi, URL scritti a
// mano, bot. lib/parametri.ts li riduce a valori che le query sanno
// trattare; qui si prova che lo faccia anche sui casi brutti, quelli che
// altrimenti diventano un 500.
//
// Funzioni pure, niente database: gira anche da sola,
//   npm run test:parametri
import { pagina, regione, testoRicerca, uno } from '@/lib/parametri'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const mostra = (v: unknown) => JSON.stringify(v) ?? String(v)
function vale<T>(nome: string, got: T, atteso: T) {
  check(nome, Object.is(got, atteso), `= ${mostra(got)}${Object.is(got, atteso) ? '' : `, atteso ${mostra(atteso)}`}`)
}

console.log('uno: un parametro ripetuto vale il primo')
vale('assente', uno(undefined), undefined)
vale('una volta', uno('a'), 'a')
vale('ripetuto', uno(['b', 'c']), 'b')
vale('array vuoto', uno([]), undefined)

console.log('regione')
vale('per difetto Global', regione({}), 'global')
vale('japan', regione({ region: 'japan' }), 'japan')
vale('le maiuscole non valgono', regione({ region: 'Japan' }), 'global')
vale('un valore sconosciuto', regione({ region: 'europe' }), 'global')
vale('ripetuto: vale il primo', regione({ region: ['japan', 'global'] }), 'japan')
vale('ripetuto, primo global', regione({ region: ['global', 'japan'] }), 'global')

console.log('pagina')
const casi: [string | string[] | undefined, number][] = [
  [undefined, 1], ['1', 1], ['2', 2], ['2.5', 1], ['-3', 1], ['0', 1], ['', 1], ['abc', 1],
  ['NaN', 1], ['Infinity', 1], ['100000', 100_000], ['100001', 100_000], [['3', '5'], 3], [['x', '5'], 1],
]
for (const [v, atteso] of casi) vale(`pagina=${mostra(v)}`, pagina({ page: v }), atteso)
// Il punto del tetto: l'offset deve restare un intero che Postgres accetta
// come bigint, scritto senza notazione esponenziale. 60 e' EVENTI_PER_PAGINA,
// scritto a mano: importarlo da lib/queries.ts aprirebbe una connessione.
for (const v of ['99999999999999999999', '9007199254740993', '1e400']) {
  const n = pagina({ page: v })
  const offset = (n - 1) * 60
  check(`pagina=${v}: un intero sicuro fra 1 e 100000, offset scrivibile`,
        Number.isSafeInteger(n) && n >= 1 && n <= 100_000 && Number.isSafeInteger(offset)
          && /^\d+$/.test(String(offset)),
        `= ${n}, offset ${offset}`)
}

console.log('testoRicerca')
vale('assente', testoRicerca({}), null)
vale('vuota', testoRicerca({ q: '' }), null)
vale('solo spazi', testoRicerca({ q: '   ' }), null)
vale('solo un NUL (?q=%00)', testoRicerca({ q: '\u0000' }), null)
vale('NUL in mezzo', testoRicerca({ q: 'Bul\u0000ma' }), 'Bulma')
vale('tab, a capo e DEL tolti', testoRicerca({ q: 'a\tb\nc\u007f' }), 'abc')
vale('apostrofo tipografico di iOS', testoRicerca({ q: 'Bulma’s' }), "Bulma's")
vale('le altre varianti di apostrofo', testoRicerca({ q: '‘aʼb′' }), "'a'b'")
vale('spazi ai lati', testoRicerca({ q: '  Goku  ' }), 'Goku')
vale('lunghezza massima 100', testoRicerca({ q: 'x'.repeat(150) })?.length, 100)
vale('il taglio dopo aver tolto gli spazi', testoRicerca({ q: ' '.repeat(10) + 'y'.repeat(120) }), 'y'.repeat(100))
vale('nessuno spazio finale se il taglio cade su uno spazio', testoRicerca({ q: 'a'.repeat(99) + ' b' }), 'a'.repeat(99))
vale('ripetuto: vale il primo', testoRicerca({ q: ['a', 'b'] }), 'a')
vale('array vuoto', testoRicerca({ q: [] }), null)
// passano alla query cosi' come sono: e' la query a trattarli alla lettera
vale('il _ resta', testoRicerca({ q: '_' }), '_')
vale('il % resta', testoRicerca({ q: '100%' }), '100%')

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
