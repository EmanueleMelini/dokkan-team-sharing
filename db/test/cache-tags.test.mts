// La cache (lib/cache/*): quali tag tocca ogni scrittura, quali tag si
// possono chiedere da fuori, la rotta /api/revalidate, e la regola che
// tiene verdi le altre suite: i moduli di query puri non chiamano
// cacheTag/cacheLife (fuori da Next lanciano) e non hanno 'use cache'.
// Poi le scritture ISR (sezione "Scritture ISR su Vercel Hobby" del
// README): le vite delle pagine (30 giorni di scadenza, un giorno di
// revalidate, anche per le liste), niente 'community' scaduto in blocco,
// le missioni solo sulla pagina dell'evento, e l'uscita deterministica
// delle pagine in cache (ogni ORDER BY con una chiave unica, niente
// Date.now o Math.random nel render).
//
// Funzioni pure, niente database e niente next/cache: la rotta vera passa
// revalidateTag a revalidateRequest, qui passa una funzione finta.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type * as TS from 'typescript'
import { TAG, isAllowedTag, tagsFor, tagsForUser } from '@/lib/cache/tags'
import { revalidateRequest, TAG_MAX } from '@/lib/cache/revalidate'
import { GIORNO, SCADENZA, vitaAlConfine } from '@/lib/cache/vita'
import nextConfig from '@/next.config'

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

