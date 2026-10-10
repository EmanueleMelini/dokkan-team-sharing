// I segnaposto delle immagini (lib/segnaposto.ts, components/segnaposto.tsx):
// cosa mostra una carta senza miniatura e un evento senza immagine.
//
//   - l'iniziale, il settore del tipo nell'ordine del marchio, quando si
//     scrivono iniziale e rarita';
//   - le icone e le etichette di ogni event_kind (0001, 0007);
//   - i contrasti in tutti gli 11 temi: la banda del tipo (i colori fissi
//     del marchio, variante chiara o scura come la sceglie il CSS, e quella
//     neutra di un tipo sconosciuto) e il testo del riquadro su --superficie-2;
//   - i colori del marchio in app/globals.css, una volta sola: niente
//     <style> nei componenti, che finirebbe nel payload a ogni riquadro;
//   - le guardie sui file: chi mostra miniature e immagini usa i
//     segnaposto, i vecchi riquadri vuoti non ci sono piu', il componente
//     resta senza sessione e senza niente del wiki, tipo e classe accanto
//     al nome dove il riquadro e' piccolo, e quella del builder non finisce
//     nel payload;
//   - la geometria vera: la rarita' non tocca l'iniziale e non finisce
//     sotto l'etichetta Leader/Friend.
//
// Funzioni pure e file, niente database.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ETICHETTA_EVENTO, INIZIALE_DA, RARITA_DA, TIPI_MARCHIO,
  inizialeCarta, segnapostoCarta, segnapostoEvento, settoreTipo, tipoPerEsteso,
  type AngoloRarita, type SegnapostoCarta,
} from '@/lib/segnaposto'
import { TEMI, TEMA_IDS } from '@/lib/tema/temi'
import { payloadDa, reducer, statoVuoto, type CartaScelta } from '@/lib/clears/builder-stato'
import { differenzeMarchio, regoleMarchio } from '@/scripts/brand/colori.mjs'

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
const leggi = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------
//  Le funzioni pure
// ---------------------------------------------------------------------

console.log('\n  -- l\'iniziale')
vale('Super Saiyan Goku', inizialeCarta('Super Saiyan Goku'), 'S')
vale('minuscola: in maiuscolo', inizialeCarta('goku'), 'G')
vale('le parentesi si saltano', inizialeCarta('(Clone) X'), 'C')
vale('giapponese', inizialeCarta('則巻アラレ'), '則')
vale('accentata', inizialeCarta('éclair'), 'É')
vale('una cifra', inizialeCarta('#17 Android'), '1')
vale('"ß" resta una lettera sola', inizialeCarta('ßeta'), 'ß')
vale('vuota', inizialeCarta(''), '?')
vale('null', inizialeCarta(null), '?')
vale('solo simboli', inizialeCarta('() - !'), '?')

console.log('\n  -- il settore del tipo')
// L'ordine e' quello scritto nel commento in cima a marchio.tsx: "cinque
// settori, uno per tipo (AGL TEQ INT STR PHY in senso orario dall'alto)".
const marchioTsx = leggi('components/brand/marchio.tsx')
const commento = /uno per tipo \(([^)]*)\)/.exec(marchioTsx)?.[1] ?? ''
const ordineMarchio = commento.match(/\b[A-Z]{3}\b/g) ?? []
vale('TIPI_MARCHIO nell\'ordine dei settori del marchio', [...TIPI_MARCHIO], ordineMarchio)
vale('settoreTipo: AGL 1 ... PHY 5', TIPI_MARCHIO.map(settoreTipo), [1, 2, 3, 4, 5])
vale('settoreTipo: vuoto, sconosciuto, minuscolo, null: 0',
  ['', 'XYZ', 'agl', null, undefined].map(settoreTipo), [0, 0, 0, 0, 0])

