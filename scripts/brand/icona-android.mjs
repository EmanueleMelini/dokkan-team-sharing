#!/usr/bin/env node
// L'icona dell'app Android (android/), generata dal marchio del sito come
// public/offline.html: l'adaptive icon di android/app/src/main/res/ e la
// bolla sopra il gioco, cioe'
//
//   drawable/ic_launcher_foreground.xml     l'Anello Ki a colori con la lente
//   drawable/ic_launcher_monochrome.xml     le stesse forme in un colore (icone a tema)
//   mipmap-anydpi/ic_launcher.xml           i tre livelli
//   values/ic_launcher_background.xml       il fondo della maskable del sito
//   drawable/ic_bubble_foreground.xml       il primo piano per la bolla sopra il gioco
//
//   node scripts/brand/icona-android.mjs           scrive i file che cambiano
//   node scripts/brand/icona-android.mjs --check   non scrive: esce 1 se vanno rigenerati
//
// Anche genera.mjs (npm run brand) li riscrive, e db/test/android-icon.test.mjs
// controlla che quelli versionati siano quelli che uscirebbero adesso: se
// cambia il marchio (sorgenti.mjs, poi gli SVG) l'icona dell'app non resta
// indietro.
//
// La bolla sopra il gioco e la sua anteprima nelle impostazioni
// (BubbleOverlay e BubblePreview) disegnano ic_bubble_foreground sul colore
// ic_launcher_background: lo stesso primo piano ritagliato ai 72dp che il
// launcher mostra, cosi' il marchio riempie la bolla come riempie l'icona
// sulla home. Con tutti i 108dp del canvas il marchio occupava meta' della
// bolla e la lente, a 36dp, era di meno di 5dp.
//
// La sorgente e' scripts/brand/svg/maskable.svg, l'icona che Android ritaglia
// gia' per la PWA: il fondo, i cinque `d` dei settori e i colori della
// variante scura, quella che si legge su quel fondo. I `d` entrano nel vettore
// cosi' come sono, dentro un <group> che li scala: niente coordinate
// ricalcolate che possano allontanarsi dal marchio. I colori sono fissi come
// nel sito (non seguono il tema del telefono); solo il livello monocromo
// prende il colore che sceglie il launcher.
//
// Il disco oro al centro diventa una lente dello stesso raggio e dello stesso
// oro, con il manico a 45 gradi verso il basso a destra: il "cerca" dell'app.
// Lente e manico stanno dentro il foro dell'anello, centrati sul centro del
// marchio, e i settori restano quelli del sito.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const RES = 'android/app/src/main/res'

/** I file che scrive, relativi alla radice del repository. */
export const FILE = {
  primoPiano: `${RES}/drawable/ic_launcher_foreground.xml`,
  monocromo: `${RES}/drawable/ic_launcher_monochrome.xml`,
  icona: `${RES}/mipmap-anydpi/ic_launcher.xml`,
  fondo: `${RES}/values/ic_launcher_background.xml`,
  bolla: `${RES}/drawable/ic_bubble_foreground.xml`,
}

// Il canvas dell'adaptive icon e' di 108dp: il launcher ne mostra i 72
// centrali sotto la sua maschera (cerchio, squircle, quadrato arrotondato) e
// garantisce solo il cerchio di 66dp al centro, la zona sicura.
export const CANVAS = 108
export const ZONA_SICURA = 33
/** Il lato del quadrato che il launcher mostra, e quello del vettore della bolla. */
export const VISTA = 72

// Il marchio (viewBox 64) a scala 0.875: l'anello esterno (raggio 30) arriva
// a 26.25dp, dentro i 33 della zona sicura con aria attorno, e il centro
// (32, 32) cade a 54. A scala 1 sotto la maschera tonda l'anello toccava
// quasi il bordo; piu' piccolo, a 48dp tagli e lente si leggevano peggio.
export const SCALA = 0.875

// La lente, in unita' del marchio. Il raggio esterno e' quello del disco oro
// (8). Vetro e manico poco piu' spessi del taglio tra i settori (3.2,
// MARCHIO in sorgenti.mjs): piu' sottili a 48dp quasi sparivano, piu' spessi
// chiudevano il foro della lente. `sporgenza` e' quanto il manico esce dalla
// lente, fino alla fine dell'estremita' tonda; `angolo` e' in gradi dall'alto
// in senso orario, come i settori di anello.mjs.
export const LENTE = { spessore: 3.4, manico: 3.8, sporgenza: 10, angolo: 135 }

// Lo spazio minimo tra la lente (o il manico) e i settori: almeno il taglio
// tra due settori, perche' il manico non sembri attaccato all'anello.
export const MARGINE = 3.2

const arrotonda = (n) => Number(n.toFixed(2))

/**
 * Fondo, settori, disco e raggi dell'anello dal testo di maskable.svg.
 * @param {string} svg
 */
