// Gli URL degli eventi (lib/urls.ts). Ogni URL valido di una pagina evento
// diventa una voce ISR salvata: la grammatica deve accettare una sola forma
// per ogni contenuto e rifiutare tutto il resto (diventa un 404), e i link
// che il sito costruisce devono rileggersi uguali.
//
// Funzioni pure, niente database.
import { browseHref, clearAnchor, eventHref, homeHref, parseEventView, submitHref, type EventView } from '@/lib/urls'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const mostra = (v: unknown) => JSON.stringify(v) ?? String(v)
function vale<T>(nome: string, got: T, atteso: T) {
  const ok = mostra(got) === mostra(atteso)
  check(nome, ok, `= ${mostra(got)}${ok ? '' : `, atteso ${mostra(atteso)}`}`)
}

// Il catch-all riceve i segmenti dopo l'id
const segmenti = (href: string) => href.split('/').slice(3)

console.log('eventHref')
vale('Global, apertura', eventHref({ id: '12' }), '/events/12')
vale('Japan, apertura', eventHref({ id: '12', reg: 'japan' }), '/events/12/japan')
vale('un tier', eventHref({ id: '12', tier: '345' }), '/events/12/t/345')
vale('un tier, Japan, pagina 3', eventHref({ id: '12', reg: 'japan', tier: '345', page: 3 }), '/events/12/japan/t/345/p/3')
vale('la pagina 1 non si scrive', eventHref({ id: '12', tier: '345', page: 1 }), '/events/12/t/345')
vale('la pagina senza tier non si scrive', eventHref({ id: '12', page: 4 }), '/events/12')

console.log('eventHref esplicito (la versione vince su quella scelta nel sito)')
vale('Global: ?region=global', eventHref({ id: '1', tier: '5', explicit: true }), '/events/1/t/5?region=global')
vale('Global, pagina 2', eventHref({ id: '1', tier: '5', page: 2, explicit: true }), '/events/1/t/5/p/2?region=global')
vale('Global, apertura', eventHref({ id: '1', explicit: true }), '/events/1?region=global')
vale('Japan: il percorso basta, niente query', eventHref({ id: '1', reg: 'japan', tier: '5', explicit: true }), '/events/1/japan/t/5')
vale('l\'ancora dopo la query', eventHref({ id: '1', tier: '5', explicit: true }) + clearAnchor('c9'), '/events/1/t/5?region=global#clear-c9')
vale('senza explicit come prima', eventHref({ id: '1', tier: '5', explicit: false }), '/events/1/t/5')

console.log('andata e ritorno')
let giri = 0
let sbagliati = 0
for (const reg of ['global', 'japan'] as const) {
  for (const tier of [null, '1', '345', '999999999999999999']) {
    for (const page of [1, 2, 17, 100_000]) {
      const href = eventHref({ id: '42', reg, tier, page })
      const atteso: EventView = { reg, tier, page: tier ? page : 1 }
      giri++
      if (mostra(parseEventView(segmenti(href))) !== mostra(atteso)) {
        sbagliati++
        console.log(`    ${href} -> ${mostra(parseEventView(segmenti(href)))}`)
      }
    }
  }
}
check(`${giri} combinazioni di regione, tier e pagina`, sbagliati === 0, `${sbagliati} sbagliate`)
vale('undefined (nessun segmento)', parseEventView(undefined), { reg: 'global', tier: null, page: 1 })

console.log('le forme rifiutate')
const rifiutati: [string, string[]][] = [
  ['p/1', ['t', '5', 'p', '1']],
  ['p/0', ['t', '5', 'p', '0']],
  ['p/-1', ['t', '5', 'p', '-1']],
  ['p/1e3', ['t', '5', 'p', '1e3']],
  ['p/02', ['t', '5', 'p', '02']],
  ['p/2.5', ['t', '5', 'p', '2.5']],
  ['p/100001', ['t', '5', 'p', '100001']],
  ['t/abc', ['t', 'abc']],
  ['un tier di 19 cifre', ['t', '1234567890123456789']],
  ['Japan con la maiuscola', ['Japan']],
  ['japan due volte', ['japan', 'japan']],
  ['global scritto', ['global']],
  ['segmento in piu', ['t', '5', 'p', '2', 'x']],
  ['segmento in piu dopo il tier', ['t', '5', 'x']],
  ['t senza id', ['t']],
  ['p senza tier', ['p', '2']],
  ['segmento vuoto (barra finale)', ['t', '5', '']],
  ['japan dopo il tier', ['t', '5', 'japan']],
  ['parola qualsiasi', ['zzz']],
]
for (const [nome, v] of rifiutati) vale(nome, parseEventView(v), null)

console.log('browseHref: come la vecchia query della lista')
vale('nessun filtro: la pagina statica', browseHref({}), '/events')
vale('region=global non si scrive', browseHref({ reg: 'global' }), '/events')
vale('page=1 non si scrive', browseHref({ page: 1 }), '/events')
vale('Japan senza altri filtri: la sua pagina statica', browseHref({ reg: 'japan' }), '/events/japan')
vale('Japan, page=1 non si scrive', browseHref({ reg: 'japan', page: 1 }), '/events/japan')
vale('Japan con un filtro: browse, region prima', browseHref({ reg: 'japan', kind: 'story' }), '/events/browse?region=japan&type=story')
vale('Japan, pagina 2', browseHref({ reg: 'japan', page: 2 }), '/events/browse?region=japan&page=2')
vale('pagina 2', browseHref({ page: 2 }), '/events/browse?page=2')
vale('tutti, nello stesso ordine di prima',
  browseHref({ reg: 'japan', kind: 'zbattle', status: 'active', search: 'goku & co', page: 3 }),
  '/events/browse?region=japan&type=zbattle&status=active&q=goku+%26+co&page=3')

console.log('homeHref e submitHref')
vale('la home Global', homeHref('global'), '/events')
vale('la home Japan', homeHref('japan'), '/events/japan')
vale('la home per difetto e\' Global', homeHref(), '/events')
vale('submit Global: la regione c\'e\' sempre', submitHref('1', 'global', '5'), '/events/1/submit?region=global&tier=5')
vale('submit Japan', submitHref('1', 'japan', '5'), '/events/1/submit?region=japan&tier=5')

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
