// L'interfaccia della versione del sito, Global o Japan (lib/versione,
// components/versione):
//
//   - lib/versione/interruttore.ts: quale versione mostra un URL e se e'
//     marcato, quando il cambio porta al gemello (l'interruttore, "Use ...
//     everywhere", il riallineamento con l'account), il riallineamento una
//     volta per scheda, il redirect di un'azione riconosciuto come quello
//     di Next, i testi degli avvisi, i blocchi della pagina della carta;
//   - i contrasti dei colori dell'interruttore, degli avvisi e del tag JP in
//     tutti gli 11 temi (sono solo token);
//   - le guardie sui file: la variante japan: del CSS, il gruppo di
//     bottoni con aria-pressed (un controllo a segmenti: lo stesso peso,
//     hover solo sull'opzione non scelta, i bersagli, il focus, il velo),
//     la prima riga del burger, il controllo dell'header dai 1024px
//     accanto a Events, il tag JP sul bottone del burger, Settings, i
//     link agli eventi della versione, gli avvisi statici e uguali per
//     tutti (col link all'altra versione solo se li' c'e' una run), il focus
//     di "Use ... everywhere", la cache del router dopo un cambio in
//     un'altra scheda, i chip Version tolti, "Japan version", la pagina
//     della carta; nessun componente legge il cookie lato server o lo
//     scrive dal browser.
//
// Funzioni pure e file, niente database.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import {
  CHIAVE_RIALLINEAMENTO, ERRORE_VERSIONE, NOME_VERSIONE, RIPROVA_VERSIONE, annuncioVersione, avvisoVersione, classeVersione, eRedirect,
  esitoVersione, linkAltraVersione, paginaDi, quiPerCambio, senzaDate, versioneDaRiconciliare, versioniCarta,
  type PaginaVersione,
} from '@/lib/versione/interruttore'
import { VERSIONI, gemello, seguiVersione, type Versione } from '@/lib/versione/versione'
import { TEMI } from '@/lib/tema/temi'

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
const file = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const togliCommenti = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

// ---------------------------------------------------------------------
//  Quale versione mostra un URL
// ---------------------------------------------------------------------

const G = (marcata: boolean): PaginaVersione => ({ v: 'global', marcata })
const J: PaginaVersione = { v: 'japan', marcata: true }

const PAGINE: [string, PaginaVersione | null][] = [
  ['/events', G(false)],
  ['/events?account=deleted', G(false)],
  ['/events?region=global', G(true)],
  // /events e' statica e non legge la query: un ?region=japan la marca e basta
  ['/events?region=japan', G(true)],
  ['/events/japan', J],
  ['/events/japan?account=deleted', J],
  ['/events/1', G(false)],
  ['/events/1/t/5', G(false)],
  ['/events/1/t/5/p/2?region=global', G(true)],
  ['/events/1?region=japan', G(true)],
  ['/events/1/japan', J],
  ['/events/1/japan/t/5/p/3', J],
  ['/events/browse?type=story', G(false)],
  ['/events/browse?region=global&type=story', G(true)],
  ['/events/browse?region=japan&type=story', J],
  // come lib/parametri.ts regione(): conta il primo valore
  ['/events/browse?region=&region=japan', G(true)],
  ['/events/browse?region=', G(false)],
  ['/events/1/clears?tier=5&proof=1', G(false)],
  ['/events/1/clears?region=japan&tier=5', J],
  // le pagine uguali nelle due versioni, quelle per utente e quelle che non ci sono
  ['/cards/1032310', null], ['/users/someone', null], ['/settings', null], ['/notifications', null],
  ['/notifications/12', null], ['/welcome', null], ['/login', null], ['/admin', null], ['/', null],
  ['/events/1/submit?region=japan&tier=5', null], ['/events/1/clears/3b49014b-0000-4000-8000-000000000001/edit', null],
  ['/events/abc', null], ['/events/1/zzz', null], ['//evil.example/events', null], ['/\\evil.example', null],
  ['https://evil.example/events', null], ['', null], [`/events?q=${'x'.repeat(2100)}`, null],
]

function pagine() {
  console.log('\n  -- paginaDi: la versione di un URL, e se lo dice lui')
  const sbagliate = PAGINE.filter(([h, a]) => mostra(paginaDi(h)) !== mostra(a))
    .map(([h, a]) => `${h.slice(0, 60)}: ${mostra(paginaDi(h))}, atteso ${mostra(a)}`)
  check(`${PAGINE.length} URL: versione e marca giuste`, sbagliate.length === 0, sbagliate.join(' | '))
  check('un valore che non e\' testo: null', paginaDi(42) === null && paginaDi(null) === null && paginaDi(undefined) === null)
  // stessa idea di gemello(): una pagina ha un gemello se e solo se ha una versione
  const scollate = PAGINE.filter(([h]) => (paginaDi(h) === null) !== (gemello(h, 'japan') === null)).map(([h]) => h.slice(0, 60))
  check('una pagina ha una versione se e solo se ha un gemello', scollate.length === 0, scollate.join(', '))
  // un URL senza marca segue la scelta: con Japan i redirect lo portano altrove
  const nonSegue = PAGINE.filter(([h, a]) => a && !a.marcata && seguiVersione(h, 'japan') === h).map(([h]) => h)
  check('ogni pagina non marcata, con Japan, la sposta il routing', nonSegue.length === 0, nonSegue.join(', '))
  const segue = PAGINE.filter(([h, a]) => a?.marcata && seguiVersione(h, 'japan') !== h).map(([h]) => h)
  check('...e nessuna marcata', segue.length === 0, segue.join(', '))
}

// ---------------------------------------------------------------------
//  Quando il cambio porta al gemello
// ---------------------------------------------------------------------