export function sorgenteMarchio(svg) {
  const fondo = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1]
  const settori = [...svg.matchAll(/<path fill="(#[0-9a-f]{6})" d="([^"]+)"/gi)]
    .map(([, colore, d]) => ({ colore: colore.toLowerCase(), d }))
  const disco = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="(#[0-9a-f]{6})"/i.exec(svg)
  if (!fondo || settori.length !== 5 || !disco) throw new Error('maskable.svg: attesi il fondo, 5 settori e il disco')
  // Ogni settore ha due archi: il primo sul cerchio esterno, il secondo
  // sull'interno (anello.mjs).
  const raggi = [...settori[0].d.matchAll(/A([\d.]+) /g)].map((m) => Number(m[1]))
  if (raggi.length !== 2) throw new Error(`maskable.svg: attesi due archi nel settore, trovati ${raggi.length}`)
  return {
    fondo: fondo.toLowerCase(),
    settori,
    nucleo: { cx: Number(disco[1]), cy: Number(disco[2]), r: Number(disco[3]), colore: disco[4].toLowerCase() },
    esterno: raggi[0],
    interno: raggi[1],
  }
}

/**
 * La lente e il manico al posto del disco: due `d` in unita' del marchio, e
 * `raggio`, la distanza massima dal centro del marchio.
 *
 * Il vetro e' un anello (cerchio esterno in un verso, interno nell'altro: con
 * la regola nonzero di SVG e di Android il centro resta vuoto). Il manico e'
 * un rettangolo con la punta tonda che parte a meta' dello spessore del
 * vetro: il suo inizio quadrato resta coperto dal vetro. Il gruppo e' spostato
 * indietro di meta' sporgenza, cosi' lente e manico sono centrati sul marchio.
 */
export function lente(nucleo, { spessore, manico, sporgenza, angolo } = LENTE) {
  const t = (angolo * Math.PI) / 180
  const u = [Math.sin(t), -Math.cos(t)] // verso il manico (la y di SVG va in giu')
  const v = [-u[1], u[0]]
  const k = sporgenza / 2
  const c = [nucleo.cx - k * u[0], nucleo.cy - k * u[1]]
  const fuori = nucleo.r
  const dentro = fuori - spessore
  const cerchio = (r, verso) => {
    const [x0, x1, y] = [c[0] - r, c[0] + r, c[1]].map(arrotonda)
    return `M${x0} ${y}A${r} ${r} 0 1 ${verso} ${x1} ${y}A${r} ${r} 0 1 ${verso} ${x0} ${y}Z`
  }
  const punto = (a, b) => [c[0] + a * u[0] + b * v[0], c[1] + a * u[1] + b * v[1]].map(arrotonda).join(' ')
  const h = manico / 2
  const inizio = fuori - spessore / 2
  const punta = fuori + sporgenza - h
  return {
    vetro: cerchio(fuori, 1) + cerchio(arrotonda(dentro), 0),
    manico: `M${punto(inizio, h)}L${punto(punta, h)}A${h} ${h} 0 0 0 ${punto(punta, -h)}L${punto(inizio, -h)}Z`,
    raggio: Math.max(Math.hypot(k * u[0], k * u[1]) + fuori, fuori + sporgenza - k),
  }
}

/**
 * Cosa non va nella geometria: l'anello fuori dalla zona sicura o non
 * centrato, la lente troppo vicina ai settori o col foro chiuso. Vuoto se va.
 */
export function problemi(sorgente, { scala = SCALA, opzioni = LENTE } = {}) {
  const fuori = []
  const { nucleo, esterno, interno } = sorgente
  const centro = [CANVAS / 2 - nucleo.cx * scala, CANVAS / 2 - nucleo.cy * scala]
  if (centro.some((x) => x < 0)) fuori.push('il marchio non sta nel canvas')
  if (esterno * scala > ZONA_SICURA) {
    fuori.push(`l'anello arriva a ${arrotonda(esterno * scala)}dp dal centro, oltre i ${ZONA_SICURA} della zona sicura`)
  }
  const l = lente(nucleo, opzioni)
  if (l.raggio + MARGINE > interno) {
    fuori.push(`la lente arriva a ${arrotonda(l.raggio)} dal centro: con il margine di ${MARGINE} tocca i settori (raggio interno ${interno})`)
  }
  if (opzioni.spessore >= nucleo.r) fuori.push('il vetro della lente non ha il foro')
  return fuori
}

// Tre decimali: la scala (0.875) non va arrotondata come le coordinate.
const numero = (n) => String(Number(n.toFixed(3)))

