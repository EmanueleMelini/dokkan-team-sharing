// La pagina offline della PWA (public/offline.html), generata da qui con
// genera.mjs. Il service worker (public/sw.js) la mette in cache
// all'installazione e la mostra solo quando una navigazione non raggiunge
// la rete.
//
// Deve funzionare senza niente di Next: niente chunk, niente CSS di
// Tailwind, niente font. Quindi tutto in linea: i colori dei temi presi da
// app/globals.css (solo i token che usa), lo script del <head> di
// lib/tema/temi.ts (lo stesso tema salvato in localStorage, senza lampi),
// il marchio dai suoi SVG sorgente. Generarla invece di scriverla a mano
// evita che un tema nuovo o un colore cambiato restino fuori: il test
// db/test/pwa.test.mts la rigenera e la confronta con quella versionata.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BARRA_SISTEMA, scriptTema } from '../../lib/tema/temi.ts'

// I soli token che la pagina usa: il resto peserebbe per niente.
const TOKEN = ['sfondo', 'superficie', 'inchiostro', 'testo', 'tenue', 'linea', 'campo', 'oro']

/** I blocchi dei temi di globals.css: selettore, color-scheme e token. */
export function blocchiTemi(css) {
  const senzaCommenti = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocchi = []
  for (const [, sel, corpo] of senzaCommenti.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/--sfondo\s*:/.test(corpo)) continue
    const props = new Map()
    for (const [, k, v] of corpo.matchAll(/(color-scheme|--[a-z0-9-]+)\s*:\s*([^;]+);/g)) props.set(k, v.trim())
    // prima del selettore possono restare regole senza graffe (@import ...;)
    blocchi.push({ selettore: sel.split(';').pop().trim().replace(/\s+/g, ' '), props })
  }
  return blocchi
}

const regola = (sel, props) =>
  `${sel}{color-scheme:${props.get('color-scheme')};` +
  TOKEN.map((t) => {
    const v = props.get(`--${t}`)
    if (!v) throw new Error(`globals.css: ${sel} senza --${t}`)
    return `--${t}:${v}`
  }).join(';') + '}'

/** Le forme e i colori del marchio da uno dei suoi SVG sorgente. */
function marchio(svg) {
  const d = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map(([, fill, d]) => ({ fill, d }))
  const nucleo = svg.match(/<circle[^>]*fill="([^"]+)"/)?.[1]
  if (d.length !== 5 || !nucleo) throw new Error('marchio: attesi 5 settori e il nucleo')
  return { settori: d, nucleo }
}

const variabili = (m) => m.settori.map((s, i) => `--m${i + 1}:${s.fill}`).join(';') + `;--m0:${m.nucleo}`

export function paginaOffline(root) {
  const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8')
  const svg = (nome) => readFileSync(join(root, 'scripts', 'brand', 'svg', nome), 'utf8')
  const chiaro = marchio(svg('marchio-chiaro.svg'))
  const scuro = marchio(svg('marchio-scuro.svg'))

  const temi = []
  const scuri = []
  for (const { selettore, props } of blocchiTemi(css)) {
    if (selettore === ':root:not([data-theme])') {
      temi.push(`@media (prefers-color-scheme:dark){${regola(selettore, props)}}`)
      continue
    }
    temi.push(regola(selettore, props))
    if (props.get('color-scheme') === 'dark') {
      for (const [, id] of selettore.matchAll(/\[data-theme="([^"]+)"\]/g)) scuri.push(id)
    }
  }
  if (!temi.length || !scuri.length) throw new Error('globals.css: nessun blocco dei temi trovato')

  // Come le regole del marchio in app/globals.css: la variante scura col
  // sistema scuro senza tema scelto, o con un tema scuro.
  const stileMarchio =
    `.marchio{${variabili(chiaro)}}` +
    `@media (prefers-color-scheme:dark){:root:not([data-theme]) .marchio{${variabili(scuro)}}}` +
    `:root:is(${scuri.map((t) => `[data-theme="${t}"]`).join(',')}) .marchio{${variabili(scuro)}}`

  const stilePagina = [
    '*{box-sizing:border-box}',
    'html,body{min-height:100%;margin:0}',
    'body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px 16px;' +
      'background:var(--sfondo);color:var(--testo);' +
      'font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
    'main{width:100%;max-width:22rem;padding:32px 24px;text-align:center;background:var(--superficie);' +
      'border:1px solid var(--linea);border-radius:.375rem}',
    '.marchio{display:block;width:48px;height:48px;margin:0 auto 16px}',
    'h1{margin:0;font-size:18px;font-weight:600;letter-spacing:-.01em;color:var(--inchiostro)}',
    'p{margin:8px 0 0;font-size:13px;line-height:1.6}',
    'button{margin-top:20px;padding:8px 16px;font:inherit;font-size:13px;font-weight:500;cursor:pointer;' +
      'color:var(--inchiostro);background:var(--sfondo);border:1px solid var(--campo);border-radius:.375rem}',
    'button:hover{border-color:var(--oro)}',
    ':focus-visible{outline:2px solid var(--oro);outline-offset:2px}',
  ].join('')

  const forme =
    chiaro.settori.map((s, i) => `<path d="${s.d}" style="fill:var(--m${i + 1})"/>`).join('') +
    '<circle cx="32" cy="32" r="8" style="fill:var(--m0)"/>'

  // location.reload() riprova l'URL che si voleva aprire: il service worker
  // serve questa pagina al suo posto, senza cambiare indirizzo. Al ritorno
  // della rete (evento online) si riprova da soli.
  const riprova =
    '(function(){var r=function(){location.reload()};' +
    'document.getElementById("riprova").addEventListener("click",r);addEventListener("online",r)})()'

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${BARRA_SISTEMA.light}">`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${BARRA_SISTEMA.dark}">`,
    "<title>You're offline · Dokkan Team Sharing</title>",
    `<script>${scriptTema()}</script>`,
    `<style>${temi.join('')}${stileMarchio}${stilePagina}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<svg class="marchio" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${forme}</svg>`,
    "<h1>You're offline</h1>",
    '<p>Dokkan Team Sharing needs a connection to open this page. Check your network and try again.</p>',
    '<button type="button" id="riprova">Try again</button>',
    '</main>',
    `<script>${riprova}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