function cambio() {
  console.log('\n  -- quiPerCambio: il gemello, o si resta')
  vale('Global senza marca, scelgo Japan: al gemello', quiPerCambio('/events/1/t/5', 'japan'), '/events/1/t/5')
  vale('...scelgo Global: si resta (e\' gia\' Global)', quiPerCambio('/events/1/t/5', 'global'), null)
  vale('una pagina Japan, scelgo Global: al gemello', quiPerCambio('/events/1/japan/t/5', 'global'), '/events/1/japan/t/5')
  vale('...scelgo Japan: si resta', quiPerCambio('/events/1/japan/t/5', 'japan'), null)
  vale('su Japan guardo un clear Global (link esplicito) e scelgo Global: resto sul clear',
    quiPerCambio('/events/1/t/5/p/2?region=global', 'global'), null)
  vale('"Use Japan everywhere" su una pagina Japan: si resta', quiPerCambio('/events/1/japan', 'japan'), null)
  vale('la lista filtrata Japan, scelgo Global: al gemello', quiPerCambio('/events/browse?region=japan&type=story', 'global'),
    '/events/browse?region=japan&type=story')
  const ferme = ['/cards/1', '/settings', '/users/x', '/notifications', '/events/1/submit?region=global&tier=5',
    '/events/1/clears/abc/edit', '/welcome']
  check('le pagine senza gemello restano (il builder non perde un team non salvato)',
    ferme.every((h) => quiPerCambio(h, 'japan') === null && quiPerCambio(h, 'global') === null))

  console.log('\n  -- il riallineamento con l\'account: un link che dice la versione vince')
  vale('una pagina senza marca segue l\'account', quiPerCambio('/events', 'japan', true), '/events')
  vale('un clear Global aperto da una notifica (marcato) resta', quiPerCambio('/events/1/t/5/p/2?region=global', 'japan', true), null)
  vale('una pagina /japan resta (il percorso e\' una marca)', quiPerCambio('/events/1/japan', 'global', true), null)
  vale('una lista filtrata senza region segue l\'account', quiPerCambio('/events/browse?type=story', 'japan', true),
    '/events/browse?type=story')

  // Dove si va davvero e' il gemello: deve esserci, essere dell'altra
  // versione e cambiare percorso o query (SeguiVersione rimette data-reg al
  // cambio di URL: un URL uguale lascerebbe l'attributo di prima).
  const tutti = PAGINE.map(([h]) => h).filter((h) => paginaDi(h))
  const rotti: string[] = []
  for (const h of tutti) {
    for (const v of VERSIONI) {
      const qui = quiPerCambio(h, v)
      if (!qui) continue
      const dest = gemello(qui, v)
      const p = dest ? paginaDi(dest) : null
      const [a, b] = [new URL(qui, 'http://x.invalid'), dest ? new URL(dest, 'http://x.invalid') : null]
      if (!dest || !p || p.v !== v || !b || (a.pathname === b.pathname && a.search === b.search)) rotti.push(`${h} -> ${v}: ${dest}`)
    }
  }
  check('ogni navigazione va a un gemello della versione scelta, con un URL diverso', rotti.length === 0, rotti.join(' | '))
  const nonRisolti = tutti.flatMap((h) => VERSIONI.map((v) => [h, v] as const))
    .filter(([h, v]) => quiPerCambio(h, v) && seguiVersione(gemello(h, v)!, v) !== gemello(h, v))
  check('...gia\' risolto: i redirect non lo spostano ancora', nonRisolti.length === 0, mostra(nonRisolti))

  console.log('\n  -- versioneDaRiconciliare: una volta per scheda, mai durante un cambio')
  const base = { account: 'japan' as Versione, attuale: 'global' as Versione, inCorso: false, fatta: false }
  vale('l\'account e\' su Japan, il dispositivo no: Japan', versioneDaRiconciliare(base), 'japan')
  vale('uguali: niente', versioneDaRiconciliare({ ...base, attuale: 'japan' }), null)
  vale('un cambio in corso (/api/me puo\' essere di prima): niente', versioneDaRiconciliare({ ...base, inCorso: true }), null)
  vale('gia\' fatto in questa scheda (o scelto qui): niente', versioneDaRiconciliare({ ...base, fatta: true }), null)
  vale('senza account completo (undefined): niente', versioneDaRiconciliare({ ...base, account: undefined }), null)
  vale('un valore sconosciuto da un server diverso: niente',
    versioneDaRiconciliare({ ...base, account: 'eu' as unknown as Versione }), null)
  vale('anche verso Global', versioneDaRiconciliare({ ...base, account: 'global', attuale: 'japan' }), 'global')
  check('la chiave di sessionStorage', CHIAVE_RIALLINEAMENTO === 'dts_version_sync')
}

// ---------------------------------------------------------------------
//  Redirect, testi
// ---------------------------------------------------------------------

function redirect() {
  console.log('\n  -- eRedirect: lo stesso controllo di Next')
  const richiedi = createRequire(import.meta.url)
  const { getRedirectError } = richiedi('next/dist/client/components/redirect.js') as {
    getRedirectError: (url: string, type: string, status?: number) => Error
  }
  const { isRedirectError } = richiedi('next/dist/client/components/redirect-error.js') as { isRedirectError: (e: unknown) => boolean }
  const casi: [string, unknown][] = [
    ['replace (setVersionAction)', getRedirectError('/events/1/japan/t/5', 'replace')],
    ['push', getRedirectError('/events/japan', 'push')],
    ['308', getRedirectError('/events', 'replace', 308)],
    ['un URL con il punto e virgola', getRedirectError('/events/browse?q=a;b', 'replace')],
    ['notFound', Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })],
    ['un tipo sconosciuto', Object.assign(new Error('x'), { digest: 'NEXT_REDIRECT;pop;/x;307;' })],
    ['uno stato sconosciuto', Object.assign(new Error('x'), { digest: 'NEXT_REDIRECT;replace;/x;200;' })],
    ['un errore qualunque', new Error('fetch failed')],
    ['un digest non testo', { digest: 307 }],
    ['una stringa', 'NEXT_REDIRECT;replace;/x;307;'], ['null', null], ['undefined', undefined],
  ]
  const diversi = casi.filter(([, e]) => eRedirect(e) !== isRedirectError(e)).map(([n]) => n)
  check(`${casi.length} casi: come isRedirectError di Next`, diversi.length === 0, diversi.join(', '))
  check('...e il redirect dell\'azione e\' riconosciuto', eRedirect(casi[0][1]) && !eRedirect(casi[7][1]))
}

