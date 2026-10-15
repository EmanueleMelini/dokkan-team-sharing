// Le regole di robots.txt (app/robots.ts) e il rel dei link che portano
// dove robots.txt non lascia andare. Modulo puro, senza Next: lo provano i
// test (db/test/urls.test.mts) e lo leggono i componenti.
//
// Ai motori servono gli eventi, le carte e i profili. Le altre pagine o
// non hanno niente da indicizzare (l'API, l'accesso, quelle per utente), o
// sono infinite (le viste filtrate), o sono la coda lunga che costa le
// scritture ISR di Vercel Hobby (sezione "Scritture ISR su Vercel Hobby"
// del README). Il * nei percorsi lo capiscono Google e Bing (RFC 9309).

/**
 * Le pagine dei tier e le pagine Japan degli eventi. Sono circa l'84% degli
 * URL che un motore trovava seguendo i link: ogni evento linka tutti i suoi
 * tier, e ogni pagina Global il suo gemello /japan (nell'HTML per tutti, lo
 * nasconde solo il CSS). Quasi tutte dicono "No clears yet", e ogni prima
 * visita dopo un deploy le riscrive nella cache ISR.
 *
 *   /events/<id>/t/<tier>[/p/<n>]          '/events/*\/t/'
 *   /events/<id>/japan[/t/<tier>[/p/<n>]]  '/events/*\/japan' (anche il tier:
 *                                          '/events/<id>/japan/t/...' comincia cosi')
 *
 * /events/japan resta: dopo '/events/' ci vorrebbe un altro '/japan'.
 * Le pagine restano in cache per chi le apre: le escludono solo i motori.
 */
export const DISALLOW_CODA = ['/events/*/t/', '/events/*/japan'] as const

/**
 * Tutte le esclusioni, nell'ordine di robots.txt.
 *
 * /events/browse sono le viste filtrate della lista: dinamiche (una
 * funzione per vista) e in numero senza fine. Ogni evento e' gia' nella
 * sitemap, quindi ai motori non servono.
 *
 * /events/<id>/clears sono le liste filtrate dei clear di un tier: come
 * browse, dinamiche e senza fine (ogni combinazione di filtri e' un URL).
 * La regola copre anche /events/<id>/clears/<clear>/edit.
 *
 * /admin risponde 404 a chiunque non sia admin: niente da indicizzare, e
 * cosi' un bot non la prova a ogni giro.
 *
 * /notifications e /notifications/<id> sono per utente (0028): senza
 * sessione portano a /login. La regola per prefisso copre tutte e due.
 */
export const DISALLOW: readonly string[] = [
  '/api/',
  '/login',
  '/welcome',
  '/settings',
  '/events/browse',
  '/events/*/submit',
  '/events/*/clears',
  '/events/*/clears/*/edit',
  ...DISALLOW_CODA,
  '/admin',
  '/notifications',
]

const regex = (regola: string) => {
  const ancorata = regola.endsWith('$')
  const corpo = (ancorata ? regola.slice(0, -1) : regola)
    .split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${corpo}${ancorata ? '$' : ''}`)
}
const REGOLE = DISALLOW.map(regex)

/**
 * robots.txt esclude questo URL interno? Come lo leggono i motori (RFC
 * 9309): la regola vale come prefisso del percorso con la query, * per
 * qualsiasi sequenza, $ per la fine. L'unico Allow e' '/', piu' corto di
 * ogni Disallow, quindi una regola che combacia vince sempre.
 */
export function esclusoDaRobots(href: string): boolean {
  const percorso = href.split('#')[0]
  if (!percorso.startsWith('/') || percorso.startsWith('//')) return false
  return REGOLE.some((r) => r.test(percorso))
}

/**
 * Il rel di un <Link>: nofollow verso le pagine che robots.txt esclude, cosi'
 * un motore non le scopre dai link di quelle che puo' leggere. Undefined
 * per le altre (React non scrive l'attributo).
 */
export const relRobots = (href: string): 'nofollow' | undefined => (esclusoDaRobots(href) ? 'nofollow' : undefined)