console.log('\n  -- iniziale e rarita\' secondo la misura')
const s16 = segnapostoCarta({ name: 'Goku', type: 'STR', rarity: 'LR', size: 16 })
vale('16 px: solo la banda, di 4 px', [s16.mostraIniziale, s16.rarita, s16.settore, s16.banda], [false, null, 4, 4])
vale('la banda: un sedicesimo del lato, almeno 2 px',
  [24, 32, 40, 44, 48, 160].map((size) => segnapostoCarta({ name: 'X', type: 'AGL', size }).banda), [2, 2, 3, 3, 3, 10])
vale(`sotto ${INIZIALE_DA} px niente iniziale`, segnapostoCarta({ name: 'Goku', type: 'AGL', size: INIZIALE_DA - 1 }).mostraIniziale, false)
vale(`da ${INIZIALE_DA} px l'iniziale`, segnapostoCarta({ name: 'Goku', type: 'AGL', size: INIZIALE_DA }).mostraIniziale, true)
vale(`sotto ${RARITA_DA} px niente rarita'`, segnapostoCarta({ name: 'Goku', type: 'AGL', rarity: 'UR', size: RARITA_DA - 1 }).rarita, null)
vale(`da ${RARITA_DA} px la rarita'`, segnapostoCarta({ name: 'Goku', type: 'AGL', rarity: 'UR', size: RARITA_DA }).rarita, 'UR')
vale('tutte e sole le rarita\' del gioco',
  ['N', 'R', 'SR', 'SSR', 'UR', 'LR', 'XR', 'ur', '', null].map((r) => segnapostoCarta({ name: 'X', type: 'TEQ', rarity: r, size: 48 }).rarita),
  ['N', 'R', 'SR', 'SSR', 'UR', 'LR', null, null, null, null])
vale('48 px, tutto', segnapostoCarta({ name: 'Transcendent Existence Buu (Kid)', type: 'INT', rarity: 'LR', size: 48 }),
  { iniziale: 'T', settore: 3, rarita: 'LR', mostraIniziale: true, banda: 3,
    corpoIniziale: 20, corpoRarita: 9, posRarita: { bottom: 1 } })
vale('48 px con la rarita\' in alto: subito sotto la banda',
  segnapostoCarta({ name: 'Buu', type: 'INT', rarity: 'LR', size: 48, angolo: 'alto' }).posRarita, { top: 3 })
vale('un tipo sconosciuto (carta nota solo dall\'URL): settore 0, banda neutra',
  segnapostoCarta({ name: null, type: '', size: 32 }), { iniziale: '?', settore: 0, rarita: null, mostraIniziale: true, banda: 2,
    corpoIniziale: 13, corpoRarita: 9, posRarita: { bottom: 1 } })

console.log('\n  -- tipo e classe per esteso (i lettori di schermo)')
vale('Super, Extreme, senza classe', [tipoPerEsteso('AGL', 'Super'), tipoPerEsteso('INT', 'Extreme'), tipoPerEsteso('PHY', null),
  tipoPerEsteso('TEQ', '')], ['Super AGL', 'Extreme INT', 'PHY', 'TEQ'])
// La stessa regola di components/tipo.tsx: S per Super, E per tutto il resto
const tipoTsx = leggi('components/tipo.tsx')
check('la stessa regola della forma breve di Tipo', /classe === 'Super' \? 'S' : 'E'/.test(tipoTsx) &&
  /classe === 'Super' \? 'Super' : 'Extreme'/.test(leggi('lib/segnaposto.ts')))

console.log('\n  -- gli eventi')
// Ogni valore di event_kind, dalle migrazioni: 0001 lo crea, 0007 aggiunge 'other'
const enumKind = /create type event_kind as enum \(([^)]*)\)/.exec(leggi('db/migrations/0001_schema.sql'))?.[1] ?? ''
const aggiunti = [...leggi('db/migrations/0007_event_import.sql').matchAll(/alter type event_kind add value if not exists '([^']+)'/g)]
  .map((m) => m[1])
