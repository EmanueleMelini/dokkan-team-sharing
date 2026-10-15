// Cosa rinfrescare sul sito dopo un giro dell'import (update.mjs), e la
// richiesta a POST /api/revalidate.
//
// Un tag invalidato non costa niente da solo: la pagina si rigenera alla
// visita dopo, e una rigenerazione con gli stessi byte non e' una scrittura
// ISR. Costa la CPU di ogni pagina rigenerata, e la scrittura di ogni pagina
// che cambia davvero. Per questo:
//
//   - un giro che non ha cambiato niente non chiama il sito, a meno che il
//     giro prima abbia lasciato pagine da rinfrescare (daRecuperare): un
//     giro fermato a meta' ha gia' scritto i dati dei passi riusciti, e il
//     giro dopo, che fotografa le tabelle quando comincia, non li vedrebbe;
//   - un giro che si ferma a un passo fallito rinfresca prima di uscire le
//     pagine di quello che ha gia' scritto;
//   - un giro completo manda catalog ed events-list (i dati di gioco stanno
//     su ogni pagina pubblica, e capire quali cambiano non vale la pena);
//   - un giro delle sole immagini manda card:<id> ed event:<id> delle righe
//     che ha toccato (piu' events-list se tocca un evento: la lista mostra
//     banner e copertine). Le altre pagine che mostrano quelle immagini (i
//     clear di un evento con la miniatura di una carta, la catena di
//     un'altra carta, le missioni) si allineano col revalidate di un giorno.
//     Si torna a catalog quando il giro tocca un'icona (tipo, rarita',
//     premio: sono su quasi ogni pagina), una tabella che non dovrebbe
//     toccare, o piu' di TAG_TETTO pagine: a quel punto un tag solo costa
//     meno di tante richieste, e rinfresca lo stesso quasi tutto.
//
// Mai 'community' e mai { expire: 0 } da qui: /api/revalidate usa sempre
// 'max' (la visita dopo riceve la copia vecchia e la rigenera dietro).
//
// Moduli puri e due letture sul database (legamiAsset, giroPrecedente),
// per i test (db/test/weekly-data.test.mts).

/** Quanti tag per richiesta: TAG_MAX di lib/cache/revalidate.ts (il test li confronta). */
export const TAG_PER_RICHIESTA = 50
/** Oltre questi tag un giro delle immagini manda TUTTO: sei richieste al massimo. */
export const TAG_TETTO = 300
/** Il rinfresco di tutti i dati di gioco. */
export const TUTTO = ['catalog', 'events-list']

const ID = /^\d{1,18}$/
const perId = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0)
const unici = (xs) => [...new Set(xs)].filter((x) => ID.test(x)).sort(perId)

/**
 * Le tabelle di gioco cambiate fra due fotografie di snapshot.mjs, ciascuna
 * con le chiavi delle righe aggiunte, tolte o cambiate. null: la tabella c'e'
 * in una fotografia sola (le chiavi non si possono confrontare).
 *
 * @param {{ tables: Record<string, any> }} prima
 * @param {{ tables: Record<string, any> }} dopo
 * @returns {Record<string, string[] | null>}
 */
export function cambiamenti(prima, dopo) {
  /** @type {Record<string, string[] | null>} */
  const out = {}
  const nomi = [...new Set([...Object.keys(prima.tables), ...Object.keys(dopo.tables)])].sort()
  for (const t of nomi) {
    const b = prima.tables[t], a = dopo.tables[t]
    if ((a ?? b).class !== 'content') continue
    if (!a || !b || !a.rows || !b.rows) { out[t] = null; continue }
    const chiavi = []
    for (const [k, h] of Object.entries(a.rows)) if (b.rows[k] !== h) chiavi.push(k)
    for (const k of Object.keys(b.rows)) if (!Object.hasOwn(a.rows, k)) chiavi.push(k)
    if (chiavi.length) out[t] = chiavi
  }
  return out
}

/**
 * Le colonne che puntano a un asset, e cosa rinfrescare quando quell'asset
 * cambia (anche solo la cornice o le misure: asset_bare e la pagina della
 * carta le leggono). Il test le confronta con le FK verso asset(key) dello
 * schema: una colonna nuova deve arrivare anche qui.
 */
