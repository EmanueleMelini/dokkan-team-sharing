// I colori del marchio come li scrive app/globals.css: le tre regole di
// .marchio e .colori-marchio (la variante chiara, la scura col sistema
// scuro, la scura dei temi scuri), lette dal sorgente. Le usano genera.mjs,
// che si ferma se marchio.tsx o globals.css non coincidono piu' con gli
// SVG sorgente, e db/test/segnaposto.test.mts (contrasti e temi scuri).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} corpo
 * @returns {Map<number, string>} da N (0 il disco, 1..5 i settori) al colore
 */
const variabili = (corpo) => new Map(
  [...corpo.matchAll(/--marchio-(\d)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [Number(m[1]), m[2].toLowerCase()]),
)

/**
 * Le tre regole del marchio in globals.css. Una regola che manca da' una
 * tavolozza vuota (e nessun tema scuro): chi chiama lo nota dalle misure.
 * @param {string} css il testo di app/globals.css
 * @returns {{ chiaro: Map<number, string>, scuroSistema: Map<number, string>, scuro: Map<number, string>, temiScuri: string[] }}
 */
export function regoleMarchio(css) {
  const testo = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const chiaro = /(?:^|\})\s*\.marchio,\s*\.colori-marchio\s*\{([^{}]*)\}/.exec(testo)
  const sistema = new RegExp(
    String.raw`@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*` +
    String.raw`:root:not\(\[data-theme\]\) :is\(\.marchio, \.colori-marchio\),\s*` +
    String.raw`:root\[data-theme=system\] :is\(\.marchio, \.colori-marchio\)\s*\{([^{}]*)\}\s*\}`,
  ).exec(testo)
  const temi = /:root:is\(([^()]*)\) :is\(\.marchio, \.colori-marchio\)\s*\{([^{}]*)\}/.exec(testo)
  return {
    chiaro: variabili(chiaro?.[1] ?? ''),
    scuroSistema: variabili(sistema?.[1] ?? ''),
    scuro: variabili(temi?.[2] ?? ''),
    temiScuri: [...(temi?.[1] ?? '').matchAll(/\[data-theme=([a-z0-9-]+)\]/g)].map((m) => m[1]),
  }
}

/**
 * Dove il marchio non coincide con i suoi SVG sorgente: i `d` dei settori
 * in components/brand/marchio.tsx, i colori (nell'ordine dei settori, poi
 * il disco) nelle regole di app/globals.css. Vuoto se coincide.
 * @param {string} root la radice del repository
 * @returns {string[]}
 */
export function differenzeMarchio(root) {
  const tsx = readFileSync(join(root, 'components', 'brand', 'marchio.tsx'), 'utf8')
  const r = regoleMarchio(readFileSync(join(root, 'app', 'globals.css'), 'utf8'))
  /** @type {[string, [string, Map<number, string>][]][]} */
  const varianti = [
    ['marchio-chiaro.svg', [['chiara', r.chiaro]]],
    ['marchio-scuro.svg', [['scura del sistema', r.scuroSistema], ['scura dei temi', r.scuro]]],
  ]
  const fuori = []
  for (const [nome, tavolozze] of varianti) {
    const svg = readFileSync(join(root, 'scripts', 'brand', 'svg', nome), 'utf8')
    const settori = [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)]
    const nucleo = /<circle[^>]*fill="([^"]+)"/.exec(svg)?.[1]
    if (settori.length !== 5 || !nucleo) { fuori.push(`${nome}: attesi 5 settori e il disco`); continue }
    for (const [, , d] of settori) if (!tsx.includes(d)) fuori.push(`${nome}: il d ${d} non e' in marchio.tsx`)
    const attesi = [...settori.map(([, fill], i) => [i + 1, fill.toLowerCase()]), [0, nucleo.toLowerCase()]]
    for (const [quale, tavolozza] of tavolozze) {
      for (const [n, colore] of attesi) {
        if (tavolozza.get(Number(n)) !== colore) {
          fuori.push(`${nome}: --marchio-${n} della variante ${quale} in globals.css e' ${tavolozza.get(Number(n)) ?? 'assente'}, non ${colore}`)
        }
      }
    }
  }
  return fuori
}