function testi() {
  console.log('\n  -- gli avvisi e le note')
  const jp = avvisoVersione('japan')
  vale('su una pagina Japan, per chi e\' su Global', jp, {
    classe: 'japan:hidden', titolo: 'This is the Japan version.', dettaglio: 'Your site is set to Global.',
    link: 'Global version of this page', usa: 'Use Japan everywhere',
  })
  const gl = avvisoVersione('global')
  vale('su una pagina Global, per chi e\' su Japan', gl, {
    classe: 'hidden japan:block', titolo: 'This is the Global version.', dettaglio: 'Your site is set to Japan.',
    link: 'Japan version of this page', usa: 'Use Global everywhere',
  })
  // al posto dello stato dell'evento, con la sua forma: l'etichetta e il dettaglio
  vale('senza date: l\'etichetta dice la versione', senzaDate('japan'),
    { etichetta: 'No Japan dates', dettaglio: 'It may not be out in this version yet, or the wiki doesn’t list it.' })
  check('...anche per Global, e non afferma mai che l\'evento non e\' uscito',
    senzaDate('global').etichetta === 'No Global dates' &&
    senzaDate('global').dettaglio.startsWith('It may not be out in this version yet') &&
    VERSIONI.every((v) => !/not released|isn.t out|doesn.t exist/i.test(Object.values(senzaDate(v)).join(' '))))
  vale('il link all\'altra versione', [linkAltraVersione('japan'), linkAltraVersione('global')],
    ['Global version of this event', 'Japan version of this event'])
  vale('l\'annuncio', [annuncioVersione('japan'), annuncioVersione('global')], ['Japan version on', 'Global version on'])
  vale('i nomi', NOME_VERSIONE, { global: 'Global', japan: 'Japan' })
  vale('l\'esito di Settings', [esitoVersione('japan', 'account'), esitoVersione('global', 'device')],
    ['Japan version on. Saved to your account.', 'Global version on. Saved on this device.'])
  // In Settings l'errore sta nella riga riservata all'esito, alta una riga:
  // a 320px ci sono 246px, e con l'icona l'errore ne vuole 231 (misurato in
  // Chrome, Geist a 12px). 40 caratteri sono il tetto di questa misura.
  check('l\'errore di un cambio: breve, ci sta in una riga anche a 320px (al massimo 40 caratteri, come l\'esito)',
    ERRORE_VERSIONE === 'Couldn’t change the version. Try again.' && ERRORE_VERSIONE.length <= 40 &&
    VERSIONI.every((v) => esitoVersione(v, 'account').length <= 41), String(ERRORE_VERSIONE.length))
  check('...ed e\' quello del cambio nel provider', /return \{ error: ERRORE_VERSIONE \}/.test(file('components/viewer/provider.tsx')))
  // "Use ... everywhere" dopo un errore: il bottone dice di riprovare, nella
  // sua larghezza (le due etichette stanno nella stessa cella)
  check('"Try again" al posto di "Use ... everywhere": piu\' corto di tutti e due',
    RIPROVA_VERSIONE === 'Try again' && VERSIONI.every((v) => avvisoVersione(v).usa.length > RIPROVA_VERSIONE.length + 3))

  console.log('\n  -- la pagina della carta: un blocco per versione')
  vale('uscita in tutte e due: Global poi Japan', versioniCarta([{ reg: 'japan' }, { reg: 'global' }]), ['global', 'japan'])
  vale('solo Global', versioniCarta([{ reg: 'global' }]), ['global'])
  vale('solo Japan', versioniCarta([{ reg: 'japan' }]), ['japan'])
  vale('nessuna data: Japan, come prima', versioniCarta([]), ['japan'])
  vale('due blocchi: ognuno solo nella sua versione', [classeVersione('global', 2), classeVersione('japan', 2)],
    ['japan:hidden', 'hidden japan:block'])
  vale('un blocco solo: sempre visibile', [classeVersione('global', 1), classeVersione('japan', 1)], ['', ''])
}

// ---------------------------------------------------------------------
//  I contrasti, in tutti i temi
// ---------------------------------------------------------------------

const canali = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lineare = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminanza = (h: string) => {
  const [r, g, b] = canali(h).map(lineare)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrasto = (a: string, b: string) => {
  const x = luminanza(a), y = luminanza(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// I blocchi di app/globals.css, letti come fa temi.test.mts
type Blocco = { selettori: string[]; props: Map<string, string> }
const css = file('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
const blocchi: Blocco[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selettori: (m[1].split(';').pop() ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  props: new Map(m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return [d.slice(0, i).trim(), d.slice(i + 1).trim().toLowerCase()] as [string, string]
  })),
}))
const temaCss = (id: string) => blocchi.find((b) => b.selettori.includes(`[data-theme="${id}"]`))
const sistemaScuro = blocchi.find((b) => b.selettori.includes(':root:not([data-theme])'))

function contrasti() {
  console.log('\n  -- i colori, in tutti gli 11 temi (System chiaro e scuro)')
  // [testo, fondo, dove]. Il binario dell'interruttore e' lo sfondo della pagina.
  const coppie: [string, string, string][] = [
    ['sfondo', 'inchiostro', 'l\'opzione scelta'],
    ['testo', 'sfondo', 'l\'opzione non scelta (menu, Settings), sul binario'],
    ['tenue', 'sfondo', 'l\'opzione non scelta (header), l\'occhiello "Japan version" e il dettaglio senza date'],
    ['inchiostro', 'superficie-2', 'l\'opzione non scelta all\'hover'],
    ['inchiostro', 'linea', 'l\'opzione non scelta premuta'],
    ['inchiostro', 'superficie', 'l\'errore dell\'header e "Use ... everywhere"'],
    ['tenue', 'superficie', 'l\'esito in Settings'],
    ['testo', 'oro-tenue', 'il testo degli avvisi'],
    ['inchiostro', 'oro-tenue', 'il titolo e il link degli avvisi'],
    ['oro', 'oro-tenue', 'il tag JP, l\'icona degli avvisi e le note della carta'],
    ['str', 'superficie', 'l\'errore (menu, Settings) e "Try again" di "Use ... everywhere"'],
    ['inchiostro', 'sfondo', 'il titolo senza date'],
  ]
  const temi: [string, Blocco | undefined][] = [
    ...TEMI.filter((t) => t.id !== 'system').map((t) => [t.id, temaCss(t.id)] as [string, Blocco | undefined]),
    ['system (scuro)', sistemaScuro],
  ]
  check('11 temi: i 10 con un blocco e System chiaro e scuro', TEMI.length === 11 && temi.every(([, b]) => !!b) &&
    temi.length === 11, temi.filter(([, b]) => !b).map(([id]) => id).join())
  for (const [id, b] of temi) {
    if (!b) continue
    const t = (k: string) => b.props.get(`--${k}`) ?? ''
    const sotto = coppie.map(([a, f, dove]) => [dove, contrasto(t(a), t(f))] as const).filter(([, r]) => !(r >= 4.5))
      .map(([dove, r]) => `${dove} ${r.toFixed(2)}`)
    check(`${id}: almeno 4.5:1`, sotto.length === 0, sotto.join('; '))
    // Lo stato si vede senza leggere il testo (WCAG 1.4.11, 3:1): il pieno
    // dell'opzione scelta sul binario, e l'anello del focus (oro), che sta
    // fuori dal segmento (offset 0), sul binario.
    const stato = [['inchiostro', 'sfondo', 'il pieno sul binario'], ['oro', 'sfondo', 'l\'anello sul binario']]
      .map(([a, f, dove]) => [dove, contrasto(t(a), t(f))] as const).filter(([, r]) => !(r >= 3))
      .map(([dove, r]) => `${dove} ${r.toFixed(2)}`)
    check(`${id}: l'opzione scelta e il focus si vedono (3:1)`, stato.length === 0, stato.join('; '))
  }
}

// ---------------------------------------------------------------------
//  Le guardie sui file
// ---------------------------------------------------------------------

function fileDi(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(new URL(`../../${dir}`, import.meta.url))) {
    const rel = `${dir}/${n}`
    if (statSync(new URL(`../../${rel}`, import.meta.url)).isDirectory()) fileDi(rel, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel)
  }
  return out
}