const kinds = [...[...enumKind.matchAll(/'([^']+)'/g)].map((m) => m[1]), ...aggiunti]
check('event_kind letto dalle migrazioni', kinds.length >= 14 && kinds.includes('other') && kinds.includes('zbattle'), kinds.join())
const ICONE = new Set(['lampo', 'trofeo', 'libro', 'clessidra', 'regalo', 'medaglia', 'calendario'])
const senza = kinds.filter((k) => {
  const e = segnapostoEvento(k)
  return !ICONE.has(e.icona) || !e.etichetta
})
check('ogni event_kind ha un\'icona e un\'etichetta', senza.length === 0, senza.join())
// Le etichette di prima (TIPO_EVENTO in components/evento/pagina.tsx)
const PRIMA: Record<string, string> = {
  challenge: 'Challenge', zbattle: 'Extreme Z-Battle', limited: 'Limited', story: 'Story',
  bonus: 'Bonus', world_tournament: 'World Tournament', other: 'Event',
}
vale('ETICHETTA_EVENTO e\' la vecchia TIPO_EVENTO', ETICHETTA_EVENTO, PRIMA)
vale('ogni event_kind ha la stessa etichetta di prima (Event per quelli senza)',
  kinds.map((k) => segnapostoEvento(k).etichetta), kinds.map((k) => PRIMA[k] ?? 'Event'))
vale('le icone dei tipi della lista',
  ['zbattle', 'challenge', 'story', 'limited', 'bonus', 'world_tournament'].map((k) => segnapostoEvento(k).icona),
  ['lampo', 'trofeo', 'libro', 'clessidra', 'regalo', 'medaglia'])
vale('il resto: il calendario e "Event"',
  ['other', 'db_story', 'pettan', '', null, 'constructor', 'toString'].map((k) => segnapostoEvento(k)),
  Array(7).fill({ icona: 'calendario', etichetta: 'Event' }))
// La lista degli eventi ha le sue etichette per i filtri: devono dire lo stesso
const listaTsx = leggi('components/eventi/lista.tsx')
const tipiLista = [...listaTsx.matchAll(/\{ valore: '([^']+)', etichetta: '([^']+)' \}/g)].map((m) => [m[1], m[2]])
check('i tipi dei filtri della lista hanno le stesse etichette', tipiLista.length === 5 &&
  tipiLista.every(([k, e]) => ETICHETTA_EVENTO[k] === e), mostra(tipiLista))

// ---------------------------------------------------------------------
//  I contrasti, tema per tema
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
const css = leggi('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
const blocchi: Blocco[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selettori: (m[1].split(';').pop() ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  props: new Map(m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return [d.slice(0, i).trim(), d.slice(i + 1).trim().toLowerCase()] as [string, string]
  })),
}))
const temiCss = new Map<string, Blocco>()
for (const b of blocchi) {
  for (const s of b.selettori) {
    const m = /^\[data-theme="([^"]+)"\]$/.exec(s)
    if (m) temiCss.set(m[1], b)
  }
}
const sistemaScuro = blocchi.find((b) => b.selettori.includes(':root:not([data-theme])'))

// Le tavolozze del marchio e i temi scuri, dalle regole di app/globals.css
// (scripts/brand/colori.mjs, lo stesso parser di genera.mjs)
const globalsCss = leggi('app/globals.css')
const regole = regoleMarchio(globalsCss)
const CHIARO = regole.chiaro
const SCURO = regole.scuro
const TEMI_SCURI = new Set(regole.temiScuri)

console.log('\n  -- i colori del marchio')
check('tre regole, da 6 colori l\'una (5 settori e il disco)', CHIARO.size === 6 && SCURO.size === 6 && regole.scuroSistema.size === 6,
  `${CHIARO.size}, ${regole.scuroSistema.size} e ${SCURO.size}`)
