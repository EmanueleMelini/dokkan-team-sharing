#!/usr/bin/env node
// Cosa puo' finire nella cache di Actions del settimanale (e, senza il
// datamine, nell'artifact import-cache): solo le copie delle fonti
// pubbliche che scrivono gli script dell'import.
//
//   node db/prod/cache-check.mjs [cartella]   (per difetto db/import/.cache)
//
// La cache di Actions non e' un posto privato: un giro pull_request, anche
// quello di una fork con un suo workflow, ripristina le cache del branch
// base. Il wiki (CC BY-SA) e i CSV del datamine, che e' un repository
// pubblico su GitHub, ci possono stare: chi li prende li' li trova gia'
// sul wiki e su GitHub, e non sono un segreto. Mai un secret, un dump o un
// dato della produzione: un file fuori da questo elenco, una cartella in
// piu' o un link simbolico fanno uscire 1, e il settimanale non salva ne'
// carica niente. Si stampano solo i nomi, mai il contenuto.
import { lstatSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CACHE_DIR } from './inputs.mjs'

// Chi scrive cosa: fetch-wiki, fetch-events, fetch-assets (il template
// degli oggetti) e fetch-datamine (una tabella per file, e _snapshot.json).
// Le tabelle per nome e non l'elenco di datamine-source.mjs: una tabella
// tolta da li' resta nella cache, che --fresh riscarica ma non svuota.
const AMMESSI = [
  /^wiki-cards\.json$/,
  /^wiki-events\.json$/,
  /^wiki-items-template\.json$/,
  /^datamine\/_snapshot\.json$/,
  /^datamine\/[a-z0-9_]+\.csv$/,
]

/**
 * I percorsi dentro dir (relativi, con /) che non sono copie delle fonti
 * pubbliche: vuoto se la cache si puo' salvare. Una cartella diversa da
 * datamine/ conta da sola ("x/"), un link conta sempre, anche verso una
 * cartella.
 * @param {string} [dir]
 * @returns {string[]}
 */
export function nonAmmessi(dir = CACHE_DIR) {
  const fuori = []
  const giro = (d) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome)
      const rel = relative(dir, p).split(sep).join('/')
      const st = lstatSync(p)
      if (st.isDirectory()) {
        if (rel === 'datamine') giro(p)
        else fuori.push(`${rel}/`)
      } else if (!st.isFile() || !AMMESSI.some((re) => re.test(rel))) {
        fuori.push(rel)
      }
    }
  }
  giro(dir)
  return fuori.sort()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? CACHE_DIR
  let fuori
  try {
    fuori = nonAmmessi(dir)
  } catch (err) {
    console.log(`::error::cannot read the import cache (${err.code ?? err.message}): nothing is saved`)
    process.exit(1)
  }
  if (fuori.length) {
    const nomi = fuori.slice(0, 10).join(', ') + (fuori.length > 10 ? `, and ${fuori.length - 10} more` : '')
    console.log(`::error::the import cache holds files that are not copies of the public sources (${nomi}): ` +
                'nothing is saved to the Actions cache or the artifact')
    process.exit(1)
  }
  console.log('  la cache tiene solo le copie delle fonti pubbliche: si puo\' salvare')
}