export const COLLEGAMENTI_ASSET = {
  'card.thumb_key': 'card',
  'card.art_key': 'card',
  'card.thumb_animated_key': 'card',
  'card.art_animated_key': 'card',
  'event.banner_key': 'event',
  'type_icon.asset_key': 'icona',
  'rarity_icon.asset_key': 'icona',
  'rarity_icon.animated_asset_key': 'icona',
  'reward_item.asset_key': 'icona',
}

const colonne = (tabella, tipo) => Object.entries(COLLEGAMENTI_ASSET)
  .filter(([c, v]) => v === tipo && c.startsWith(`${tabella}.`)).map(([c]) => c.split('.')[1])
const usa = (cols) => cols.map((c) => `${c} = any($1::text[])`).join(' or ')

/**
 * Le pagine dietro le righe di un giro delle immagini, lette sul database
 * DOPO il giro: le carte e gli eventi che usano gli asset cambiati, gli
 * eventi che hanno per copertina una carta toccata (la miniatura del boss),
 * e se un asset cambiato e' un'icona. Solo SELECT.
 *
 * @param {import('pg').ClientBase} client
 * @param {{ assetKeys: string[], cardIds: string[] }} toccati
 */
export async function legamiAsset(client, { assetKeys, cardIds }) {
  const keys = [...new Set(assetKeys)]
  const carte = new Set(cardIds.filter((id) => ID.test(id)))
  const eventi = new Set()
  let icone = false
  if (keys.length) {
    const c = await client.query(`select id::text as id from card where ${usa(colonne('card', 'card'))}`, [keys])
    for (const r of c.rows) carte.add(r.id)
    const e = await client.query(`select id::text as id from event where ${usa(colonne('event', 'event'))}`, [keys])
    for (const r of e.rows) eventi.add(r.id)
    const perTabella = Object.keys(COLLEGAMENTI_ASSET).filter((c) => COLLEGAMENTI_ASSET[c] === 'icona')
      .reduce((m, c) => { const [t, col] = c.split('.'); (m[t] ??= []).push(col); return m }, /** @type {Record<string, string[]>} */ ({}))
    const esiste = Object.entries(perTabella).map(([t, cols]) => `exists (select 1 from ${t} where ${usa(cols)})`).join(' or ')
    icone = (await client.query(`select ${esiste} as icone`, [keys])).rows[0].icone === true
  }
  const copertine = []
  if (carte.size) {
    const r = await client.query('select id::text as id from event where cover_card_id = any($1::bigint[])', [[...carte]])
    for (const x of r.rows) { eventi.add(x.id); copertine.push(x.id) }
  }
  return { carte: unici([...carte]), eventi: unici([...eventi]), copertine: unici(copertine), icone }
}

/** Le tabelle che un giro delle immagini puo' toccare senza tornare a TUTTO. */
const DELLE_IMMAGINI = new Set(['card', 'event', 'asset'])

/** Un giro delle immagini che ha toccato solo carte, eventi e asset (con le chiavi). */
export const soloImmagini = (cambi) =>
  Object.entries(cambi).every(([t, k]) => DELLE_IMMAGINI.has(t) && k !== null)

/**
 * Com'e' finito il rinfresco di un giro, in import_run.summary.refresh:
 * 'sent' (arrivato tutto), 'nothing' (niente da rinfrescare), 'failed'
 * (almeno un gruppo non arrivato), 'off' (senza PROD_SITE_URL o CRON_SECRET).
 */
export const RINFRESCO_CHIUSO = new Set(['sent', 'nothing'])

/**
 * Il giro chiuso prima di questo (import_run_begin ha gia' chiuso come stale
 * quelli morti da piu' di 2 ore). Solo SELECT. null: e' il primo.
 *
 * @param {import('pg').ClientBase} client
 * @param {number | string} id  il giro appena aperto
 * @returns {Promise<{ id: string, status: string, refresh: string | null } | null>}
 */
export async function giroPrecedente(client, id) {
  const r = await client.query(`
    select id::text as id, status, summary->>'refresh' as refresh
    from import_run where id < $1 and status <> 'running'
    order by id desc limit 1`, [id])
  return r.rows[0] ?? null
}

/**
 * Il giro prima ha lasciato pagine da rinfrescare? Si', se non dice di aver
 * chiuso il conto ('sent' o 'nothing'): un passo fallito prima del
 * rinfresco, un rinfresco non arrivato, un processo morto (chiuso come
 * stale), un giro senza il segreto, un giro di prima di summary.refresh.
 * Allora il giro dopo manda TUTTO anche se lui non cambia niente.
 *
 * @param {{ status: string, refresh?: string | null } | null | undefined} precedente
 */
