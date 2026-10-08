// npm run cache:clear: dice al server di sviluppo che i dati sono cambiati.
//
// Le pagine leggono il database attraverso 'use cache' (lib/cache/data.ts):
// un import, db:demo o una modifica a mano con psql scrivono su Postgres
// fuori da Next, e senza questo next dev continuerebbe a mostrare i dati
// di prima fino al riavvio. Si accoda a db:import, db:refresh e db:demo.
//
// Al meglio: se il server non gira (ECONNREFUSED) non c'e' niente da
// svuotare, e lo script esce con 0 per non fermare la catena di npm.
//
//   SITE_URL   il server, per difetto http://localhost:3000
//   CRON_SECRET  se impostato, va come Bearer (in next dev senza segreto la
//                rotta e' aperta: lib/cache/revalidate.ts)
import './env.mjs'

const BASE = (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const TAGS = ['catalog', 'events-list', 'community']

const headers = { 'content-type': 'application/json' }
if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`

try {
  const r = await fetch(`${BASE}/api/revalidate`, {
    method: 'POST', headers, body: JSON.stringify({ tags: TAGS }), signal: AbortSignal.timeout(15_000),
  })
  if (r.ok) console.log(`  cache: ${TAGS.join(', ')} invalidati su ${BASE}`)
  else if (r.status === 401) console.warn(`  cache: ${BASE} ha risposto 401 (CRON_SECRET diverso da quello del server?)`)
  else console.warn(`  cache: ${BASE} ha risposto ${r.status}`)
} catch (e) {
  const code = e?.cause?.code ?? e?.code ?? e?.name
  if (code === 'ECONNREFUSED') console.log(`  cache: nessun server su ${BASE}, niente da invalidare`)
  else console.warn(`  cache: ${BASE} non raggiungibile (${code ?? e})`)
}