// Un VectorDrawable quadrato di `lato` dp con le forme nel gruppo, centrate.
function vettore(commento, scala, nucleo, forme, lato = CANVAS) {
  const t = numero(lato / 2 - nucleo.cx * scala)
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    commento,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${lato}dp"`,
    `    android:height="${lato}dp"`,
    `    android:viewportWidth="${lato}"`,
    `    android:viewportHeight="${lato}">`,
    '    <group',
    `        android:scaleX="${numero(scala)}"`,
    `        android:scaleY="${numero(scala)}"`,
    `        android:translateX="${t}"`,
    `        android:translateY="${t}">`,
    ...forme.map(({ colore, d }) => [
      '        <path',
      `            android:fillColor="${colore.toUpperCase()}"`,
      `            android:pathData="${d}" />`,
    ].join('\n')),
    '    </group>',
    '</vector>',
    '',
  ].join('\n')
}

/**
 * I file dell'icona dal testo di maskable.svg: { percorso: testo }. I
 * commenti dei file sono in inglese, come il resto di android/.
 * @param {string} svg
 */
export function iconaAndroid(svg, { scala = SCALA, opzioni = LENTE } = {}) {
  const sorgente = sorgenteMarchio(svg)
  const male = problemi(sorgente, { scala, opzioni })
  if (male.length) throw new Error(`icona Android:\n  ${male.join('\n  ')}`)
  const { nucleo } = sorgente
  const l = lente(nucleo, opzioni)
  const forme = [
    ...sorgente.settori,
    { colore: nucleo.colore, d: l.vetro },
    { colore: nucleo.colore, d: l.manico },
  ]
  const generato = 'Generated by scripts/brand/icona-android.mjs from scripts/brand/svg/maskable.svg:\n    do not edit by hand, run node scripts/brand/icona-android.mjs.'
  return {
    [FILE.primoPiano]: vettore(
      [
        '<!--',
        '    The site\'s mark (Anello Ki: AGL TEQ INT STR PHY clockwise from the top)',
        '    with its gold core turned into a magnifying glass, inside the 66dp safe',
        '    zone of the 108dp adaptive icon canvas. Fixed colours, as on the site.',
        `    ${generato}`,
        '-->',
      ].join('\n'),
      scala,
      nucleo,
      forme,
    ),
    [FILE.monocromo]: vettore(
      [
        '<!--',
        '    The themed icon layer (Android 13+): the same shapes in one colour,',
        '    the launcher tints them.',
        `    ${generato}`,
        '-->',
      ].join('\n'),
      scala,
      nucleo,
      forme.map(({ d }) => ({ colore: '#ffffff', d })),
    ),
    [FILE.bolla]: vettore(
      [
        '<!--',
        '    The bubble over the game and its preview in the settings: the launcher',
        `    foreground cropped to the ${VISTA}dp the launcher shows, so the mark fills`,
        '    the bubble as it fills the icon on the home screen.',
        `    ${generato}`,
        '-->',
      ].join('\n'),
      scala,
      nucleo,
      forme,
      VISTA,
    ),
    [FILE.icona]: [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<!--\n    ${generato}\n-->`,
      '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
      '    <background android:drawable="@color/ic_launcher_background" />',
      '    <foreground android:drawable="@drawable/ic_launcher_foreground" />',
      '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />',
      '</adaptive-icon>',
      '',
    ].join('\n'),
    [FILE.fondo]: [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!--',
      '    The background of the site\'s maskable icon, behind the launcher icon',
      '    and the bubble.',
      `    ${generato}`,
      '-->',
      '<resources>',
      `    <color name="ic_launcher_background">${sorgente.fondo.toUpperCase()}</color>`,
      '</resources>',
      '',
    ].join('\n'),
  }
}

/** I file come andrebbero adesso, dalla maskable.svg del repository. */
export const iconaDalRepository = (root = ROOT) =>
  iconaAndroid(readFileSync(join(root, 'scripts', 'brand', 'svg', 'maskable.svg'), 'utf8'))

/**
 * Scrive i file che sono diversi da quelli generati.
 * @returns {string[]} quelli scritti
 */
export function scriviIconaAndroid(root = ROOT) {
  const scritti = []
  for (const [percorso, testo] of Object.entries(iconaDalRepository(root))) {
    const file = join(root, percorso)
    if (existsSync(file) && readFileSync(file, 'utf8') === testo) continue
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, testo)
    scritti.push(percorso)
  }
  return scritti
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const diversi = Object.entries(iconaDalRepository())
      .filter(([percorso, testo]) => !existsSync(join(ROOT, percorso)) || readFileSync(join(ROOT, percorso), 'utf8') !== testo)
      .map(([percorso]) => percorso)
    if (diversi.length) {
      console.error(`\n  da rigenerare (node scripts/brand/icona-android.mjs):\n    ${diversi.join('\n    ')}\n`)
      process.exit(1)
    }
    console.log('  icona Android allineata al marchio')
  } else {
    const scritti = scriviIconaAndroid()
    for (const p of scritti) console.log(p)
    if (!scritti.length) console.log('  icona Android gia\' allineata al marchio')
  }
}