// current: il colore del testo (il velo di AttesaLink, bg-current), quindi un token anche lui
const TOKEN_COLORE = new Set(['sfondo', 'superficie', 'superficie-2', 'inchiostro', 'testo', 'tenue', 'linea', 'linea-forte',
  'campo', 'oro', 'oro-linea', 'oro-tenue', 'agl', 'teq', 'int', 'str', 'phy', 'transparent', 'current'])

/** I colori di un sorgente che non sono token dei temi: valori scritti, o le tavolozze di Tailwind. */
function coloriNonToken(t: string): string[] {
  const fuori: string[] = []
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(|hsl\(/.test(t)) fuori.push('un colore scritto')
  for (const m of t.matchAll(/(?:^|[\s'"`:])(?:bg|text|border|decoration|ring|outline)-([a-z][a-z0-9-]*)(?:\/\d+)?(?=[\s'"`])/g)) {
    const nome = m[1]
    // misure, allineamenti, lati: non sono colori
    if (/^(?:\[|\d|xs$|sm$|base$|lg$|xl$|\dxl$|left$|center$|right$|balance$|none$|solid$)/.test(nome)) continue
    if (/^(?:x|y|t|b|l|r|s|e)$/.test(nome) || /^(?:x|y|t|b|l|r)-/.test(nome)) continue
    if (!TOKEN_COLORE.has(nome)) fuori.push(m[0].replace(/^[\s'"`:]/, ''))
  }
  return fuori
}

function guardieCss() {
  console.log('\n  -- il CSS')
  check('app/globals.css: la variante japan: sull\'attributo data-reg',
    css.includes('@custom-variant japan (&:where([data-reg="japan"] *));'))
  // (nomi che Tailwind non conosce: anche questo file finisce nella sua scansione, e una
  // classe vera di un colore qui finirebbe nel CSS del sito)
  vale('la guardia dei colori li vede', coloriNonToken(`'px-2 text-rosso border-linea japan:bg-cielo text-[12px]' color: '#a1b2c3'`),
    ['un colore scritto', 'text-rosso', 'bg-cielo'])
  // i colori dei componenti nuovi: solo i token dei temi (cosi' valgono in tutti)
  const colori = [...fileDi('components/versione'), 'components/auth/user-menu.tsx', 'components/auth/menu-mobile.tsx']
    .flatMap((f) => coloriNonToken(file(f)).map((c) => `${f}: ${c}`))
  check('l\'interruttore, gli avvisi, il menu: solo token dei temi', colori.length === 0, [...new Set(colori)].join(', '))
}

function guardieComponenti() {
  console.log('\n  -- l\'interruttore (components/versione/scelta-versione.tsx)')
  const scelta = file('components/versione/scelta-versione.tsx')
  // Un radio vuole aria-checked (WAI-ARIA 1.2), che l'HTML in cache non puo'
  // dire: un gruppo di bottoni, e aria-pressed solo dopo l'idratazione.
  check('un gruppo di bottoni, col nome "Game version" o un\'etichetta visibile',
    /role="group"/.test(scelta) && !/role="radio/.test(togliCommenti(scelta)) && /type="button"/.test(scelta) &&
    /aria-label=\{etichetta \? undefined : 'Game version'\}/.test(scelta) && /aria-labelledby=\{etichetta\}/.test(scelta))
  check('aria-pressed dalla versione applicata, e niente prima dell\'idratazione (nessun aria-checked)',
    /aria-pressed=\{versione === null \? undefined : versione === v\}/.test(scelta) && /useVersione\(\)/.test(scelta) &&
    !/aria-checked/.test(togliCommenti(scelta)))
  check('tutte e due le opzioni nel giro del Tab (niente tabIndex a rotazione)', !/tabIndex/.test(togliCommenti(scelta)))
  check('busy con aria-disabled, mai disabled (il focus non si perde)',
    /aria-busy=\{occupato \|\| undefined\}/.test(scelta) && /aria-disabled=\{occupato \|\| undefined\}/.test(scelta) &&
    !/\sdisabled=\{/.test(scelta))
  check('l\'opzione gia\' scelta non fa niente', /if \(occupato \|\| versione === null \|\| v === versione\) return/.test(scelta))
  // lo stato visibile viene dal CSS: ogni colore di Global ha la sua japan: e viceversa
  const scelte = [...scelta.slice(scelta.indexOf('const SCELTA'), scelta.indexOf('const FORZATI')).matchAll(/(global|japan): '([^']+)'/g)]
  const scoperte = scelte.filter(([, , classi]) => {
    const base = classi.split(' ').filter((c) => !c.includes(':')).map((c) => c.split('-')[0])
    const jp = classi.split(' ').filter((c) => c.startsWith('japan:')).map((c) => c.slice(6).split('-')[0])
    return base.some((p) => !jp.includes(p))
  })
  check('lo stato scelto lo dice il CSS: ogni proprieta\' ha la sua variante japan:', scelte.length === 6 && scoperte.length === 0,
    scoperte.map(([m]) => m).join(' | '))
  // il peso e' lo stesso per le due opzioni: scegliere non cambia la larghezza (niente salti)
  check('lo stesso peso per l\'opzione scelta e l\'altra', scelte.every(([, , classi]) => !/font-/.test(classi)) &&
    /const SEGMENTO = 'segmento [^']*font-medium/.test(scelta))
  // Con i colori forzati (il contrasto elevato di Windows) il pieno di
  // inchiostro sparisce, e il peso e' lo stesso: l'opzione scelta prende il
  // pieno di sistema delle selezioni, per tutte e tre le varianti, e
  // anche questo con la sua japan: (giusto prima dell'idratazione).
  const forzati = scelta.slice(scelta.indexOf('const FORZATI'), scelta.indexOf('const BINARIO'))
  check('con i colori forzati l\'opzione scelta resta riconoscibile: il pieno di sistema (Highlight), con la sua japan:',
    /global: 'forced-colors:bg-\[color:Highlight\] forced-colors:text-\[color:HighlightText\] forced-colors:forced-color-adjust-none ' \+\s*'japan:forced-colors:bg-transparent japan:forced-colors:text-\[color:ButtonText\] japan:forced-colors:forced-color-adjust-auto'/.test(forzati) &&
    /japan: 'japan:forced-colors:bg-\[color:Highlight\] japan:forced-colors:text-\[color:HighlightText\] japan:forced-colors:forced-color-adjust-none'/.test(forzati) &&
    // fca none: senza, Chrome mette dietro al testo il riquadro del colore della pagina; e l'anello dentro, su quella scelta
    /@media \(forced-colors: active\) \{\s*\.segmento\[aria-pressed="true"\]:focus-visible \{\s*outline-color: HighlightText;\s*outline-offset: -4px;/.test(file('app/globals.css')) &&
    /\$\{SCELTA\[variante\]\[v\]\} \$\{FORZATI\[v\]\}/.test(scelta) && /className=\{`\$\{SEGMENTO\} \$\{MISURA\[variante\]\} \$\{SCELTA\[variante\]\[v\]\} \$\{FORZATI\[v\]\}`\}/.test(scelta))
  const conHover = scelta.match(/[\w[\]=:-]*(?:hover|active):[\w-]+/g) ?? []
  check('hover e pressione solo sull\'opzione non scelta (aria-pressed c\'e\' solo dopo l\'idratazione)',
    conHover.length >= 3 && conHover.every((c) => c.startsWith('aria-[pressed=false]:')), conHover.join(' '))
  check('un binario solo, con due segmenti larghi uguali, in tutte e tre le varianti',
    /const BINARIO = 'inline-grid grid-cols-2 /.test(scelta) && /className=\{BINARIO\}/.test(scelta))
  check('i bersagli: 24px nell\'header (WCAG 2.5.8), 44px nel burger',
    /riga: 'h-6 /.test(scelta) && /menu: 'h-11 /.test(scelta))
  check('il focus attaccato al segmento, nei 2px fra i segmenti (app/globals.css)',
    /\.segmento:focus-visible \{\s*outline-offset: 0;/.test(file('app/globals.css')))
  check('mentre il cambio gira: il velo dei link che caricano sull\'opzione scelta, sempre presente (non sposta niente)',
    /occupato && verso === v \? 'opacity-15' : 'opacity-0'/.test(scelta) && /setVerso\(v\)/.test(scelta) &&
    /absolute inset-0 rounded-\[inherit\] bg-current/.test(scelta))
  check('un errore si vede e si annuncia (role=alert), con l\'icona', /role="alert"/.test(scelta) && /<WarningCircle /.test(scelta))
  // Sul telefono l'esito non ci sta accanto e va sotto: la riga resta
  // riservata anche vuota, o ogni scelta sposterebbe due volte la pagina.
  check('Settings: l\'esito in una riga di stato visibile, accanto al controllo dai 640px, sotto riservata',
    /variante === 'settings' \? \(\s*(?:\/\/[^\n]*\n\s*)?<div className=\{ESITO\}>\s*<p role="status"/.test(scelta) &&
    /settings: 'flex flex-wrap items-center/.test(scelta) &&
    /const ESITO = 'basis-full sm:basis-auto min-h-\[1lh\] /.test(scelta))
  check('...e l\'errore nello stesso posto, non su una riga in piu\'',
    /<div className=\{ESITO\}>[\s\S]*?\{errore && <Errore id=\{`\$\{id\}-errore`\} className=\{ERRORE\.settings\}>/.test(scelta) &&
    !/settings: '[^']*basis-full/.test(scelta.slice(scelta.indexOf('const ERRORE'))))
  // L'header sta nel layout: senza questo l'errore di una pagina seguirebbe
  // chi guarda su tutte le altre, sopra <main>.
  check('l\'errore dell\'header se ne va cambiando pagina, con Esc o con un tocco fuori',
    /const percorso = usePathname\(\)/.test(scelta) &&
    /if \(errorePer !== percorso\) \{\s*setErrorePer\(percorso\)\s*setErrore\(null\)/.test(scelta) &&
    /if \(!errore \|\| variante !== 'riga'\) return/.test(scelta) &&
    /if \(e\.key === 'Escape'\) setErrore\(null\)/.test(scelta) &&
    /if \(!radice\.current\?\.contains\(e\.target as Node\)\) setErrore\(null\)/.test(scelta))

  console.log('\n  -- nessuno legge o scrive il cookie fuori posto')
  const comp = [...fileDi('components'), 'app/layout.tsx']
  const scrittori = comp.filter((f) => /document\.cookie\s*=[^=]/.test(file(f)) && f !== 'components/viewer/provider.tsx')
  check('nessun componente scrive document.cookie (provider.tsx toglie solo l\'indizio dts_signed_in)', scrittori.length === 0,
    scrittori.join(', '))
  const prov = file('components/viewer/provider.tsx')
  check('...e il provider non tocca il cookie della versione',
    !/document\.cookie\s*=[^=][^\n]*(dts_version|VERSIONE)/.test(prov) && (prov.match(/document\.cookie\s*=[^=]/g) ?? []).length === 1)
  const lettori = comp.filter((f) => /next\/headers|@\/lib\/versione\/server|cookies\(\)/.test(file(f)))
  check('nessun componente legge cookie o header della richiesta', lettori.length === 0, lettori.join(', '))
  const attributo = [...comp, ...fileDi('lib')].filter((f) => !f.startsWith('lib/versione/') &&
    /(setAttribute|removeAttribute)\(\s*(['"]data-reg['"]|ATTRIBUTO_VERSIONE)/.test(file(f)))
  check('data-reg lo mettono solo lo script del <head> e lib/versione/client.ts', attributo.length === 0, attributo.join(', '))
  const client = file('lib/versione/client.ts')
  check('sessionStorage del riallineamento dentro try/catch',
    /try \{\s*return sessionStorage\.getItem\(CHIAVE_RIALLINEAMENTO\)/.test(client) &&
    /try \{\s*sessionStorage\.setItem\(CHIAVE_RIALLINEAMENTO, '1'\)/.test(client))
  check('lib/versione/interruttore.ts resta puro (niente React, Next o cache)',
    !/from 'react'|from 'next|'use cache'|cacheTag\(|document\.|window\./.test(togliCommenti(file('lib/versione/interruttore.ts'))))

  console.log('\n  -- il provider: il cambio e il riallineamento')
  check('il riallineamento usa versioneDaRiconciliare e lo segna per la scheda',
    /versioneDaRiconciliare\(\{/.test(prov) && /segnaRiallineamento\(\)\s*\n\s*startTransition\(async/.test(prov) &&
    /cambiaVersioneQui\(v, true,/.test(prov))
  check('una scelta fatta qui vale come riallineamento', /segnaRiallineamento\(\)\s*\n\s*const passi/.test(prov))
  check('il redirect dell\'azione si prende e non si rilancia', /if \(!eRedirect\(e\)\) return \{ error:/.test(prov) &&
    !/throw e/.test(prov.slice(prov.indexOf('async function cambiaVersioneQui'), prov.indexOf('const nessunPasso'))))
  check('senza navigazione l\'attributo si mette quando l\'azione ha risposto (e prima, se c\'e\', il passo prima)',
    /const r = await setVersionAction\(v, quiPerCambio\(qui, v, riconcilia\)\)\s*\n\s*if \(r\.error\) return \{ error: r\.error \}\s*\n\s*prima\?\.\(\)\s*\n\s*applicaVersione\(v\)/.test(prov))
  check('l\'utente locale segue la versione cambiata', (prov.match(/passi\.segnaReg\(v\)/g) ?? []).length === 2)
  const segui = file('components/versione/segui-versione.tsx')
  check('SeguiVersione: data-reg dal cookie a ogni cambio di URL, prima del paint, e la regione live',
    /useLayoutEffect\(\(\) => \{ rileggiVersione\(\) \}, \[percorso, query\]\)/.test(segui) && /aria-live="polite"/.test(segui) &&
    /useSearchParams\(\)/.test(segui))
  // un cambio in un'altra scheda: la cache del router e' della versione di prima
  check('...e a un cambio da fuori butta la cache del router, e la pagina senza versione va al gemello',
    /useEffect\(\(\) => alCambioDaFuori\(\(v\) => \{/.test(segui) &&
    /quiPerCambio\(`\$\{location\.pathname\}\$\{location\.search\}`, v, true\)/.test(segui) &&
    /const dove = qui === null \? null : gemello\(qui, v\)/.test(segui) &&
    /if \(dove && testoNonInviato\(\)\) return\s*router\.refresh\(\)\s*if \(dove\) router\.replace\(dove\)/.test(segui))
  check('...ma un testo scritto e non inviato non si perde (textarea e campi di testo di <main>)',
    /export function testoNonInviato\(\)/.test(client) && /main textarea/.test(client) && /c\.value !== c\.defaultValue/.test(client))
  check('...ascoltato solo da visibilitychange e pageshow, non al cambio di URL (quello e\' di questa scheda)',
    /addEventListener\('visibilitychange', seVisibile\)/.test(client) && /addEventListener\('pageshow', daFuori\)/.test(client) &&
    /if \(rileggiVersione\(\)\) \{\s*const v = versioneAttuale\(\)\s*fuori\.forEach/.test(client))

  console.log('\n  -- il burger (sotto i 1024px)')
  const menu = file('components/auth/menu-mobile.tsx')
  check('la prima riga e\' la versione, con l\'etichetta visibile "Game version"',
    /const voci: ReactNode\[\] = \[\s*(?:\/\/[^\n]*\n\s*)*<div key="versione" data-versione className="group grid [^"]*"[^>]*>\s*<span id=\{etichettaVersione\}[^>]*>Game version<\/span>\s*<SceltaVersione\s+variante="menu"\s+etichetta=\{etichettaVersione\}/.test(menu))
  // Un errore arriva anche dopo secondi: una riga in piu' spingerebbe giu'
  // le voci mentre il dito ci va. Prende la cella dell'etichetta, che si
  // nasconde (invisible: il nome del gruppo resta), alta quanto il controllo.
  check('...e un errore prende la cella dell\'etichetta: le voci sotto non si spostano',
    /<span id=\{etichettaVersione\} className="col-start-1 row-start-1 [^"]*group-has-\[\[role=alert\]\]:invisible"/.test(menu) &&
    /menu: 'col-start-1 row-start-1 [^']*leading-tight/.test(scelta) && !/col-span-2/.test(scelta) &&
    !/gap-y-/.test(menu.slice(menu.indexOf('<div key="versione"'), menu.indexOf('<SceltaVersione'))))
  check('un tocco sulla riga della versione non chiude il pannello; il gemello si', /if \(\(e\.target as Element\)\.closest\('\[data-versione\]'\)\) return\s*\n\s*const voce = /.test(menu) &&
    /onNavigato=\{\(\) => \{ setApertoSu\(null\); bottone\.current\?\.focus\(\) \}\}/.test(menu))
  check('Events porta alla home della versione, corrente su tutte e due',
    /<LinkEventi key="events" aria-current=\{suEventi \? 'page' : undefined\}/.test(menu) &&
    /const suEventi = pathname === homeHref\('global'\) \|\| pathname === homeHref\('japan'\)/.test(menu) && !/href="\/events"/.test(menu))
  check('il bottone dice "Menu, Japan version" in Japan', /versione === 'japan' \? 'Menu, Japan version' : 'Menu'/.test(menu))

  console.log('\n  -- l\'header (dai 1024px) e il tag JP')
  const um = file('components/auth/user-menu.tsx')
  const layout = file('app/layout.tsx')
  // Nella parte di destra si spostava: le voci di chi guarda arrivano da
  // /api/me e cambiano larghezza. Accanto a Events niente prima di lui cambia.
  const [iNav, iScelta, iDestra] = [layout.indexOf('Events\n              </LinkEventi>\n            </nav>'),
    layout.indexOf('<div className="max-lg:hidden">\n              <SceltaVersione variante="riga" />\n            </div>'),
    layout.indexOf('<div className="ml-auto shrink-0">')]
  check('dai 1024px l\'interruttore compatto sta nel layout, subito dopo Events e prima della parte di destra',
    iNav > 0 && iScelta > iNav && iDestra > iScelta, `${iNav} ${iScelta} ${iDestra}`)
  check('...e non nella parte di destra, che cambia larghezza con /api/me', !/SceltaVersione/.test(togliCommenti(um)))
  // Sotto i 1024px il nome intero del sito ci sta a 320px con la campanella
  // solo se il tag non prende posto nella riga: sta sull'angolo del burger.
  const cluster = um.slice(um.indexOf('<div className="lg:hidden'), um.indexOf('<MenuMobile />'))
  check('nessun tag JP nella riga accanto alla campanella', !/>\s*JP\s*</.test(cluster) && !/japan:inline/.test(cluster))
  const bottoneMenu = menu.slice(menu.indexOf('<button'), menu.indexOf('</button>'))
  check('sotto, il tag JP sul bottone del burger: solo CSS, decorativo, fuori dal flusso (absolute)',
    /className="group relative inline-flex[^"]*size-9/.test(bottoneMenu) &&
    /\{!aperto && \(\s*<span\s+aria-hidden="true"\s+data-tag-jp=""\s+className="absolute [^"]*hidden japan:inline-flex[^"]*"\s*>\s*JP\s*<\/span>/.test(bottoneMenu))
  // sull'angolo starebbe sopra l'anello del focus: con la tastiera si toglie
  check('...e col focus da tastiera sul bottone il tag si toglie: l\'anello resta intero',
    /className="group relative inline-flex/.test(bottoneMenu) &&
    /data-tag-jp=""\s+className="[^"]*\bgroup-focus-visible:invisible\b[^"]*"/.test(bottoneMenu))
  check('il marchio e "Events" portano alla home della versione', (layout.match(/<LinkEventi\b/g) ?? []).length === 2 &&
    !/href="\/events"/.test(layout))
  check('SeguiVersione nel layout, in un <Suspense> (legge la query)', /<Suspense fallback=\{null\}>\s*<SeguiVersione \/>\s*<\/Suspense>/.test(layout))
  const link = file('components/versione/link-eventi.tsx')
  check('LinkEventi: /events sul server, la home della versione dopo', /href=\{homeHref\(versione \?\? 'global'\)\}/.test(link))

  console.log('\n  -- Settings')
  const settings = file('app/settings/page.tsx')
  const iDisplay = settings.indexOf('>\n          Display\n'), iVer = settings.indexOf('>Game version</h3>'), iArt = settings.indexOf('>Artwork</h3>')
  check('"Game version" e\' la prima riga di Display, prima di Artwork', iDisplay > 0 && iVer > iDisplay && iArt > iVer)
  check('...con lo stesso interruttore', /<SceltaVersione variante="settings" etichetta="versione" \/>/.test(settings) &&
    /<h3 id="versione"/.test(settings))

  console.log('\n  -- gli avvisi: statici, uguali per tutti, solo CSS')
  const avviso = file('components/versione/avviso-versione.tsx')
  check('AvvisoVersione e\' un componente del server (niente \'use client\'), con le classi di avvisoVersione',
    !/'use client'/.test(avviso) && /avvisoVersione\(reg\)/.test(avviso) && /\$\{a\.classe\}/.test(avviso))
  check('...il link all\'altra versione senza prefetch, e "Use ... everywhere"', /prefetch=\{false\}/.test(avviso) &&
    /<UsaVersione v=\{reg\}>\{a\.usa\}<\/UsaVersione>/.test(avviso))
  const usa = file('components/versione/usa-versione.tsx')
  check('UsaVersione: un\'isola che cambia la versione senza lasciare la pagina', /^'use client'/.test(usa) &&
    /useCambiaVersione\(\)/.test(usa) && /annunciaVersione\(annuncioVersione\(v\)\)/.test(usa))
  // il cambio nasconde l'avviso col bottone dentro: il focus non deve cadere in cima al documento
  check('...e prima che l\'avviso sparisca il focus va al titolo della pagina',
    /await cambia\(v, \(\) => focusFuoriDa\(bottone\.current\?\.closest\('\[data-avviso-versione\]'\)/.test(usa) &&
    /avviso\.contains\(document\.activeElement\)/.test(usa) && /querySelector<HTMLElement>\('main h1'\)/.test(usa) &&
    /titolo\.tabIndex = -1/.test(usa) && /titolo\.focus\(\)/.test(usa))
  check('...e l\'avviso ha il segno che UsaVersione cerca', /data-avviso-versione=\{reg\}/.test(avviso))
  // la classe di avvisoVersione per prima: e' quella che il test di next start cerca nell'HTML
  check('...come il banner della sospensione: l\'icona, il titolo in inchiostro, sotto il link e il bottone',
    /className=\{`\$\{a\.classe\} \$\{className\} /.test(avviso) && /<Globe size=\{15\}[^>]*aria-hidden/.test(avviso) &&
    /<span className="font-medium text-inchiostro">\{a\.titolo\}<\/span> \{a\.dettaglio\}/.test(avviso) &&
    /\{a\.link\}\s*<ArrowRight [^>]*aria-hidden \/>/.test(avviso))
  check('..."Use ... everywhere" ha l\'aspetto di un bottone (cambia una scelta), col velo mentre gira',
    /type="button"[\s\S]*className=\{`relative inline-grid h-6 items-center justify-items-center rounded-\[var\(--raggio\)\] border /.test(usa) &&
    /\$\{inCorso \? 'opacity-15' : 'opacity-0'\}/.test(usa))
  // Un errore tardi (la rete) non aggiunge righe: lo dice il bottone, con
  // le due etichette nella stessa cella (la larghezza resta), e il testo
  // intero lo sente il lettore di schermo.
  check('...e l\'errore sta nel bottone: "Try again" con l\'icona, nella stessa cella e larghezza, e il testo intero in un role=alert',
    /<span className=\{`col-start-1 row-start-1 \$\{errore \? 'invisible' : ''\}`\}>\{children\}<\/span>/.test(usa) &&
    /<span className=\{`col-start-1 row-start-1 [^`]*text-str \$\{errore \? '' : 'invisible'\}`\}>\s*<WarningCircle [^>]*aria-hidden[^>]*\/>\s*\{RIPROVA_VERSIONE\}/.test(usa) &&
    /\{errore && <span id=\{`\$\{id\}-errore`\} role="alert" className="sr-only">\{errore\}<\/span>\}/.test(usa) &&
    /aria-describedby=\{errore \? `\$\{id\}-errore` : undefined\}/.test(usa))

  console.log('\n  -- le liste degli eventi')
  const lista = file('components/eventi/lista.tsx')
  check('i chip Version non ci sono piu\'', !/filtro-versione|etichetta="Version"/.test(lista))
  check('l\'avviso sulla lista, verso la stessa vista dell\'altra versione',
    /<AvvisoVersione reg=\{reg\} altra=\{query\(\{ region: altraVersione\(reg\) \}\)\}/.test(lista))
  check('la ricerca tiene la regione (input nascosto) e la nota sulle date per versione restano',
    /\{reg === 'japan' && <input type="hidden" name="region" value=\{reg\} \/>\}/.test(lista) &&
    /Japan dates come from the wiki/.test(lista))
  check('l\'occhiello "Japan version" sulla lista Japan', /\{reg === 'japan' && <p[^>]*>Japan version<\/p>\}/.test(lista))
  const casaJp = file('app/events/japan/page.tsx')
  check('/events/japan: "Japan version", non "Japanese"', !/Japanese/.test(casaJp))

  console.log('\n  -- la pagina dell\'evento')
  const evento = file('components/evento/pagina.tsx')
  check('"Japan version", non piu\' "Japanese version"', /Japan version<\/span>/.test(evento) && !/Japanese/.test(evento))
  // L'avviso e' nell'HTML per tutti (lo nasconde il CSS): un link al gemello
  // di un evento di una versione sola darebbe ai motori una pagina vuota.
  check('l\'altra versione letta in cache, con le altre letture della pagina',
    /const \[clears, totaleFiltrato, perFiltri, missioni, tips, diLa\] = await Promise\.all\(\[/.test(evento) &&
    /getEventCached\(id, altra\),\s*\]\)/.test(evento) && /const conRunDiLa = diLa\?\.status != null/.test(evento))
  check('l\'avviso verso il gemello della vista, solo se di la\' c\'e\' una run',
    /<AvvisoVersione reg=\{reg\} altra=\{gemellaAltra\}/.test(evento) &&
    /const gemellaAltra = conRunDiLa \? gemello\(corrente, altra\) : null/.test(evento))
  check('senza run qui: la nota onesta, col link esplicito solo se di la\' c\'e\' una run',
    /const senza = senzaDate\(reg\)/.test(evento) &&
    /<span className="font-medium text-inchiostro">\{senza\.etichetta\}<\/span>\s*<span className="ml-2 text-tenue">\{senza\.dettaglio\}<\/span>/.test(evento) &&
    /const versioneAltra = !e\.status && conRunDiLa \? eventHref\(\{ id: e\.id, reg: altra, tier: view\.tier, explicit: true \}\) : null/.test(evento) &&
    /\{linkAltraVersione\(reg\)\}/.test(evento))
  // Chi e' sull'altra versione ha gia' il link di la' nell'avviso: il
  // secondo, a un dito, sarebbe lo stesso scopo due volte.
  check('...e quel link solo a chi non vede l\'avviso (classeVersione(reg), il rovescio dell\'avviso)',
    /\{versioneAltra && \(\s*<p className=\{`mt-1\.5 text-\[13px\] \$\{classeVersione\(reg\)\}`\}>/.test(evento) &&
    avvisoVersione('japan').classe === classeVersione('global') && avvisoVersione('global').classe === classeVersione('japan'))
  check('il titolo Japan finisce con "(Japan)"', /view\.reg === 'japan' \? `\$\{e\.name\} \(Japan\)` : e\.name/.test(evento))
  check('il builder: "not started yet in the Japan version"', !/Japanese/.test(file('app/events/[id]/submit/page.tsx')))

  console.log('\n  -- la pagina della carta')
  const carta = file('components/cards/pagina.tsx')
  check('un blocco di clear per versione, con classeVersione', /classeVersione\(b\.reg, clears\.length\)/.test(carta) &&
    /clears\.map\(\(b\) =>/.test(carta))
  check('"Not released on Global yet" solo a chi e\' su Global', /text-oro japan:hidden">Not released on Global yet\./.test(carta))
  check('...e lo specchio solo a chi e\' su Japan', /hidden [^"]*japan:block">No Japan release date on the wiki yet\./.test(carta) &&
    /\{globale && !giapponese && \(/.test(carta))
  check('la pagina legge i clear di ogni versione dove la carta e\' uscita',
    /versioniCarta\(card\.releases\)\.map\(async \(reg\) =>/.test(file('app/cards/[id]/page.tsx')))
  const conCarta = file('components/cards/clear-con-carta.tsx')
  check('i link ai clear nei blocchi dicono la versione', /explicit: true/.test(conCarta))
  // chi guarda vede un blocco solo: "nessun clear" deve dire di quale versione
  check('con due blocchi, quello vuoto dice la versione e porta al migliore dell\'altra',
    /perVersione=\{clears\.length > 1\}/.test(carta) &&
    /const altro = clears\.find\(\(o\) => o\.reg !== b\.reg && o\.rows\.length > 0\)/.test(carta) &&
    /altra=\{altro \? \{ reg: altro\.reg, totale: altro\.total, primo: altro\.rows\[0\] \} : null\}/.test(carta) &&
    /No \{perVersione && `\$\{REGIONE\[reg\]\} `\}clears use this card yet\./.test(conCarta) &&
    /On \{REGIONE\[altra\.reg\]\} it&apos;s in/.test(conCarta) && /href=\{hrefClear\(altra\.primo, altra\.reg\)\}/.test(conCarta))
}

pagine()
cambio()
redirect()
testi()
contrasti()
guardieCss()
guardieComponenti()

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
