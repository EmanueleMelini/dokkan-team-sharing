#!/usr/bin/env node
// Genera le icone e l'anteprima dei link dagli SVG in scripts/brand/svg/:
//
//   app/icon.svg                         favicon vettoriale (browser recenti)
//   app/favicon.ico                      16 (da favicon-16.svg), 32 e 48 px
//   app/apple-icon.png                   180x180 opaca (schermata Home di iOS)
//   app/opengraph-image.png              1200x630, anteprima dei link
//   app/twitter-image.png                la stessa, per le card di X
//   app/*-image.alt.txt                  il testo alternativo delle due
//
//   node --disable-warning=ExperimentalWarning scripts/brand/genera.mjs
//
// Sono file statici: Next li trova per nome (metadata file conventions) e
// li serve cosi' come sono, senza codice al build ne' query.
//
// Il testo dell'anteprima lo disegna next/og (satori), che trasforma le
// lettere in forme: niente font di sistema, quindi la stessa immagine su
// ogni macchina. Il font e' Geist Regular (SIL Open Font License 1.1), lo
// stesso del sito, preso dalla copia dentro next: il font non finisce nel
// repository, nell'immagine restano solo i pixel.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const SVG = join(ROOT, 'scripts', 'brand', 'svg')
const APP = join(ROOT, 'app')
const FONT = join(ROOT, 'node_modules', 'next', 'dist', 'compiled', '@vercel', 'og', 'Geist-Regular.ttf')
const FONDO = '#0f111d'

const require = createRequire(join(ROOT, 'package.json'))
const { ImageResponse } = await import(require.resolve('next/og'))
const { createElement: h } = require('react')

const sorgente = (nome) => readFileSync(join(SVG, nome))

/**
 * Rasterizza un SVG quadrato direttamente a `lato` px. Disegnarlo grande e
 * poi ridurlo sfuma i tagli tra i settori: a 16px spariscono.
 */
async function png(svg, lato) {
  const { width } = await sharp(svg).metadata()
  return sharp(svg, { density: (72 * lato) / width })
    .resize(lato, lato)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/**
 * Un .ico con dentro dei PNG (formato accettato da Windows Vista in poi e
 * da tutti i browser): intestazione, una voce di 16 byte per immagine, poi
 * i PNG cosi' come sono.
 */
function ico(immagini) {
  const testa = Buffer.alloc(6 + 16 * immagini.length)
  testa.writeUInt16LE(0, 0) // riservato
  testa.writeUInt16LE(1, 2) // 1 = icona
  testa.writeUInt16LE(immagini.length, 4)
  let offset = testa.length
  immagini.forEach(({ lato, dati }, i) => {
    const v = 6 + 16 * i
    testa.writeUInt8(lato >= 256 ? 0 : lato, v) // larghezza, 0 = 256
    testa.writeUInt8(lato >= 256 ? 0 : lato, v + 1) // altezza
    testa.writeUInt8(0, v + 2) // niente palette
    testa.writeUInt8(0, v + 3) // riservato
    testa.writeUInt16LE(1, v + 4) // piani
    testa.writeUInt16LE(32, v + 6) // bit per pixel
    testa.writeUInt32LE(dati.length, v + 8)
    testa.writeUInt32LE(offset, v + 12)
    offset += dati.length
  })
  return Buffer.concat([testa, ...immagini.map((x) => x.dati)])
}

/** Nome e frase su fondo trasparente, 1200x630, da sovrapporre a og.svg. */
async function testoAnteprima() {
  if (!existsSync(FONT)) throw new Error(`Manca ${FONT}: npm install, o aggiorna il percorso se next l'ha spostato.`)
  const geist = readFileSync(FONT)
  const testo = h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 326,
        fontFamily: 'Geist',
      },
    },
    // Geist c'e' solo Regular: il contorno dello stesso colore lo porta
    // circa al peso 600 del nome nell'header.
    h(
      'div',
      { style: { fontSize: 76, color: '#eceef7', letterSpacing: -0.76, WebkitTextStroke: '1.6px #eceef7' } },
      'Dokkan Team Sharing',
    ),
    h(
      'div',
      { style: { marginTop: 26, fontSize: 34, color: '#c6cbdf' } },
      'Find and share the teams that cleared every Dokkan Battle event.',
    ),
  )
  const risposta = new ImageResponse(testo, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'Geist', data: geist, weight: 400, style: 'normal' }],
  })
  return Buffer.from(await risposta.arrayBuffer())
}

async function anteprima() {
  const sopra = await testoAnteprima()
  // Due passaggi: in sharp flatten verrebbe applicato prima della
  // composizione, e l'immagine resterebbe con il canale alfa.
  const composta = await sharp(sorgente('og.svg')).composite([{ input: sopra, left: 0, top: 0 }]).png().toBuffer()
  return sharp(composta).flatten({ background: FONDO }).png({ compressionLevel: 9 }).toBuffer()
}

// Il componente del marchio porta gli stessi `d` e colori in linea (niente
// richiesta in piu' per un'immagine nell'header): se qualcuno rigenera gli
// SVG e dimentica il componente, meglio fermarsi qui.
function controllaComponente() {
  const tsx = readFileSync(join(ROOT, 'components', 'brand', 'marchio.tsx'), 'utf8')
  const mancanti = []
  for (const nome of ['marchio-chiaro.svg', 'marchio-scuro.svg']) {
    const svg = sorgente(nome).toString()
    for (const [, valore] of svg.matchAll(/(?:d|fill)="([^"]+)"/g)) {
      if (!tsx.includes(valore)) mancanti.push(`${nome}: ${valore}`)
    }
  }
  if (mancanti.length) {
    throw new Error(`components/brand/marchio.tsx non coincide con gli SVG:\n  ${mancanti.join('\n  ')}`)
  }
}

controllaComponente()

const scrivi = (nome, dati) => {
  writeFileSync(join(APP, nome), dati)
  console.log(`app/${nome}  ${dati.length} byte`)
}
const favicon = sorgente('favicon.svg')
scrivi('icon.svg', favicon)
const voci = []
voci.push({ lato: 16, dati: await png(sorgente('favicon-16.svg'), 16) })
for (const lato of [32, 48]) voci.push({ lato, dati: await png(favicon, lato) })
scrivi('favicon.ico', ico(voci))
// Opaca: iOS mette il nero dietro la trasparenza.
scrivi(
  'apple-icon.png',
  await sharp(await png(sorgente('apple-icon.svg'), 180))
    .flatten({ background: FONDO })
    .png({ compressionLevel: 9 })
    .toBuffer(),
)
const og = await anteprima()
scrivi('opengraph-image.png', og)
scrivi('twitter-image.png', og)
// Il testo alternativo che Next mette in og:image:alt e twitter:image:alt.
// Senza a capo finale: Next lo copierebbe nell'attributo.
const alt = 'Dokkan Team Sharing: find and share the teams that cleared every Dokkan Battle event.'
scrivi('opengraph-image.alt.txt', alt)
scrivi('twitter-image.alt.txt', alt)
