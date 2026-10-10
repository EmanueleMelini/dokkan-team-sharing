#!/usr/bin/env node
// Le fonti sono fresche? Il gioco esce con le sue versioni, e il datamine
// (Nicholas1006/dokkan-backend) lo segue con un esportatore automatico che
// si puo' fermare in silenzio quando cambia il client del gioco. Qui si
// confrontano: se il gioco e' chiaramente andato avanti e il datamine no,
// un avviso nel job e una riga fra le cose da guardare. Non fallisce mai
// il giro: un'API che non risponde e' un "not checked", e un errore
// qualsiasi diventa una notice con uscita 0.
//
//   node db/prod/freshness.mjs [--out freshness.md] [--attention attention.md]
//
// Le fonti, una richiesta ciascuna con 15 secondi al massimo:
//   - l'API di lookup di iTunes: Global 951627425, Japan 951627670 (con
//     country=jp: senza risponde resultCount 0). version e
//     currentVersionReleaseDate;
//   - l'ultimo commit di data/ del datamine (resolveCommit, lo stesso di
//     fetch-datamine);
//   - la dimensione di database.db sul repo del datamine, dall'elenco della
//     sua cartella: GitHub non accetta file oltre 100 MiB, e quando
//     database.db ci arriva l'esportatore non potra' piu' committarlo;
//   - la carta piu' recente del cards.csv in cache.
// Il token di GitHub (GITHUB_TOKEN) va solo ad api.github.com: headersFor.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DM_DIR, isSentinel, loadTable } from '../import/datamine.mjs'
import { REPO, UA, headersFor, resolveCommit } from '../import/datamine-source.mjs'

// Le soglie. Il datamine committa di solito ogni settimana, e fra agosto e
// settembre 2026 fra due carte nuove su Global sono passati al massimo 16
// giorni: 21 vuol dire che qualcosa si e' fermato.
export const APP_AHEAD_DAYS = 3          // l'app Global e' uscita e il datamine non l'ha seguita
export const DATAMINE_STALE_DAYS = 14    // nessun commit di data/ da due settimane
export const CARDS_STALE_DAYS = 21       // nessuna carta nuova da tre settimane
export const GITHUB_FILE_LIMIT = 104857600   // 100 MiB
export const UPSTREAM_DB_WARN_PCT = 98
// Dove sta database.db nel repo del datamine. Se non c'e' piu' li', si
// cerca un .db nella stessa cartella e il riepilogo dice il percorso
// trovato: e' l'indizio per correggere la costante.
export const UPSTREAM_DB_PATH = 'database.db'
export const ITUNES = { global: 951627425, japan: 951627670 }
const PLAYABLE = /^[123]\d{6}$/

const GIORNO = 86_400_000

// "2026-09-29 13:00:00" (il gioco, UTC senza fuso) o ISO -> Date
function quando(s) {
  if (!s) return null
  const t = String(s).trim()
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(' ', 'T') + 'Z' : t)
  return Number.isNaN(d.getTime()) ? null : d
}
const giorno = (d) => d.toISOString().slice(0, 10)
const giorni = (a, b) => Math.floor((a.getTime() - b.getTime()) / GIORNO)

/**
 * Il confronto, puro. Un ingresso mancante ({ why } o null) da' "not
 * checked" fra le informazioni, mai un avviso. Japan e' solo
 * informazione: il datamine e' di Global, e Japan e' avanti per natura.
 *
 * @param {{ now?: Date,
 *           global?: { version?: string | null, released_at?: string | null, why?: string } | null,
 *           japan?: { version?: string | null, released_at?: string | null, why?: string } | null,
 *           datamine?: { commit?: string | null, committed_at?: string | null, newest_card_open_at?: string | null,
 *                        why?: string } | null,
 *           upstreamDbBytes?: number | null, upstreamDbWhy?: string | null, upstreamDbPath?: string | null }} x
 * @returns {{ avvisi: string[], info: string[] }}
 */
export function confrontaFreschezza({ now = new Date(), global = null, japan = null, datamine = null,
                                       upstreamDbBytes = null, upstreamDbWhy = null, upstreamDbPath = null }) {
  const avvisi = [], info = []
  const g = quando(global?.released_at), j = quando(japan?.released_at)
  const c = quando(datamine?.committed_at), k = quando(datamine?.newest_card_open_at)

  info.push(g ? `Global app ${global?.version ?? '?'} released ${giorno(g)}`
              : `Global app: not checked (${global?.why ?? 'no answer'})`)
  info.push(j ? `Japan app ${japan?.version ?? '?'} released ${giorno(j)} (information only: Japan leads by design)`
              : `Japan app: not checked (${japan?.why ?? 'no answer'})`)
  info.push(c ? `datamine data/ last commit ${datamine?.commit ? `${String(datamine.commit).slice(0, 7)} ` : ''}of ${giorno(c)}`
              : `datamine data/ last commit: not checked (${datamine?.why ?? 'no answer'})`)
  info.push(k ? `newest card in the cached datamine opens ${giorno(k)}`
              : 'newest card in the cached datamine: not checked (no cards.csv)')
  if (upstreamDbBytes != null && Number.isFinite(upstreamDbBytes)) {
    const pct = Math.round((upstreamDbBytes / GITHUB_FILE_LIMIT) * 1000) / 10
    const mib = (upstreamDbBytes / 1024 / 1024).toFixed(1)
    const path = upstreamDbPath && upstreamDbPath !== UPSTREAM_DB_PATH ? ` (found at ${upstreamDbPath})` : ''
    info.push(`upstream database.db${path}: ${mib} MiB, ${pct}% of GitHub's 100 MiB file limit`)
    if (pct >= UPSTREAM_DB_WARN_PCT) {
      avvisi.push(`upstream database.db is at ${pct}% of GitHub's 100 MiB file limit: the datamine may soon be unable to commit it`)
    }
  } else info.push(`upstream database.db: not checked (${upstreamDbWhy ?? 'no answer'})`)

  if (g && c && giorni(now, g) > APP_AHEAD_DAYS && c < g) {
    avvisi.push(`Global app ${global?.version ?? '?'} released ${giorno(g)}; datamine data/ last commit ${giorno(c)}:` +
                ` not followed for ${giorni(now, g)} days`)
  }
  if (c && giorni(now, c) > DATAMINE_STALE_DAYS) {
    avvisi.push(`datamine data/ last commit ${giorno(c)}: no update for ${giorni(now, c)} days (it usually commits weekly)`)
  }
  if (k && giorni(now, k) > CARDS_STALE_DAYS) {
    avvisi.push(`newest card in the datamine opened ${giorno(k)}: no new card for ${giorni(now, k)} days`)
  }
  return { avvisi, info }
}