console.log('tagsForUser: cancellazione dell\'account, handle, sospensione')
vale('ogni pagina toccata, subito',
  tagsForUser({ eventIds: ['1', '2'], cardIds: ['3'], handles: ['Ab_c'] }),
  { now: ['event:1', 'event:2', 'card:3', 'profile:ab_c'], soon: ['events-list'] })
{
  // un account con migliaia di pagine: le sue, una per una, e niente altro
  const tanti = Array.from({ length: 1200 }, (_, i) => String(i + 1))
  const tutte = tagsForUser({ eventIds: tanti, cardIds: tanti.slice(0, 400), handles: ['Big', 'big', 'old_name'] })
  check('1200 eventi, 400 carte, 2 handle: 1602 tag, tutti subito',
    tutte.now.length === 1602 && tutte.now[0] === 'event:1' && tutte.now.includes('card:400') &&
    tutte.now.includes('profile:old_name') && tutte.now.filter((t) => t === 'profile:big').length === 1, `${tutte.now.length}`)
  check('...mai community, nemmeno oltre i 300 di prima', !tutte.now.includes(TAG.community) && !tutte.soon.includes(TAG.community))
  vale('...e la lista degli eventi dietro', tutte.soon, ['events-list'])
  check('niente piu\' campo all (la soglia non c\'e\')', !('all' in tutte))
  check('gli id non numerici si scartano', mostra(tagsForUser({ eventIds: ['x', '7'], cardIds: ['1;drop'], handles: [''] }).now) === mostra(['event:7']))
}

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
for (const f of [
  'lib/queries.ts', 'lib/clears.ts', 'lib/cards.ts', 'lib/equipment.ts',
  'lib/tips.ts', 'lib/card-page.ts', 'lib/card-art.ts', 'lib/profiles.ts',
  'lib/clears/filtri.ts', 'lib/urls.ts', 'lib/robots.ts', 'lib/cache/vita.ts',
]) {
  const testo = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
  const trovato = testo.match(/['"]use cache|cacheTag\(|cacheLife\(|from 'next\/cache'/)
  check(`${f} senza 'use cache', cacheTag, cacheLife`, !trovato, trovato?.[0] ?? '')
}

// ---------------------------------------------------------------------
//  Le scritture ISR (README, "Scritture ISR su Vercel Hobby")
// ---------------------------------------------------------------------

const RADICE = new URL('../../', import.meta.url)
const file = (rel: string) => readFileSync(new URL(rel, RADICE), 'utf8')
/** Il codice senza commenti: le guardie non devono scattare su una spiegazione. */
const senzaCommenti = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const sorgenti = (dir: string): string[] => readdirSync(new URL(dir, RADICE)).flatMap((n) => {
  const rel = join(dir, n)
  if (statSync(new URL(rel, RADICE)).isDirectory()) return sorgenti(rel)
  return /\.(ts|tsx)$/.test(n) ? [rel] : []
})
const richiedi = createRequire(import.meta.url)
const ts = richiedi('typescript') as typeof TS
const albero = (rel: string) => ts.createSourceFile(rel, file(rel), ts.ScriptTarget.Latest, true,
  rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

console.log('le vite delle pagine (lib/cache/vita.ts, next.config.ts)')
vale('SCADENZA: 30 giorni', SCADENZA, 2_592_000)
vale('senza confini vicini: revalidate un giorno, scadenza 30 giorni', vitaAlConfine(null, GIORNO),
  { stale: 300, revalidate: 86_400, expire: 2_592_000 })
vale('un confine fra 10 minuti: si rigenera li\', scade sempre in 30 giorni', vitaAlConfine(600, GIORNO),
  { stale: 300, revalidate: 600, expire: 2_592_000 })
vale('mai sotto 5 minuti', vitaAlConfine(10, GIORNO).revalidate, 300)
{
  const cl = (nextConfig as { cacheLife?: Record<string, { stale: number; revalidate: number; expire: number }> }).cacheLife ?? {}
  vale('catalog: revalidate un giorno, scadenza 30 giorni', [cl.catalog?.revalidate, cl.catalog?.expire], [86_400, 2_592_000])
  vale('community: revalidate un giorno, scadenza 30 giorni (era una settimana)', [cl.community?.revalidate, cl.community?.expire], [86_400, 2_592_000])
}
{
  const data = senzaCommenti(file('lib/cache/data.ts'))
  check('/events e /events/japan: tetto di un giorno, coi confini delle run e il tag events-list',
    /cacheTag\(TAG\.catalog, TAG\.eventsList\)\s*const \[righe, secondi\] = await Promise\.all\(\[listEvents\(f\), secondsToNextStatusChange\(null\)\]\)\s*cacheLife\(vitaAlConfine\(secondi, GIORNO\)\)/.test(data))
  check('...e nessun tetto di un\'ora, nessuna settimana', !/3600|3_600|SETTIMANA|604_?800/.test(data))
  // 'days' (expire una settimana) solo dove non finisce in una pagina
  // pubblica: generateStaticParams al build, e la sitemap
  const sbagliate: string[] = []
  for (const rel of [...sorgenti('lib/cache'), 'app/sitemap.ts']) {
    const t = senzaCommenti(file(rel))
    for (const m of t.matchAll(/export (?:default )?async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
      for (const v of m[2].matchAll(/cacheLife\(([^)]*\)?)\)/g)) {
        const arg = v[1].trim()
        const ok = arg === "'catalog'" || arg === "'community'" || /^vitaAlConfine\(/.test(arg) ||
          (arg === "'days'" && (/^(static|sitemap)/.test(m[1]) || rel === 'app/sitemap.ts'))
        if (!ok) sbagliate.push(`${rel} ${m[1]}: cacheLife(${arg})`)
      }
    }
  }
  check('ogni cacheLife delle pagine pubbliche scade in 30 giorni (catalog, community, vitaAlConfine)', sbagliate.length === 0, sbagliate.join('; '))
}

console.log('invalidateUser: le pagine dell\'utente, mai tutto community')
{
  const inv = senzaCommenti(file('lib/cache/invalidate.ts'))
  check('lib/cache/invalidate.ts non nomina community ne\' expire: 0', !/TAG\.community|['"]community['"]|expire:\s*0/.test(inv))
  check('invalidateUser: applica(tagsForUser(footprint)), nient\'altro',
    /export function invalidateUser\(footprint: UserFootprint\) \{\s*applica\(tagsForUser\(footprint\)\)\s*\}/.test(inv))
  const altrove = [...sorgenti('app'), ...sorgenti('lib'), ...sorgenti('components')]
    .filter((rel) => /revalidateTag\(\s*(TAG\.community|['"]community['"])/.test(senzaCommenti(file(rel))))
  check('nessun revalidateTag di community nel sito', altrove.length === 0, altrove.join(', '))
  const script = readdirSync(new URL('db/prod/', RADICE)).filter((n) => n.endsWith('.mjs'))
    .filter((n) => /['"]community['"]|expire:\s*0/.test(senzaCommenti(file(`db/prod/${n}`))))
  check('...ne\' dagli script di produzione (db/prod)', script.length === 0, script.join(', '))
}

// Il giro delle immagini rinfresca card:<id>, event:<id> ed events-list
// (db/prod/rinfresco.mjs): quei tag devono stare sui dati delle pagine che
// mostrano le immagini, la carta, l'evento (banner e copertina) e la lista.
console.log('i tag del giro delle immagini sono sulle pagine giuste')
{
  const carte = senzaCommenti(file('lib/cache/cards.ts'))
  const data = senzaCommenti(file('lib/cache/data.ts'))
  check('la carta (artwork, miniatura, misure): card:<id>',
    /export async function getCardCached\(id: string\) \{\s*'use cache'\s*cacheLife\('catalog'\)\s*cacheTag\(TAG\.catalog, cardTag\(id\)\)/.test(carte))
  check('l\'evento (banner, copertina) su ogni sua vista: event:<id>',
    /export async function getEventCached\(id: string, reg: Region\) \{\s*'use cache'\s*cacheTag\(TAG\.catalog, eventTag\(id\)\)/.test(data))
  check('la lista degli eventi: events-list', /export async function listEventsCached[\s\S]*?cacheTag\(TAG\.catalog, TAG\.eventsList\)/.test(data))
}

console.log('le missioni solo sulla pagina dell\'evento')
{
  const evento = file('components/evento/pagina.tsx')
  check('sulle viste di un tier il link, sulla pagina dell\'evento la sezione',
    /\{view\.tier \? <LinkMissioni eventId=\{e\.id\} n=\{missioni\.length\} \/> : <Missioni missioni=\{missioni\} \/>\}/.test(evento) &&
    (evento.match(/<Missioni /g) ?? []).length === 1)
  const miss = file('components/missioni.tsx')
  check('la sezione ha l\'ancora #missions', /export const ANCORA_MISSIONI = 'missions'/.test(miss) &&
    /<section id=\{ANCORA_MISSIONI\} aria-labelledby="titolo-missioni"/.test(miss))
  check('il link: alla pagina Global dell\'evento (versione esplicita), all\'ancora, senza prefetch, solo se ce ne sono',
    /if \(!n\) return null/.test(miss) &&
    /const href = `\$\{eventHref\(\{ id: eventId, explicit: true \}\)\}#\$\{ANCORA_MISSIONI\}`/.test(miss) &&
    /href=\{href\}\s*rel=\{relRobots\(href\)\}\s*prefetch=\{false\}/.test(miss) &&
    />\s*Missions\s*</.test(miss))
}

// I <Link> di ogni pagina: un link verso un URL calcolato (un evento, un
// tier, una pagina /p/<n>, un gemello) ha prefetch={false}. Il prefetch di
// un URL che non e' in cache ne avvia la generazione, cioe' una scrittura
// ISR, anche se poi nessuno ci va. Restano col prefetch solo gli URL fissi
// (stringhe) e quelli qui sotto, che sono pagine statiche o per utente.
console.log('i <Link> verso URL calcolati: senza prefetch, e nofollow dove robots.txt esclude')
{
  const AMMESSI = new Map<string, string>([
    ['components/evento/pagina.tsx browseHref({ reg })', '/events o /events/japan: statiche, prerender del build'],
    ['components/profile/proprietario.tsx browseHref()', '/events: statica'],
    ['components/versione/link-eventi.tsx homeHref(versione ?? \'global\')', 'le due home statiche'],
    ['components/auth/sign-in-link.tsx href', '/login: per utente, mai in cache'],
    ['components/auth/reauth-notice.tsx href', '/login: per utente, mai in cache'],
    ['app/settings/sign-in/page.tsx back', 'Settings: per utente, mai in cache'],
  ])
  const senza: string[] = []
  const nofollow: string[] = []
  const radici = [...sorgenti('app'), ...sorgenti('components')].filter((r) => r.endsWith('.tsx') && !/^app\/(api|admin)\//.test(r))
  for (const rel of radici) {
    const sf = albero(rel)
    const visita = (n: TS.Node) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === 'Link') {
        const props = new Map<string, string>()
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a)) { props.set('...', a.getText(sf)); continue }
          const v = a.initializer
          props.set(a.name.getText(sf), !v ? 'true' : ts.isStringLiteral(v) ? JSON.stringify(v.text)
            : ts.isJsxExpression(v) && v.expression ? v.expression.getText(sf) : v.getText(sf))
        }
        const href = props.get('href') ?? ''
        const fisso = /^"/.test(href) || props.has('...')
        if (!fisso && props.get('prefetch') !== 'false' && !AMMESSI.has(`${rel} ${href}`)) senza.push(`${rel}: href={${href}}`)
        // chi costruisce un URL di un evento (o lo riceve) dichiara il suo rel
        const evento = /eventHref|clearListHref|\bhref\(|hrefClear|versioneAltra|linkEvento|\baltra\b|indietro|annulla|query\(/.test(href)
        const rel_ = props.get('rel') ?? ''
        if (evento && rel_ !== '"nofollow"' && rel_ !== `relRobots(${href})`) nofollow.push(`${rel}: href={${href}} rel=${rel_ || '(nessuno)'}`)
      }
      n.forEachChild(visita)
    }
    visita(sf)
  }
  check('ogni <Link> calcolato ha prefetch={false} (o e\' fra gli ammessi)', senza.length === 0, senza.join('; '))
  check('...e quelli verso un evento, un tier o una vista filtrata dicono il rel di robots.txt', nofollow.length === 0, nofollow.join('; '))
  const pag = file('components/paginazione.tsx')
  check('Paginazione: rel di robots.txt e niente prefetch su tutte e due le frecce',
    (pag.match(/rel=\{relRobots\(href\(pagina [-+] 1\)\)\} prefetch=\{false\}/g) ?? []).length === 2)
}

// Con gli stessi dati, una rigenerazione deve dare gli stessi byte: se no
// Vercel la conta come una scrittura ISR nuova. Ogni ORDER BY delle letture
// che finiscono in cache (anche dentro un json_agg, anche nei pezzi di SQL
// che quelle funzioni usano) deve finire con una chiave unica, o stare qui
// con il vincolo che lo rende unico. Un ORDER BY nuovo che non e' ne' l'uno
// ne' l'altro fa fallire la guardia.
console.log('le letture in cache hanno un ordine deterministico')
{
  const MODULI: Record<string, string> = {
    queries: 'lib/queries.ts', clears: 'lib/clears.ts', 'card-page': 'lib/card-page.ts',
    profiles: 'lib/profiles.ts', tips: 'lib/tips.ts', 'clears/build': 'lib/clears/build.ts',
  }
  // le funzioni dei moduli che lib/cache/* avvolge con 'use cache'
  const usate: [string, string][] = []
  for (const rel of sorgenti('lib/cache')) {
    const t = file(rel)
    if (!/'use cache'/.test(t)) continue
    for (const m of t.matchAll(/import \{([^}]*)\} from '@\/lib\/([\w/-]+)'/g)) {
      if (!MODULI[m[2]]) continue
      for (const nome of m[1].split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type '))) usate.push([MODULI[m[2]], nome])
    }
  }
  // le dichiarazioni di primo livello di un modulo, per nome
  const dichiarazioni = new Map<string, Map<string, TS.Node>>()
  const diModulo = (rel: string) => {
    if (dichiarazioni.has(rel)) return dichiarazioni.get(rel)!
    const m = new Map<string, TS.Node>()
    for (const s of albero(rel).statements) {
      if (ts.isFunctionDeclaration(s) && s.name) m.set(s.name.text, s)
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) m.set(d.name.text, d)
    }
    dichiarazioni.set(rel, m)
    return m
  }
  // da ogni funzione usata, tutto il codice che raggiunge nel suo modulo (e buildJson)
  const visti = new Set<string>()
  const testi: { dove: string; testo: string }[] = []
  const raccogli = (rel: string, nome: string) => {
    const chiave = `${rel}#${nome}`
    if (visti.has(chiave)) return
    const nodo = diModulo(rel).get(nome)
    if (!nodo) return
    visti.add(chiave)
    testi.push({ dove: chiave, testo: nodo.getText() })
    const visita = (n: TS.Node) => {
      if (ts.isIdentifier(n)) {
        if (diModulo(rel).has(n.text)) raccogli(rel, n.text)
        if (n.text === 'buildJson') raccogli('lib/clears/build.ts', 'buildJson')
      }
      n.forEachChild(visita)
    }
    nodo.forEachChild(visita)
  }
  for (const [rel, nome] of usate) raccogli(rel, nome)
  check('le funzioni lette in cache si trovano tutte', usate.every(([rel, nome]) => visti.has(`${rel}#${nome}`)) && usate.length >= 20,
    `${usate.length} funzioni, ${testi.length} pezzi di codice`)

  // le costanti di testo (gli ordini condivisi) per sostituirle nel SQL
  const costanti = new Map<string, string>()
  for (const rel of Object.values(MODULI)) {
    for (const [nome, nodo] of diModulo(rel)) {
      if (ts.isVariableDeclaration(nodo) && nodo.initializer && ts.isNoSubstitutionTemplateLiteral(nodo.initializer)) {
        costanti.set(nome, nodo.initializer.text)
      } else if (ts.isVariableDeclaration(nodo) && nodo.initializer && ts.isStringLiteral(nodo.initializer)) {
        costanti.set(nome, nodo.initializer.text)
      }
    }
  }
  const espandi = (t: string) => t.replace(/\$\{(\w+)\}/g, (x, n: string) => costanti.get(n) ?? x)
  /** Le clausole ORDER BY di un pezzo di SQL: fino alla parentesi che chiude, a limit, alla fine della riga. */
  const clausole = (t: string) => {
    const out: string[] = []
    for (const m of t.matchAll(/\border by\s/gi)) {
      let i = m.index! + m[0].length, prof = 0, c = ''
      for (; i < t.length; i++) {
        const ch = t[i]
        if (ch === '(') prof++
        if (ch === ')') { if (prof === 0) break; prof-- }
        if (ch === '`') break
        if (ch === '\n' && prof === 0 && !c.trimEnd().endsWith(',')) break
        if (prof === 0 && /^\s(limit|offset)\b/i.test(t.slice(i, i + 8))) break
        c += ch
      }
      out.push(c.replace(/\s+/g, ' ').trim())
    }
    return out
  }
  /** I termini di una clausola, separati dalle virgole fuori dalle parentesi. */
  const termini = (c: string) => {
    const out: string[] = []
    let prof = 0, cur = ''
    for (const ch of c) {
      if (ch === '(') prof++
      if (ch === ')') prof--
      if (ch === ',' && prof === 0) { out.push(cur.trim()); cur = '' } else cur += ch
    }
    return [...out, cur.trim()].map((x) => x.replace(/\s+(asc|desc)\b/gi, '').replace(/\s+nulls (first|last)\b/gi, '').trim())
  }
  // finisce con la chiave primaria id (di una tabella, o di una riga per id)
  const conChiave = (c: string) => /^(?:[a-z]\w*\.)?id$/.test(termini(c).at(-1) ?? '')
  // gli ordini unici per un vincolo dello schema, uno per uno
  const UNICI = new Map<string, string>([
    ['case es.status when \'active\' then 0 when \'upcoming\' then 1 else 2 end, case when es.status = \'upcoming\' then es.starts_at end asc nulls last, es.starts_at desc',
      'ORDINE_RUN: run_no_overlap, due run dello stesso evento e regione non si sovrappongono, quindi starts_at e\' unico'],
    ['es.event_id, case es.status when \'active\' then 0 when \'upcoming\' then 1 else 2 end, case when es.status = \'upcoming\' then es.starts_at end asc nulls last, es.starts_at desc',
      'distinct on per evento, poi ORDINE_RUN (unico per run_no_overlap)'],
    ['r.seq', 'mission_reward: primary key (mission_id, seq)'],
    ['1, 3, 2', 'getEzaLinks: righe intere (id, name, verso), le uguali sono identiche'],
    ['s.seq, st.difficulty', 'stage unique (event_id, seq), stage_tier unique (stage_id, difficulty)'],
    ['cl.rotation_index, cl.pos', 'clear_card: primary key (version_id, rotation_index, pos)'],
    ['k.rotation_index, k.pos', 'clear_card (version_id, rotation_index, pos) e clear_lineup_card (version_id, seq, rotation_index, pos), con seq fissato'],
    ['e.slot_no', 'clear_lineup_equipment: primary key (version_id, seq, rotation_index, pos, slot_no)'],
    ['2 desc, 1', 'carte: raggruppate per card_id (la colonna 1)'],
    ['x.n desc, ct.name nulls last, x.card_id', 'una riga per card_id (carte e leader raggruppati)'],
    ['t.n desc, array_position(enum_range(null::unit_type)::text[], t.tipo)', 'una riga per tipo'],
    ['t.n desc, t.classe desc', 'una riga per classe'],
    ['t.n desc, ctx.name, t.category_id', 'una riga per category_id'],
    ['l.version_id, l.seq', 'clear_lineup: primary key (version_id, seq)'],
    ['es.event_id, es.ends_at', 'distinct on per evento: si leggono solo id e ends_at, le righe pari sono uguali'],
    ['r.reg', 'card_release: primary key (card_id, reg)'],
    ['l.name, l.link_id', 'card_link: primary key (card_id, link_id)'],
    ['g.name, g.category_id', 'card_category: primary key (card_id, category_id)'],
    ['s.kind, s.tier, s.seq', 'card_skill: primary key (card_id, locale, kind, tier, seq), locale fissato'],
    ['id, abs(ord), ord', 'catena: awakens_from e\' una colonna, ogni carta ha un genitore solo: (id, ord) e\' unico'],
    ['r.released_at desc, r.card_id desc', 'card_release con reg fissato: card_id unico'],
    ['e', 'resolveHandle: id di evento, la union toglie i doppioni'],
    ['p.clears desc, p.handle', 'handle unico (citext)'],
    ['t.stage_tier_id nulls first, t.rn_top', 'row_number per tier: rn_top unico nel tier'],
  ])
  const ORDINI = ['ORDINE_CLEAR', 'ORDINE_CLEAR_NUOVI', 'ORDINE_CLEAR_TURNI']
  check('gli ordini dei clear finiscono con c.id', ORDINI.every((n) => conChiave(costanti.get(n) ?? '')),
    ORDINI.map((n) => `${n} = ${costanti.get(n)}`).join(' | '))
  const dubbi: string[] = []
  let n = 0
  for (const { dove, testo } of testi) {
    for (const grezza of clausole(testo)) {
      n++
      // l'ordine scelto dai filtri: uno dei tre qui sopra
      if (/^\$\{ORDINI_CLEAR\[filtri\.sort\] \?\? ORDINE_CLEAR\}$/.test(grezza)) continue
      const c = espandi(grezza).replace(/\s+/g, ' ').trim()
      if (!conChiave(c) && !UNICI.has(c)) dubbi.push(`${dove}: order by ${c}`)
    }
  }
  check(`${n} ORDER BY, ognuno con una chiave unica o un vincolo scritto qui`, dubbi.length === 0 && n >= 30, dubbi.join(' | '))
  // e la guardia guarda davvero: un ordine per nome soltanto non passa
  check('controprova: "order by g.name" non passerebbe', !conChiave('g.name') && !UNICI.has('g.name'))
}

console.log('niente Date.now o Math.random nel render delle pagine')
{
  const AMMESSI = new Map([
    ['components/clears/fuoco-filtri.ts', 'nel sessionStorage dopo un clic, solo nel browser: mai nel render'],
  ])
  const radici = [
    ...sorgenti('app').filter((r) => !/^app\/(api|admin)\//.test(r)), ...sorgenti('components'), ...sorgenti('lib/cache'),
    'lib/queries.ts', 'lib/clears.ts', 'lib/card-page.ts', 'lib/profiles.ts', 'lib/tips.ts', 'lib/clears/build.ts',
    'lib/clears/vista.ts', 'lib/clears/filtri-pagina.ts', 'lib/date.ts', 'lib/urls.ts', 'lib/robots.ts', 'lib/segnaposto.ts',
    'lib/livelli.ts', ...sorgenti('lib/versione'),
  ]
  const trovati = radici.filter((rel) => !AMMESSI.has(rel) &&
    /Date\.now\(|new Date\(\)|Math\.random\(|randomUUID\(|performance\.now\(|getRandomValues\(/.test(senzaCommenti(file(rel))))
  check(`${radici.length} file delle pagine pubbliche senza orologio ne' caso`, trovati.length === 0, trovati.join(', '))
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
