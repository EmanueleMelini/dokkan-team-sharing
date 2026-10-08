#!/usr/bin/env node
// Scarica i CSV del database ufficiale Global da Nicholas1006/dokkan-backend.
//
// Quel repo versiona in git il database del gioco esportato tabella per
// tabella, con commit automatici settimanali. Prendiamo solo le tabelle
// che ci servono: ~25 MB invece dei 100 del database intero.
//
// Tutte le tabelle vengono dallo STESSO commit, che si chiede una volta
// all'API di GitHub e si scrive in _snapshot.json. Scaricando da HEAD un
// commit arrivato a meta' giro mescolerebbe due settimane diverse: aree di
// una, missioni dell'altra. E il loader delle finestre deve poter dire di
// quando e' la fotografia che sta leggendo.
//
//   node db/import/fetch-datamine.mjs [--fresh] [--strict]
//
// --strict e' per la CI: esce 1 se il commit non si conosce (niente
// ripiego su HEAD) o se anche una sola tabella non arriva. Con
// GITHUB_TOKEN nell'ambiente la chiamata all'API e' autenticata: gli IP
// dei runner sono condivisi, e senza token il limite di 60 richieste
// all'ora per IP e' spesso gia' consumato da altri.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO, TABLES, headersFor, resolveCommit } from './datamine-source.mjs'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '.cache', 'datamine')
const FRESH = process.argv.includes('--fresh')
const STRICT = process.argv.includes('--strict')
const SNAPSHOT = join(DIR, '_snapshot.json')

mkdirSync(DIR, { recursive: true })

// Il commit da cui scaricare. Con --fresh l'ultimo che tocca data/; senza,
// quello della cache gia' presente, cosi' una tabella aggiunta dopo arriva
// dalla stessa fotografia delle altre.
let snap = null
if (!FRESH && existsSync(SNAPSHOT)) snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
const daCommitNoto = !!snap
if (!snap) {
  const old = TABLES.filter((t) => existsSync(join(DIR, `${t}.csv`)))
  if (!FRESH && old.length) {
    console.log(`  attenzione: la cache non dice da che commit viene; le tabelle mancanti`)
    console.log(`  arrivano dall'ultimo, le altre restano vecchie. --fresh le riallinea.`)
  }
  try {
    snap = await resolveCommit(fetch, { strict: STRICT, token: process.env.GITHUB_TOKEN || undefined })
  } catch (err) {
    console.error(`\n  ${err.message}: con --strict non scarico da HEAD\n`)
    process.exit(1)
  }
  // senza API si scarica comunque, da HEAD, e lo si dichiara
  if (!snap.commit) console.log(`  non so quale sia l'ultimo commit (${snap.error}): scarico da HEAD`)
  delete snap.error
}
const ref = snap.commit ?? 'HEAD'
const BASE = `https://raw.githubusercontent.com/${REPO}/${ref}/data`
console.log(`  commit: ${snap.commit ? `${snap.commit.slice(0, 8)} del ${snap.committed_at}` : 'HEAD (non noto)'}`)

let scaricati = 0, saltati = 0, falliti = 0, byte = 0
for (const t of TABLES) {
  const dest = join(DIR, `${t}.csv`)
  if (!FRESH && existsSync(dest) && statSync(dest).size > 0) {
    saltati++; byte += statSync(dest).size
    continue
  }
  // una alla volta e con una pausa: e' il raw di GitHub, non un nostro server
  if (scaricati) await new Promise((r) => setTimeout(r, 500))
  const res = await fetch(`${BASE}/${t}.csv`, { headers: headersFor(BASE, undefined) })
  if (!res.ok) { console.log(`  ${t}.csv: HTTP ${res.status}`); falliti++; continue }
  const buf = Buffer.from(await res.arrayBuffer())
  // prima un file a parte, poi il nome vero: un download interrotto non
  // lascia un CSV troncato che il giro dopo prenderebbe per buono
  writeFileSync(dest + '.partial', buf)
  renameSync(dest + '.partial', dest)
  scaricati++; byte += buf.length
  process.stdout.write(`\r  scaricate ${scaricati} tabelle, ${(byte / 1e6).toFixed(1)} MB`)
}
// Il commit si scrive solo se e' vero per tutta la cache: con tabelle
// vecchie di provenienza ignota, o un download fallito, sarebbe una bugia.
const coerente = !falliti && (FRESH || daCommitNoto || !saltati)
if (scaricati && coerente) {
  writeFileSync(SNAPSHOT, JSON.stringify({ ...snap, fetched_at: new Date().toISOString() }, null, 1) + '\n')
}
console.log(`\r  ${scaricati} scaricate, ${saltati} gia' presenti, ${(byte / 1e6).toFixed(1)} MB in tutto`
            + (saltati && !FRESH ? '  (--fresh per riscaricare)' : '') + '          ')
if (STRICT && (falliti || !snap.commit)) {
  console.error(`\n  --strict: ${falliti} tabelle non scaricate${snap.commit ? '' : ', commit non noto'}\n`)
  process.exit(1)
}