export function freschezzaMarkdown({ avvisi, info }) {
  return ['### Sources', '', ...info.map((x) => `- ${x}`), ...avvisi.map((x) => `- **Warning:** ${x}`), ''].join('\n')
}

// ------------------------------------------------------- le richieste

/** @param {(u: string, init?: any) => Promise<any>} fetchFn */
export async function lookupApp(fetchFn, id, country = null) {
  const u = `https://itunes.apple.com/lookup?id=${id}${country ? `&country=${country}` : ''}`
  const res = await fetchFn(u, { headers: { 'User-Agent': UA } })
  if (!res.ok) return { why: `HTTP ${res.status}` }
  const r = (await res.json())?.results?.[0]
  if (!r?.currentVersionReleaseDate) return { why: 'no result' }
  return { version: r.version ?? null, released_at: r.currentVersionReleaseDate }
}

/** @param {(u: string, init?: any) => Promise<any>} fetchFn @param {string | undefined} token */
export async function upstreamDbSize(fetchFn, token) {
  const cut = UPSTREAM_DB_PATH.lastIndexOf('/')
  const dir = cut >= 0 ? UPSTREAM_DB_PATH.slice(0, cut) : ''
  const name = UPSTREAM_DB_PATH.slice(cut + 1)
  const u = `https://api.github.com/repos/${REPO}/contents${dir ? `/${dir}` : ''}`
  const res = await fetchFn(u, { headers: headersFor(u, token) })
  if (!res.ok) return { why: `HTTP ${res.status}` }
  const list = await res.json()
  if (!Array.isArray(list)) return { why: 'unexpected answer from the contents API' }
  const hit = list.find((e) => e?.name === name) ?? list.find((e) => e?.type === 'file' && /\.db$/i.test(e?.name ?? ''))
  if (!hit || !Number.isFinite(Number(hit.size))) return { why: `${UPSTREAM_DB_PATH} not found upstream` }
  return { bytes: Number(hit.size), path: hit.path ?? null }
}

/** La carta giocabile piu' recente del cards.csv in cache, o null. */
export function newestCardOpenAt(rows) {
  let max = null
  for (const r of rows) {
    if (!PLAYABLE.test(String(r.id)) || !r.open_at || isSentinel(r.open_at)) continue
    if (!max || r.open_at > max) max = r.open_at
  }
  return max
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const CI = process.env.GITHUB_ACTIONS === 'true'
  try {
    const token = process.env.GITHUB_TOKEN || undefined
    const conTimeout = (u, init = {}) => fetch(u, { ...init, signal: AbortSignal.timeout(15000) })
    const perche = (err) => ({ why: err?.name === 'TimeoutError' ? 'timeout' : String(err?.message ?? err) })
    const [global, japan, commit, db] = await Promise.all([
      lookupApp(conTimeout, ITUNES.global).catch(perche),
      lookupApp(conTimeout, ITUNES.japan, 'jp').catch(perche),
      resolveCommit(conTimeout, { token }).catch(perche),
      upstreamDbSize(conTimeout, token).catch(perche),
    ])
    const csv = join(DM_DIR, 'cards.csv')
    const newest = existsSync(csv) ? newestCardOpenAt(loadTable('cards')) : null
    const r = confrontaFreschezza({
      now: new Date(), global, japan,
      datamine: { commit: commit.commit ?? null, committed_at: commit.committed_at ?? null,
                  newest_card_open_at: newest, why: commit.error ?? commit.why },
      upstreamDbBytes: db.bytes ?? null, upstreamDbWhy: db.why ?? null, upstreamDbPath: db.path ?? null,
    })
    for (const x of r.info) console.log(`  ${x}`)
    for (const a of r.avvisi) {
      console.log(CI ? `::warning::sources: ${a}` : `  attenzione: ${a}`)
      if (val('--attention')) appendFileSync(val('--attention'), `- Sources: ${a}.\n`)
    }
    if (val('--out')) writeFileSync(val('--out'), freschezzaMarkdown(r) + '\n')
  } catch (err) {
    console.log(`::notice::freshness of the sources not checked: ${err?.message ?? err}`)
  }
  process.exit(0)
}
