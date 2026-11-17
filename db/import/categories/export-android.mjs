// Rigenera il dizionario incluso nell'app Android (android/app/src/main/
// assets/categories.json) dalla cache del datamine: card_categories.csv per
// id e nomi inglesi, missions.csv per i nomi giapponesi (le missioni dei
// titoli), aliases.mjs per gli alias. Le regole stanno in
// android-dictionary.mjs; db/test/android-dictionary.test.mjs controlla che
// il file nel repository sia quello che uscirebbe adesso.
//
//   node db/import/categories/export-android.mjs           scrive il file se cambia
//   node db/import/categories/export-android.mjs --check   non scrive: esce 1 se va rigenerato
//
// Niente database, niente rete: legge la cache (npm run db:fetch la
// aggiorna) e il file di prima, che serve per tenere gli slug e la version.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DM_DIR, parseCsv } from '../datamine.mjs'
import { extractJapaneseNames } from './japanese-names.mjs'
import { ASSET, buildAndroidDictionary } from './android-dictionary.mjs'

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const CHECK = process.argv.includes('--check')

const tabella = (nome) => {
  const p = join(DM_DIR, `${nome}.csv`)
  if (!existsSync(p)) {
    console.error(`\n  manca la cache del datamine (${nome}.csv): npm run db:fetch\n`)
    process.exit(2)
  }
  return parseCsv(readFileSync(p, 'utf8'))
}

const file = join(RADICE, ASSET)
const testoPrima = existsSync(file) ? readFileSync(file, 'utf8') : null
let previous = null
if (testoPrima != null) {
  try {
    previous = JSON.parse(testoPrima)
  } catch (e) {
    console.error(`\n  ${ASSET} non e' JSON (${e instanceof Error ? e.message : e}): sistemalo o toglilo\n`)
    process.exit(2)
  }
}

const japanese = extractJapaneseNames(tabella('missions'))
const { dictionary, text, warnings } = buildAndroidDictionary({
  categories: tabella('card_categories'), japaneseNames: japanese.names, previous,
})
for (const p of japanese.problems) console.log(`  (${p.msg})`)
for (const w of warnings) console.log(`  attenzione: ${w}`)
if (!dictionary.categories.length) {
  console.error('\n  nessuna categoria con il nome giapponese: non scrivo niente\n')
  process.exit(2)
}

const cambia = text !== testoPrima
const conta = `${dictionary.categories.length} categorie, version ${dictionary.version}`
if (CHECK) {
  console.log(cambia
    ? `  ${ASSET} va rigenerato (${conta}): node db/import/categories/export-android.mjs`
    : `  ${ASSET} aggiornato (${conta})`)
  process.exit(cambia ? 1 : 0)
}
if (cambia) writeFileSync(file, text)
console.log(`  ${ASSET}: ${conta}${cambia ? `, scritto (prima: version ${previous?.version ?? 'nessuna'})` : ', invariato'}`)
