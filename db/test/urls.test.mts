// Gli URL degli eventi (lib/urls.ts). Ogni URL valido di una pagina evento
// diventa una voce ISR salvata: la grammatica deve accettare una sola forma
// per ogni contenuto e rifiutare tutto il resto (diventa un 404), e i link
// che il sito costruisce devono rileggersi uguali. Poi robots.txt
// (app/robots.ts, lib/robots.ts): cosa esclude, letto come lo leggono i
// motori, e il rel nofollow dei link verso quelle pagine.
//
// Funzioni pure, niente database.
import { browseHref, clearAnchor, cardHref, eventHref, filteredClearsHref, homeHref, parseEventView, profileHref, submitHref, type EventView } from '@/lib/urls'
import { DISALLOW, DISALLOW_CODA, esclusoDaRobots, relRobots } from '@/lib/robots'
import { VUOTI } from '@/lib/clears/filtri'

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

console.log('robots.txt (app/robots.ts, lib/robots.ts)')
// robots() legge BETTER_AUTH_URL per la sitemap: valori finti, se mancano
process.env.BETTER_AUTH_URL ??= 'https://example.invalid'
process.env.BETTER_AUTH_SECRET ??= 'segreto-finto-dei-test-degli-url-0123456789'
const { default: robots } = await import('@/app/robots')
const r = robots() as { rules: { userAgent: string; allow: string; disallow: string[] }; sitemap: string }
check('un blocco solo per tutti, Allow: /', r.rules.userAgent === '*' && r.rules.allow === '/')
check('Disallow: /events/*/t/ e /events/*/japan', DISALLOW_CODA.every((x) => r.rules.disallow.includes(x)),
  r.rules.disallow.join(' '))
vale('le stesse regole di lib/robots.ts, nello stesso ordine', r.rules.disallow, [...DISALLOW])
check('nessuna regola per /events/japan da sola', !r.rules.disallow.some((x) => /^\/events\/japan/.test(x)))
check('la sitemap resta', r.sitemap === 'https://example.invalid/sitemap.xml', r.sitemap)

// Un lettore di robots.txt scritto qui da capo (RFC 9309: la regola piu'
// lunga che combacia vince, * qualsiasi sequenza, $ la fine), sulle righe
// che app/robots.ts scrive davvero. Deve dire le stesse cose di
// esclusoDaRobots, che e' quello che decide il rel dei link.
const combacia = (regola: string, url: string) => {
  const fine = regola.endsWith('$')
  const pezzi = (fine ? regola.slice(0, -1) : regola).split('*')
  if (!url.startsWith(pezzi[0])) return false
  let i = pezzi[0].length
  for (let n = 1; n < pezzi.length; n++) {
    // con $ l'ultimo pezzo sta in fondo; gli altri il piu' presto possibile
    const j = fine && n === pezzi.length - 1 ? url.length - pezzi[n].length : url.indexOf(pezzi[n], i)
    if (j < i) return false
    i = j + pezzi[n].length
  }
  return !fine || i === url.length
}
function vietatoDa(righe: { allow: string[]; disallow: string[] }, href: string) {
  const url = href.split('#')[0]
  const lunga = (xs: string[]) => Math.max(-1, ...xs.filter((x) => combacia(x, url)).map((x) => x.length))
  const d = lunga(righe.disallow), a = lunga(righe.allow)
  return d > a
}
const righe = { allow: [r.rules.allow], disallow: r.rules.disallow }
const ammessi = [
  '/', '/events', '/events/japan', '/events/123', '/events/123?region=global', '/events/123?region=global#missions',
  '/cards/1032310', '/users/goku_fan', '/users/goku_fan/p/2', '/sitemap.xml', '/privacy', '/terms',
]
const esclusi = [
  '/events/123/japan', '/events/123/japan/t/5', '/events/123/japan/t/5/p/2', '/events/123/t/5',
  '/events/123/t/5/p/2', '/events/123/t/5?region=global#clear-c9', '/events/browse?page=2',
  '/events/123/clears?tier=5', '/events/123/clears/c9/edit', '/events/123/submit?region=global&tier=5',
  '/api/me', '/admin', '/admin/users/x', '/notifications', '/notifications/5', '/settings', '/login?next=%2F', '/welcome',
]
for (const u of ammessi) check(`ammesso: ${u}`, !vietatoDa(righe, u) && !esclusoDaRobots(u) && relRobots(u) === undefined)
for (const u of esclusi) check(`escluso, e nofollow: ${u}`, vietatoDa(righe, u) && esclusoDaRobots(u) && relRobots(u) === 'nofollow')
check('un URL esterno o senza barra non e\' mai nofollow per robots', [
  'https://youtube.com/watch?v=1', '//evil.example/events/1/t/2', 'events/1/t/2', '#clear',
].every((u) => relRobots(u) === undefined))

console.log('il rel dei link del sito')
{
  let giri = 0, sbagliati = 0
  for (const reg of ['global', 'japan'] as const) {
    for (const tier of [null, '5']) {
      for (const page of [1, 2]) {
        for (const explicit of [false, true]) {
          const href = eventHref({ id: '42', reg, tier, page, explicit }) + (tier ? clearAnchor('c9') : '')
          const atteso = reg === 'japan' || tier ? 'nofollow' : undefined
          giri++
          if (relRobots(href) !== atteso || vietatoDa(righe, href) !== (atteso === 'nofollow')) {
            sbagliati++
            console.log(`    ${href}: ${relRobots(href)}`)
          }
        }
      }
    }
  }
  check(`${giri} link a un evento: nofollow solo verso i tier e le pagine Japan`, sbagliati === 0, `${sbagliati} sbagliati`)
}
check('le home, le carte e i profili si seguono', [homeHref('global'), homeHref('japan'), cardHref('1032310'),
  profileHref('goku_fan'), profileHref('goku_fan', 3), browseHref({ reg: 'japan' })].every((u) => relRobots(u) === undefined))
check('le viste filtrate e il builder: nofollow', [browseHref({ page: 2 }), browseHref({ kind: 'story' }),
  filteredClearsHref({ id: '1', tier: '5', filtri: { ...VUOTI, proof: true } }), submitHref('1', 'global', '5')]
  .every((u) => relRobots(u) === 'nofollow'))

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
