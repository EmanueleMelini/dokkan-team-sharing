// La cache (lib/cache/*): quali tag tocca ogni scrittura, quali tag si
// possono chiedere da fuori, la rotta /api/revalidate, e la regola che
// tiene verdi le altre suite: i moduli di query puri non chiamano
// cacheTag/cacheLife (fuori da Next lanciano) e non hanno 'use cache'.
//
// Funzioni pure, niente database e niente next/cache: la rotta vera passa
// revalidateTag a revalidateRequest, qui passa una funzione finta.
import { readFileSync } from 'node:fs'
import { TAG, isAllowedTag, tagsFor, tagsForUser, SOGLIA_TAG_UTENTE } from '@/lib/cache/tags'
import { revalidateRequest, TAG_MAX } from '@/lib/cache/revalidate'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const mostra = (v: unknown) => JSON.stringify(v) ?? String(v)
function vale<T>(nome: string, got: T, atteso: T) {
  const ok = mostra(got) === mostra(atteso)
  check(nome, ok, `= ${mostra(got)}${ok ? '' : `, atteso ${mostra(atteso)}`}`)
}

console.log('tagsFor: ogni scrittura su un clear')
const dove = { eventId: '12', cardIds: ['1001', '1002', '1001', 'x'], handles: ['Goku_Fan'] }
vale('submit', tagsFor('submit', dove), {
  now: ['event:12'], soon: ['events-list', 'card:1001', 'card:1002', 'profile:goku_fan'],
})
vale('revise', tagsFor('revise', dove), { now: ['event:12'], soon: ['card:1001', 'card:1002', 'profile:goku_fan'] })
vale('delete: quello che si cancella sparisce subito ovunque', tagsFor('delete', dove), {
  now: ['event:12', 'card:1001', 'card:1002', 'profile:goku_fan'], soon: ['events-list'],
})
vale('vote: solo event, senza rigenerare', tagsFor('vote', dove), { now: [], soon: ['event:12'] })
vale('comment', tagsFor('comment', dove), { now: ['event:12'], soon: [] })
check('il voto non produce mai un updateTag', tagsFor('vote', { eventId: '1' }).now.length === 0)

console.log('tagsForUser: cancellazione dell\'account')
vale('sotto la soglia: ogni pagina toccata, subito',
  tagsForUser({ eventIds: ['1', '2'], cardIds: ['3'], handles: ['Ab_c'] }),
  { now: ['event:1', 'event:2', 'card:3', 'profile:ab_c'], soon: ['events-list'], all: false })
const tanti = Array.from({ length: SOGLIA_TAG_UTENTE + 1 }, (_, i) => String(i + 1))
const oltre = tagsForUser({ eventIds: tanti, cardIds: [], handles: [] })
check(`oltre ${SOGLIA_TAG_UTENTE} tag: tutto il contenuto utenti`, oltre.all && oltre.now.length === 0)

console.log('isAllowedTag')
for (const t of [TAG.catalog, TAG.eventsList, TAG.community, 'event:123', 'card:1034200', 'profile:goku_fan']) {
  check(`accetta ${t}`, isAllowedTag(t))
}
const rifiutati: [string, unknown][] = [
  ['event:abc', 'event:abc'],
  ['event: vuoto', 'event:'],
  ['event con 19 cifre', 'event:1234567890123456789'],
  ['un uuid (user:<uuid>)', 'user:5b0c2a5e-8e3f-4c9a-9a51-0f1e2d3c4b5a'],
  ['256 caratteri', 'x'.repeat(256)],
  ['due due punti', 'event:1:2'],
  ['profilo con maiuscole', 'profile:Goku'],
  ['_N_T_ del layout', '_N_T_/layout'],
  ['non una stringa', 42],
]
for (const [nome, t] of rifiutati) check(`rifiuta ${nome}`, !isAllowedTag(t))

console.log('/api/revalidate (lib/cache/revalidate.ts)')
const SEGRETO = 'un-segreto-abbastanza-lungo'
async function chiama(opz: { auth?: string; body?: string; secret?: string; dev?: boolean }) {
  const applicati: string[][] = []
  const req = new Request('http://x/api/revalidate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opz.auth ? { authorization: opz.auth } : {}) },
    body: opz.body ?? '{"tags":["catalog"]}',
  })
  const r = await revalidateRequest(req, { secret: opz.secret, dev: opz.dev ?? false, apply: (t) => applicati.push(t) })
  return { status: r.status, cache: r.headers.get('cache-control'), body: await r.json(), applicati }
}
let r = await chiama({ auth: `Bearer ${SEGRETO}` })
check('senza CRON_SECRET: 401', r.status === 401 && r.applicati.length === 0)
r = await chiama({ secret: 'corto', auth: 'Bearer corto' })
check('CRON_SECRET troppo corto: 401', r.status === 401)
r = await chiama({ secret: SEGRETO, auth: 'Bearer sbagliato' })
check('Bearer sbagliato: 401', r.status === 401 && r.applicati.length === 0)
r = await chiama({ secret: SEGRETO })
check('senza Authorization: 401', r.status === 401)
r = await chiama({ secret: SEGRETO, auth: `Bearer ${SEGRETO}`, body: '{"tags":["catalog","user:abc"]}' })
check('un tag sconosciuto: 400 e niente invalidato', r.status === 400 && r.applicati.length === 0)
r = await chiama({ secret: SEGRETO, auth: `Bearer ${SEGRETO}`, body: 'non json' })
check('corpo non JSON: 400', r.status === 400)
r = await chiama({ secret: SEGRETO, auth: `Bearer ${SEGRETO}`, body: '{"tags":[]}' })
check('lista vuota: 400', r.status === 400)
const troppi = JSON.stringify({ tags: Array.from({ length: TAG_MAX + 1 }, (_, i) => `event:${i + 1}`) })
r = await chiama({ secret: SEGRETO, auth: `Bearer ${SEGRETO}`, body: troppi })
check(`piu' di ${TAG_MAX} tag: 400`, r.status === 400)
r = await chiama({ secret: SEGRETO, auth: `Bearer ${SEGRETO}`, body: '{"tags":["catalog","events-list","catalog"]}' })
check('valida: 200, tag senza doppioni, no-store',
  r.status === 200 && mostra(r.applicati) === mostra([['catalog', 'events-list']]) && r.cache === 'no-store',
  mostra(r))
r = await chiama({ dev: true })
check('next dev senza segreto: aperta (cache:clear)', r.status === 200)
r = await chiama({ dev: true, secret: SEGRETO, auth: 'Bearer sbagliato' })
check('next dev con segreto: il segreto vale', r.status === 401)

console.log('i moduli di query puri restano senza cache')
for (const f of ['lib/queries.ts', 'lib/clears.ts', 'lib/cards.ts', 'lib/equipment.ts']) {
  const testo = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  const trovato = testo.match(/['"]use cache|cacheTag\(|cacheLife\(|from 'next\/cache'/)
  check(`${f} senza 'use cache', cacheTag, cacheLife`, !trovato, trovato?.[0] ?? '')
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
