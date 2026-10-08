#!/usr/bin/env node
// Le maschere dei log di GitHub Actions per PROD_DATABASE_URL.
//
// GitHub nasconde solo il valore esatto di un secret, ma target.mjs stampa
// host e utente, e l'utente del pooler di Supabase (postgres.<ref>) porta
// il riferimento del progetto. Il repository e' pubblico: chiunque legge i
// log. Questo stampa un ::add-mask:: per ogni pezzo, e mai il valore in
// chiaro (il comando non compare nel log).
//
//   PROD_DATABASE_URL=... node db/prod/ci-mask.mjs
import { pathToFileURL } from 'node:url'

// Pura, per i test: i pezzi da nascondere.
export function maskValues(raw) {
  if (!raw) return []
  let u
  try { u = new URL(raw) } catch { return [raw] }
  const out = new Set()
  const user = decodeURIComponent(u.username)
  const pass = decodeURIComponent(u.password)
  if (pass) { out.add(pass); out.add(u.password) }
  // "postgres" da solo e' il nome di mezzo mondo: mascherarlo storpierebbe
  // ogni riga di pg_dump senza nascondere niente
  if (user && user !== 'postgres') out.add(user)
  const host = u.hostname
  if (host) out.add(host)
  // il riferimento del progetto, ovunque compaia (utente o host diretto)
  const ref = user.match(/^[^.]+\.([a-z0-9]{8,})$/)?.[1] ?? host.match(/^db\.([a-z0-9]{8,})\.supabase\.co$/)?.[1]
  if (ref) out.add(ref)
  return [...out].filter((v) => v.length >= 4)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  for (const v of maskValues(process.env.PROD_DATABASE_URL)) console.log(`::add-mask::${v}`)
}
