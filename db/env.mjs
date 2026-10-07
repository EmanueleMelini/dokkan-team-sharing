// Sorgente unica per "su quale database stiamo lavorando".
//
// Esiste perche' e' gia' successo: gli script leggevano dei valori di
// ripiego cablati nel codice, .env.local diceva un'altra cosa, e una
// migrazione e' finita su un database diverso da quello che credevo —
// in silenzio. Un errore cosi' non si vede: sembra tutto andato bene.
//
// Ora la stringa di connessione si ricava in un posto solo, e ogni
// script dice a voce alta dove sta scrivendo.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// le variabili gia' nell'ambiente vincono: serve per CI e per i test
for (const file of ['.env.local', '.env']) {
  const p = join(ROOT, file)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
    if (!m) continue
    const v = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}

export function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const { PGUSER, PGHOST, PGPORT, PGDATABASE } = process.env
  if (!PGDATABASE) {
    console.error('\n  non so su quale database lavorare: manca DATABASE_URL')
    console.error('  (di solito sta in .env.local)\n')
    process.exit(1)
  }
  return `postgres://${PGUSER ?? 'postgres'}@${PGHOST ?? 'localhost'}:${PGPORT ?? 5432}/${PGDATABASE}`
}

// Da stampare all'inizio di ogni script: se qualcosa punta al database
// sbagliato, si vede subito invece di scoprirlo tre comandi dopo.
export function describeTarget() {
  const u = new URL(connectionString())
  return `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)} come ${u.username || '(default)'}`
}