vale('la variante scura e\' la stessa col sistema scuro e con un tema scuro', [...regole.scuroSistema], [...SCURO])
const scuriCss = [...temiCss].filter(([, b]) => b.props.get('color-scheme') === 'dark').map(([id]) => id).sort()
vale('i temi scuri della regola del marchio = i temi con color-scheme: dark', [...TEMI_SCURI].sort(), scuriCss)
// Lo stesso controllo di scripts/brand/genera.mjs, senza rigenerare
// niente: i `d` degli SVG in marchio.tsx, i colori in globals.css
const diverse = differenzeMarchio(fileURLToPath(new URL('../../', import.meta.url)))
check('marchio.tsx e globals.css coincidono ancora con gli SVG sorgente', diverse.length === 0, diverse.join('; '))
// Il CSS una volta sola, nel foglio di stile: uno <style> nel componente
// finiva nel payload RSC delle pagine in cache, una copia per riquadro
check('le regole valgono per .marchio e .colori-marchio insieme, e solo in globals.css',
  (css.match(/:is\(\.marchio, \.colori-marchio\)/g) ?? []).length === 3 &&
  /(^|\})\s*\.marchio,\s*\.colori-marchio\s*\{/.test(css) &&
  !/--marchio-\d\s*:|<style\b/.test(marchioTsx.replace(/\/\*[\s\S]*?\*\//g, '')))

console.log('\n  -- i contrasti su --superficie-2 (WCAG 2.x)')
// System vale due volte: chiaro (:root, cioe' Light) e scuro (il blocco
// dentro prefers-color-scheme: dark), con la variante del marchio che il
// CSS sceglie in ciascun caso.
const casi: { id: string; blocco: Blocco | undefined; tavolozza: Map<number, string> }[] = TEMI.flatMap((t) =>
  t.id === 'system'
    ? [
        { id: 'system (chiaro)', blocco: temiCss.get('light'), tavolozza: CHIARO },
        { id: 'system (scuro)', blocco: sistemaScuro, tavolozza: SCURO },
      ]
    : [{ id: t.id, blocco: temiCss.get(t.id), tavolozza: TEMI_SCURI.has(t.id) ? SCURO : CHIARO }])
check('un caso per ogni tema, System due volte', casi.length === TEMA_IDS.length + 1 && casi.every((c) => !!c.blocco),
  casi.filter((c) => !c.blocco).map((c) => c.id).join())
const minimi = { banda: Infinity, inchiostro: Infinity, tenue: Infinity }
for (const { id, blocco, tavolozza } of casi) {
  if (!blocco) continue
  const tk = (n: string) => blocco.props.get(`--${n}`) ?? '#000000'
  const fondo = tk('superficie-2')
  // le cinque del marchio e quella neutra di un tipo sconosciuto (--tenue)
  const bande = [...TIPI_MARCHIO.map((tipo, i) => [tipo, contrasto(tavolozza.get(i + 1) ?? '#000000', fondo)] as const),
                 ['neutra', contrasto(tk('tenue'), fondo)] as const]
  const basse = bande.filter(([, r]) => !(r >= 3)).map(([tipo, r]) => `${tipo} ${r.toFixed(2)}`)
  check(`${id}: le sei bande (cinque tipi e la neutra) almeno 3:1 su superficie-2`, basse.length === 0,
    basse.join('; ') || `min ${Math.min(...bande.map(([, r]) => r)).toFixed(2)}`)
  const ink = contrasto(tk('inchiostro'), fondo)
  const ten = contrasto(tk('tenue'), fondo)
  check(`${id}: l'iniziale (inchiostro) almeno 4.5:1, la rarita' (tenue) almeno 4.5:1`, ink >= 4.5 && ten >= 4.5,
    `${ink.toFixed(2)}, ${ten.toFixed(2)}`)
  // "Artwork not available yet" sotto il riquadro grande sta su superficie
  const tenSup = contrasto(tk('tenue'), tk('superficie'))
  check(`${id}: tenue almeno 4.5:1 anche su superficie`, tenSup >= 4.5, tenSup.toFixed(2))
  minimi.banda = Math.min(minimi.banda, ...bande.map(([, r]) => r))
  minimi.inchiostro = Math.min(minimi.inchiostro, ink)
  minimi.tenue = Math.min(minimi.tenue, ten)
}
console.log(`  minimi: banda ${minimi.banda.toFixed(2)}, inchiostro ${minimi.inchiostro.toFixed(2)}, tenue ${minimi.tenue.toFixed(2)}`)

// ---------------------------------------------------------------------
//  Le guardie sui file
// ---------------------------------------------------------------------

console.log('\n  -- chi mostra una miniatura o un\'immagine di evento usa i segnaposto')
const USANO = [
  'components/carta.tsx', 'components/builder/miniatura.tsx', 'components/cards/catena.tsx',
  'components/cards/art-toggle.tsx', 'components/profile/riga-clear.tsx', 'components/missioni.tsx',
  'components/eventi/lista.tsx', 'components/evento/pagina.tsx',
]
const senzaImport = USANO.filter((f) => !/from '@\/components\/segnaposto'/.test(leggi(f)))
check(`gli ${USANO.length} file importano components/segnaposto`, senzaImport.length === 0, senzaImport.join())
const vecchi: [string, RegExp][] = [
  ['components/carta.tsx', /w-12 h-12 rounded-\[var\(--raggio\)\] bg-superficie-2 border border-linea/],
  ['components/cards/catena.tsx', /block w-12 h-12 rounded-\[var\(--raggio\)\] bg-superficie-2/],
  ['components/profile/riga-clear.tsx', /block size-8 rounded-\[var\(--raggio\)\] bg-superficie-2/],
  ['components/cards/art-toggle.tsx', /<Tipo\b/],
  ['components/evento/pagina.tsx', /TIPO_EVENTO/],
]
// Senza i commenti, che queste cose le nominano per dire che non ci sono
const senzaCommenti = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
// Il corpo di una funzione esportata, fino alla export dopo
const funzione = (testo: string, nome: string) => {
  const i = testo.indexOf(`export function ${nome}(`)
  if (i < 0) return ''
  const j = testo.indexOf('\nexport ', i + 1)
  return testo.slice(i, j < 0 ? undefined : j)
}
const miniaturaTsx = senzaCommenti(leggi('components/builder/miniatura.tsx'))
const restano = vecchi.filter(([f, re]) => re.test(leggi(f))).map(([f]) => f)
if (/<Tipo\b/.test(funzione(miniaturaTsx, 'Miniatura')) || !funzione(miniaturaTsx, 'Miniatura')) restano.push('Miniatura')
check('i vecchi riquadri vuoti (e la Tipo al posto della miniatura) non ci sono piu\'', restano.length === 0, restano.join())

console.log('\n  -- il componente: niente sessione, niente wiki, niente immagini')
const comp = senzaCommenti(leggi('components/segnaposto.tsx'))
const puro = senzaCommenti(leggi('lib/segnaposto.ts'))
check('components/segnaposto.tsx senza \'use client\', next/headers, useViewer, hook',
  !/['"]use client['"]/.test(comp) && !/next\/headers/.test(comp) && !/useViewer/.test(comp) && !/\buse[A-Z]\w*\(/.test(comp))
check('...senza <img>, next/image o URL', !/<img\b/i.test(comp) && !/next\/image/.test(comp) && !/https?:\/\//.test(comp))
check('niente wiki (wikia, fandom, nocookie) nel componente e nel modulo',
  ![comp, puro].some((t) => /wikia|fandom|nocookie/i.test(t)))
check('lib/segnaposto.ts senza import (modulo puro)', !/^\s*import\b/m.test(puro))
check('il riquadro della carta e\' decorativo, o un\'immagine col nome con etichetta',
  /'aria-hidden': true/.test(comp) && /role: 'img', 'aria-label': etichetta/.test(comp))
check('la banda usa i colori del marchio, non i token del tema',
  /colori-marchio/.test(comp) && /var\(--marchio-\$\{s\.settore\}\)/.test(comp))
const conStile = ['components/segnaposto.tsx', 'components/brand/marchio.tsx', ...USANO]
  .filter((f) => /<style\b|ColoriMarchio/.test(senzaCommenti(leggi(f))))
check('...senza uno <style> per riquadro: i colori stanno in globals.css', conStile.length === 0, conStile.join())
check('...e la neutra il grigio di --tenue (quello che il contrasto qui sopra prova)',
  /: 'var\(--tenue\)'/.test(comp) && !/linea-forte/.test(comp))

console.log('\n  -- la geometria: la rarita\' non tocca l\'iniziale e non sta sotto Leader/Friend')
// In px dal bordo esterno del riquadro, come lo disegna il componente: un
// quadrato di `size` (border-box) con il bordo di 1 px, l'iniziale
// centrata, i testi con leading-none (alti quanto il corpo), la rarita'
// dove dice posRarita.
check('il componente usa le misure di segnapostoCarta', /border border-linea/.test(comp) &&
  /items-center justify-center/.test(comp) && /leading-none text-inchiostro" style=\{\{ fontSize: s\.corpoIniziale \}\}/.test(comp) &&
  /absolute left-1 leading-none text-tenue"\s*style=\{\{ fontSize: s\.corpoRarita, \.\.\.s\.posRarita \}\}/.test(comp))
const BORDO = 1
type Riga = [number, number]
const rigaRarita = (size: number, s: SegnapostoCarta): Riga => 'top' in s.posRarita
  ? [BORDO + s.posRarita.top, BORDO + s.posRarita.top + s.corpoRarita]
  : [size - BORDO - s.posRarita.bottom - s.corpoRarita, size - BORDO - s.posRarita.bottom]
const rigaIniziale = (size: number, s: SegnapostoCarta): Riga => [size / 2 - s.corpoIniziale / 2, size / 2 + s.corpoIniziale / 2]
const staccate = (a: Riga, b: Riga) => a[1] <= b[0] || b[1] <= a[0]
const prova = (size: number, angolo: AngoloRarita) => segnapostoCarta({ name: 'W', type: 'AGL', rarity: 'SSR', size, angolo })

// Ogni riquadro con la rarita', come lo scrivono i file: la misura e
// l'angolo del segnaposto, o la misura che i chiamanti danno a Miniatura
// (44 per difetto)
const riquadri: { dove: string; size: number; angolo: AngoloRarita }[] = []
for (const f of USANO) {
  for (const [jsx] of leggi(f).matchAll(/<SegnapostoCarta\b[^>]*\/>/g)) {
    const size = /size=\{(\d+)\}/.exec(jsx)?.[1]
    if (!/rarity=/.test(jsx) || !size) continue
    riquadri.push({ dove: f, size: Number(size), angolo: /angolo="alto"/.test(jsx) ? 'alto' : 'basso' })
  }
}
for (const f of ['components/builder/slot.tsx', 'components/clears/scegli-carta.tsx', 'components/builder/picker-risultati.tsx']) {
  for (const [jsx] of leggi(f).matchAll(/<Miniatura\b[^>]*\/>/g)) {
    riquadri.push({ dove: f, size: Number(/size=\{(\d+)\}/.exec(jsx)?.[1] ?? 44), angolo: 'basso' })
  }
}
check('i riquadri con la rarita\': Carta, la catena, l\'artwork, slot, filtri e picker', riquadri.length === 6,
  riquadri.map((c) => `${c.dove.split('/').pop()} ${c.size} ${c.angolo}`).join(', '))
for (const { dove, size, angolo } of riquadri.filter((c) => c.size >= RARITA_DA)) {
  const s = prova(size, angolo), r = rigaRarita(size, s), ini = rigaIniziale(size, s)
  check(`${dove.split('/').pop()}, ${size} px, ${angolo}: la rarita\' dentro il riquadro, sotto la banda, staccata dall'iniziale`,
    r[0] >= BORDO + s.banda && r[1] <= size - BORDO && staccate(r, ini), `rarita' ${r.join('-')}, iniziale ${ini.join('-')}`)
}

// L'etichetta del ruolo in Carta, dalle sue classi: sporge di -bottom-N
// (N per 4 px), ed e' alta una riga piu' padding e bordo. La riga la
// eredita da fuori: qui fra il corpo (leading-none) e il doppio del corpo.
const cartaTsx = senzaCommenti(leggi('components/carta.tsx'))
const et = /<span className="absolute -bottom-(\d+) -right-\d+ ([^"]*)">\s*\{etichetta\}/.exec(cartaTsx)
const classi = et?.[2] ?? ''
const sporge = Number(et?.[1]) * 4
const corpoEt = Number(/\btext-\[(\d+)px\]/.exec(classi)?.[1])
const padEt = /(^|\s)py-px(\s|$)/.test(classi) ? 1 : NaN
const bordoEt = /(^|\s)border(\s|$)/.test(classi) ? 1 : 0
const cimaEt = (riga: number) => 48 + sporge - (riga + 2 * padEt + 2 * bordoEt)
check('l\'etichetta del ruolo in basso a destra, con le misure lette dalle classi',
  !!et && [sporge, corpoEt, padEt].every(Number.isFinite), classi)
const inCarta = riquadri.filter((c) => c.dove === 'components/carta.tsx')
check('Carta: un segnaposto da 48 px, con la rarita\' (ci si scrive) in alto', inCarta.length === 1 && inCarta[0].size === 48 &&
  48 >= RARITA_DA && inCarta[0].angolo === 'alto', mostra(inCarta))
const rAlto = rigaRarita(48, prova(48, inCarta[0]?.angolo ?? 'basso'))
check('...sopra l\'etichetta anche con la riga piu\' alta', rAlto[1] <= cimaEt(2 * corpoEt),
  `rarita' ${rAlto.join('-')}, etichetta da ${cimaEt(2 * corpoEt)}`)
// La prova che l'angolo conta: in basso, dov'era, l'etichetta (larga quasi
// quanto il riquadro) la coprirebbe anche con la riga piu' bassa
const rBasso = rigaRarita(48, prova(48, 'basso'))
check('...mentre in basso la coprirebbe', rBasso[1] > cimaEt(corpoEt), `rarita' ${rBasso.join('-')}, etichetta da ${cimaEt(corpoEt)}`)

console.log('\n  -- tipo e classe accanto al nome, dove il riquadro e\' piccolo')
// Nello slot del builder (40 px) e nel menu "Uses card" (32 px) il
// riquadro di prima scriveva "SAGL"; il segnaposto no: lo scrive chi lo usa
const tipoAccanto = funzione(miniaturaTsx, 'TipoSenzaMiniatura')
check('TipoSenzaMiniatura: niente con la miniatura del gioco, che il tipo lo mostra da se\'',
  /if \(carta\.thumb\) return null/.test(tipoAccanto))
check('...a vista "SAGL" (Tipo), per i lettori di schermo "Super AGL"',
  /<span aria-hidden><Tipo tipo=\{carta\.type\} classe=\{carta\.class\} \/><\/span>/.test(tipoAccanto) &&
  /<span className="sr-only">, \{tipoPerEsteso\(carta\.type, carta\.class\)\}<\/span>/.test(tipoAccanto))
for (const [f, size] of [['components/builder/slot.tsx', 40], ['components/clears/scegli-carta.tsx', 32]] as const) {
  const t = senzaCommenti(leggi(f))
  check(`${f.split('/').pop()}: accanto alla miniatura da ${size} px c'e' TipoSenzaMiniatura`,
    new RegExp(`<Miniatura carta=\\{(\\w+)\\} size=\\{${size}\\} />[\\s\\S]*<TipoSenzaMiniatura carta=\\{\\1\\} />`).test(t))
}

console.log('\n  -- la rarita\' del builder resta fuori dal payload')
const carta: CartaScelta = { id: 1034150, name: 'Buu (Kid)', epithet: null, type: 'INT', class: 'Extreme', thumb: null, rarity: 'LR' }
const stato = reducer(statoVuoto('42'), { t: 'carta', l: 0, i: 0, carta })
check('la carta nello stato tiene la rarita\' (per il segnaposto)', stato.squadre[0].slots[0].carta?.rarity === 'LR')
const payload = JSON.stringify(payloadDa(stato))
check('il payload non la porta', !/rarity|"LR"/.test(payload) && payload.includes('1034150'), payload.slice(0, 160))

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