export const daRecuperare = (precedente) => Boolean(precedente) && !RINFRESCO_CHIUSO.has(precedente?.refresh ?? '')

/**
 * I tag da mandare dopo un giro, e perche'. tags vuoto: niente da chiamare.
 *
 * @param {Record<string, string[] | null>} cambi  da cambiamenti()
 * @param {{ imagesOnly: boolean, legami?: Awaited<ReturnType<typeof legamiAsset>> | null, recupera?: boolean }} opts
 *   recupera: il giro prima ha lasciato pagine da rinfrescare (daRecuperare)
 * @returns {{ tags: string[], motivo: string }}
 */
export function pianoRinfresco(cambi, { imagesOnly, legami = null, recupera = false }) {
  if (recupera) return { tags: TUTTO, motivo: 'the previous run did not finish refreshing what it wrote' }
  const tabelle = Object.keys(cambi)
  if (!tabelle.length) return { tags: [], motivo: 'no game data changed' }
  if (!imagesOnly) return { tags: TUTTO, motivo: `game data changed (${tabelle.join(', ')})` }
  if (!soloImmagini(cambi)) {
    const altre = tabelle.filter((t) => !DELLE_IMMAGINI.has(t) || cambi[t] === null)
    return { tags: TUTTO, motivo: `the images run changed ${altre.join(', ')}` }
  }
  if (!legami) return { tags: TUTTO, motivo: 'pages behind the changed rows unknown' }
  if (legami.icone) return { tags: TUTTO, motivo: 'an icon changed (type, rarity or reward)' }
  const carte = unici([...(cambi.card ?? []), ...legami.carte])
  const eventi = unici([...(cambi.event ?? []), ...legami.eventi])
  if (!carte.length && !eventi.length) return { tags: [], motivo: 'only asset rows nothing links to changed' }
  const tags = [
    ...carte.map((id) => `card:${id}`),
    ...eventi.map((id) => `event:${id}`),
    ...(eventi.length ? ['events-list'] : []),
  ]
  if (tags.length > TAG_TETTO) return { tags: TUTTO, motivo: `${tags.length} pages, over ${TAG_TETTO}: catalog instead` }
  return { tags, motivo: `${carte.length} card and ${eventi.length} event pages` }
}

/** I tag a gruppi di TAG_PER_RICHIESTA: il limite di una richiesta a /api/revalidate. */
export function gruppi(tags, n = TAG_PER_RICHIESTA) {
  const out = []
  for (let i = 0; i < tags.length; i += n) out.push(tags.slice(i, i + n))
  return out
}

/**
 * POST /api/revalidate, un gruppo per richiesta, col segreto del cron. E'
 * un tentativo: se fallisce lo dice e basta, i dati sono gia' scritti e le
 * pagine si allineano col revalidate di un giorno. Il segreto non viaggia
 * mai in chiaro (solo https).
 *
 * @param {{ site: string, secret: string, tags: string[], fetch?: typeof fetch,
 *           log?: (m: string) => void, warn?: (m: string) => void }} a
 * @returns {Promise<{ inviati: number, falliti: number }>}
 */
export async function rinfresca({ site, secret, tags, fetch: chiama = globalThis.fetch, log = console.log, warn = console.warn }) {
  let u
  try { u = new URL('/api/revalidate', site) } catch { warn('PROD_SITE_URL is not a valid URL'); return { inviati: 0, falliti: 0 } }
  if (u.protocol !== 'https:') { warn('PROD_SITE_URL must be https: page refresh skipped'); return { inviati: 0, falliti: 0 } }
  let inviati = 0, falliti = 0
  for (const g of gruppi(tags)) {
    try {
      const res = await chiama(u, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: g }),
      })
      if (res.ok) inviati += g.length
      else { falliti += g.length; warn(`page refresh answered HTTP ${res.status}: those pages update when their cache revalidates`) }
    } catch (err) {
      falliti += g.length
      warn(`page refresh failed (${err?.name ?? err}): those pages update when their cache revalidates`)
    }
  }
  if (inviati) log(`  pagine rinfrescate: ${inviati} tag${falliti ? `, ${falliti} non arrivati` : ''}`)
  return { inviati, falliti }
}
