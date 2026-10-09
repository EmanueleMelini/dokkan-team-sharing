#!/usr/bin/env node
// Riscrive gli SVG sorgente del marchio in scripts/brand/svg/ a partire
// dalla geometria (anello.mjs) e dai colori qui sotto. Serve solo quando si
// cambia la forma o un colore: gli SVG sono versionati e genera.mjs parte
// da quelli.
//
//   node scripts/brand/sorgenti.mjs && node scripts/brand/genera.mjs
//
// Dopo, i `d` e i colori vanno ricopiati in components/brand/marchio.tsx:
// genera.mjs si ferma se non coincidono.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settori } from './anello.mjs'

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'svg')

// Colori FISSI: il marchio non segue i temi (un tema colorato potrebbe
// rendere due settori uguali o un settore uguale allo sfondo). Una variante
// per i fondi chiari e una per quelli scuri, presi dai tipi dei temi di base.
// Ordine: AGL TEQ INT STR PHY, in senso orario dall'alto.
const CHIARO = { tipi: ['#2f6fc4', '#2e7d5b', '#6b4b9e', '#b03a2e', '#a85414'], nucleo: '#7a5c00' }
// Il nucleo scuro e' piu' chiaro e piu' giallo dell'oro del sito (#f0c64a):
// accanto a PHY (#e0a651) si confondeva. Ora OKLab 0.138 e 1.56:1 di
// luminanza invece di 0.089 e 1.32:1.
const SCURO = { tipi: ['#6fa8e8', '#5fc79a', '#a98bdb', '#e8836f', '#e0a651'], nucleo: '#f8da5e' }
// Lo sfondo della tessera del favicon e dell'immagine di anteprima: lo
// sfondo del tema scuro, cosi' l'icona si legge sulle tab chiare e scure.
const FONDO = '#0f111d'

// Il marchio grande, viewBox 64. Il taglio di 3.2 rende quasi lo stesso
// spazio della proposta approvata (9 gradi a spicchio).
const MARCHIO = { c: 32, R: 30, r: 17, taglio: 3.2, inclinazione: 14, nucleo: 8 }
// Il favicon, viewBox 32: taglio di 2 unita' (un pixel a 16px), altrimenti
// a 16px i settori si toccano e la girandola diventa un anello. Per la voce
// a 16px del .ico, dove non c'e' niente da scalare, un taglio ancora piu'
// largo: provato a occhio, sotto 2.4 due tagli su cinque spariscono.
const FAVICON = { c: 16, R: 13.5, r: 7, taglio: 2, inclinazione: 14, nucleo: 3.5 }
const FAVICON_16 = { ...FAVICON, taglio: 2.4 }
// Per il badge: un colore solo, conta la forma (i tagli restano vuoti).
const BIANCO = { tipi: Array(5).fill('#ffffff'), nucleo: '#ffffff' }
const tessera = `<rect width="32" height="32" rx="7" fill="${FONDO}"/>`

const forme = (g, colori) =>
  settori(g).map((d, i) => `<path fill="${colori.tipi[i]}" d="${d}"/>`).join('') +
  `<circle cx="${g.c}" cy="${g.c}" r="${g.nucleo}" fill="${colori.nucleo}"/>`

const svg = (box, corpo) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">${corpo}</svg>\n`

const file = {
  'marchio-chiaro.svg': svg(64, forme(MARCHIO, CHIARO)),
  'marchio-scuro.svg': svg(64, forme(MARCHIO, SCURO)),
  // La tessera scura e' parte dell'icona: senza, su una tab chiara il blu
  // e il viola del tema scuro sparirebbero.
  'favicon.svg': svg(32, tessera + forme(FAVICON, SCURO)),
  'favicon-16.svg': svg(32, tessera + forme(FAVICON_16, SCURO)),
  // iOS ritaglia gli angoli da solo e vuole un'icona opaca: fondo pieno,
  // marchio al 70% con il margine che chiede la griglia delle icone.
  'apple-icon.svg': svg(
    64,
    `<rect width="64" height="64" fill="${FONDO}"/><g transform="translate(9.6 9.6) scale(0.7)">${forme(MARCHIO, SCURO)}</g>`,
  ),
  // L'icona "any" dell'app installata (manifest, 192 e 512): la tessera
  // del favicon ma con la geometria grande. favicon.svg ha i tagli
  // allargati per i 16 px, che a 512 sembrano grossolani.
  'app.svg': svg(
    64,
    `<rect width="64" height="64" rx="14" fill="${FONDO}"/><g transform="translate(6.4 6.4) scale(0.8)">${forme(MARCHIO, SCURO)}</g>`,
  ),
  // Maskable: Android ritaglia un cerchio o un quadrato arrotondato, e la
  // zona sicura e' il cerchio centrale dell'80%. Fondo pieno e marchio a
  // scala 0.6: il raggio esterno diventa 18 su 32, il 56%, dentro la zona.
  'maskable.svg': svg(
    64,
    `<rect width="64" height="64" fill="${FONDO}"/><g transform="translate(12.8 12.8) scale(0.6)">${forme(MARCHIO, SCURO)}</g>`,
  ),
  // Il badge della barra di stato di Android (fase 4, notifiche push): il
  // sistema usa solo il canale alfa, quindi forme bianche su trasparente.
  'badge.svg': svg(64, forme(MARCHIO, BIANCO)),
  // L'anteprima dei link (1200x630): fondo e marchio. Il nome e la frase li
  // aggiunge genera.mjs, perche' il testo va disegnato con il font.
  'og.svg':
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">` +
    `<rect width="1200" height="630" fill="${FONDO}"/>` +
    `<g transform="translate(510 118) scale(2.8125)">${forme(MARCHIO, SCURO)}</g></svg>\n`,
}

mkdirSync(DIR, { recursive: true })
for (const [nome, testo] of Object.entries(file)) {
  writeFileSync(join(DIR, nome), testo)
  console.log(`scripts/brand/svg/${nome}`)
}
