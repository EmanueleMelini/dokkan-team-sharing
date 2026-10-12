// Le fonti fresche (db/prod/freshness.mjs) e la copia privata del datamine
// (db/prod/datamine-archive.mjs). Funzioni pure e richieste finte: nessuna
// rete, nessun token. push su un repo ops che non e' privato non carica
// niente; l'ultimo controllo lancia "push" senza token, che deve dire una
// notice ed uscire 0 senza toccare niente.
//
//   node db/test/fonti.test.mjs
import { spawnSync } from 'node:child_process'
import { OPS_REPO, daArchiviare, motivoNonPrivato, nomeArchivio, push } from '../prod/datamine-archive.mjs'
import {
  APP_AHEAD_DAYS, CARDS_STALE_DAYS, DATAMINE_STALE_DAYS, GITHUB_FILE_LIMIT, confrontaFreschezza, freschezzaMarkdown,
  lookupApp, newestCardOpenAt, upstreamDbSize,
} from '../prod/freshness.mjs'

let fails = 0
let passes = 0
function check(nome, ok, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}

// i valori misurati il 2026-10-10
const OGGI = {
  now: new Date('2026-10-10T12:00:00Z'),
  global: { version: '6.5.5', released_at: '2026-08-29T09:23:15Z' },
  japan: { version: '6.6.0', released_at: '2026-10-07T03:57:23Z' },
  datamine: { commit: '86e8684e0ea1454d672c608246563884c8fa6109', committed_at: '2026-10-02T14:39:44Z',
              newest_card_open_at: '2026-09-29 13:00:00' },
  upstreamDbBytes: 101199872,
}
const con = (extra) => confrontaFreschezza({ ...OGGI, ...extra, datamine: { ...OGGI.datamine, ...(extra.datamine ?? {}) } })

console.log('il confronto')
{
  const r = confrontaFreschezza(OGGI)
  check('oggi: nessun avviso', r.avvisi.length === 0, r.avvisi.join(' | '))
  check('...e database.db al 96,5% di 100 MiB, come informazione', r.info.some((x) => x.includes('96.5%')), r.info.join(' | '))
  check('...le versioni e il commit fra le informazioni', r.info.some((x) => x.includes('6.5.5') && x.includes('2026-08-29')) &&
    r.info.some((x) => x.includes('86e8684') && x.includes('2026-10-02')) && r.info.some((x) => x.includes('6.6.0')))

  const app4 = con({ global: { version: '6.6.0', released_at: '2026-10-06T09:00:00Z' } })
  check(`l'app Global uscita da 4 giorni, il datamine fermo prima: un avviso (soglia ${APP_AHEAD_DAYS})`, app4.avvisi.length === 1 &&
    /Global app 6\.6\.0 released 2026-10-06; datamine data\/ last commit 2026-10-02: not followed for 4 days/.test(app4.avvisi[0]), app4.avvisi.join(' | '))
  check('...da 2 giorni: ancora niente', con({ global: { version: '6.6.0', released_at: '2026-10-08T09:00:00Z' } }).avvisi.length === 0)
  check('...e se il datamine ha committato dopo l\'uscita: niente',
    con({ global: { version: '6.6.0', released_at: '2026-10-01T09:00:00Z' } }).avvisi.length === 0)

  const vecchio = con({ datamine: { committed_at: '2026-09-25T10:00:00Z' } })
  check(`un commit di 15 giorni fa: un avviso (soglia ${DATAMINE_STALE_DAYS})`, vecchio.avvisi.length === 1 && /15 days/.test(vecchio.avvisi[0]), vecchio.avvisi.join(' | '))
  check('...di 14 no', con({ datamine: { committed_at: '2026-09-26T12:00:00Z' } }).avvisi.length === 0)

  const carta = con({ datamine: { newest_card_open_at: '2026-09-18 05:00:00' } })
  check(`la carta piu' recente di 22 giorni fa: un avviso (soglia ${CARDS_STALE_DAYS})`, carta.avvisi.length === 1 && /no new card for 22 days/.test(carta.avvisi[0]),
    carta.avvisi.join(' | '))

  const db = con({ upstreamDbBytes: 103000000 })
  check('database.db a 103.000.000 byte (98,2%): un avviso', db.avvisi.length === 1 && /98\.2%/.test(db.avvisi[0]), db.avvisi.join(' | '))
  check('...il limite e\' 100 MiB', GITHUB_FILE_LIMIT === 100 * 1024 * 1024)

  const nulla = confrontaFreschezza({ now: OGGI.now, global: { why: 'HTTP 503' }, japan: null, datamine: { why: 'timeout' } })
  check('ingressi mancanti: solo informazioni, mai avvisi', nulla.avvisi.length === 0 &&
    nulla.info.filter((x) => /not checked/.test(x)).length === 5, nulla.info.join(' | '))
  check('...e dicono perche\'', nulla.info.some((x) => x.includes('HTTP 503')) && nulla.info.some((x) => x.includes('timeout')))
  const jp = con({ japan: { version: '9.9.9', released_at: '2026-01-01T00:00:00Z' } })
  check('Japan non avvisa mai, nemmeno vecchia o avanti', jp.avvisi.length === 0 &&
    con({ japan: { version: '7.0.0', released_at: '2026-10-09T00:00:00Z' } }).avvisi.length === 0)
  const md = freschezzaMarkdown(app4)
  check('il riepilogo: ### Sources, le informazioni e l\'avviso', md.startsWith('### Sources') && md.includes('- **Warning:** Global app 6.6.0'))
}

console.log('\nle richieste (finte)')
{
  const chiamate = []
  const finta = (status, body) => async (url, init) => {
    chiamate.push({ url, headers: init?.headers ?? {} })
    return { ok: status < 400, status, json: async () => body }
  }
  const g = await lookupApp(finta(200, { resultCount: 1, results: [{ version: '6.5.5', currentVersionReleaseDate: '2026-08-29T09:23:15Z' }] }), 951627425)
  check('iTunes: versione e data', g.version === '6.5.5' && g.released_at === '2026-08-29T09:23:15Z')
  await lookupApp(finta(200, { resultCount: 0, results: [] }), 951627670, 'jp')
  check('iTunes Japan: con country=jp', chiamate.at(-1).url === 'https://itunes.apple.com/lookup?id=951627670&country=jp')
  check('iTunes: nessun risultato e\' un "perche\'"', (await lookupApp(finta(200, { resultCount: 0 }), 1)).why === 'no result')
  check('iTunes: niente token, solo lo User-Agent', !chiamate.some((c) => 'Authorization' in c.headers) &&
    chiamate.every((c) => /^DokkanTeamSharing\//.test(c.headers['User-Agent'])))
  const cartella = 'Dokkan_Asset_Downloader/card_assets/global/en/sqlite/current/en'
  const lista = [{ name: 'other.json', type: 'file', size: 10, path: `${cartella}/other.json` },
                 { name: 'database.db', type: 'file', size: 101199872, path: `${cartella}/database.db` }]
  const s = await upstreamDbSize(finta(200, lista), 'tok')
  check('database.db: la dimensione dall\'elenco della cartella', s.bytes === 101199872 && s.path === `${cartella}/database.db`)
  check('...la cartella vera del repo del datamine', chiamate.at(-1).url === `https://api.github.com/repos/Nicholas1006/dokkan-backend/contents/${cartella}`)
  check('...il token va solo ad api.github.com', chiamate.at(-1).url.startsWith('https://api.github.com/repos/Nicholas1006/dokkan-backend/contents')
    && chiamate.at(-1).headers.Authorization === 'Bearer tok')
  const spostato = await upstreamDbSize(finta(200, [{ name: 'game.db', type: 'file', size: 5, path: `${cartella}/game.db` }]), undefined)
  check('...se non si chiama piu\' cosi\', il .db della cartella, col suo percorso', spostato.bytes === 5 && spostato.path === `${cartella}/game.db`)
  check('...un 404 e\' un "perche\'"', (await upstreamDbSize(finta(404, {}), undefined)).why === 'HTTP 404')
  check('la carta piu\' recente: giocabile, senza il 2038', newestCardOpenAt([
    { id: '1034150', open_at: '2026-09-29 13:00:00' }, { id: '4034150', open_at: '2026-12-01 00:00:00' },
    { id: '1034160', open_at: '2038-01-01 00:00:00' }, { id: '50003011', open_at: '2027-01-01 00:00:00' },
    { id: '1000010', open_at: '2015-07-16 00:00:00' }]) === '2026-09-29 13:00:00')
}

console.log('\nla copia del datamine')
{
  const snap = { commit: '86e8684e0ea1454d672c608246563884c8fa6109', committed_at: '2026-10-02T14:39:44Z' }
  check('il nome del tarball: giorno del commit e sha7', nomeArchivio(snap) === 'datamine-2026-10-02-86e8684.tar.gz')
  let errore = ''
  try { nomeArchivio({ commit: 'HEAD', committed_at: null }) } catch (e) { errore = e.message }
  check('una fotografia senza commit non ha un nome', /commit valido/.test(errore), errore)
  check('daArchiviare: nessun LATEST.json, si', daArchiviare(null, snap))
  check('...lo stesso commit, no', !daArchiviare({ commit: snap.commit }, snap))
  check('...un commit diverso, si', daArchiviare({ commit: 'a'.repeat(40) }, snap))
  check('...una fotografia senza commit, no', !daArchiviare(null, { commit: null }))

  // il repo ops deve essere privato, controllato a ogni push prima di tutto
  check('motivoNonPrivato: privato, si puo\'', motivoNonPrivato({ private: true }) === null)
  check('...pubblico, no', /non e' privato/.test(motivoNonPrivato({ private: false }) ?? ''))
  check('...senza il campo, no', /non e' privato/.test(motivoNonPrivato({}) ?? ''))
  check('...un 404 (il token non lo vede), no', /non si vede/.test(motivoNonPrivato(null) ?? ''))
  const pushFinto = async (repo) => {
    const richieste = [], righe = []
    const call = async (path, { method = 'GET' } = {}) => {
      richieste.push(`${method} ${path}`)
      return path === `/repos/${OPS_REPO}` ? repo : null
    }
    const log = console.log
    console.log = (...a) => righe.push(a.join(' '))
    try { await push('tok', call) } finally { console.log = log }
    return { richieste, righe }
  }
  for (const [nome, repo] of [['pubblico', { private: false, full_name: OPS_REPO }], ['che il token non vede', null]]) {
    const { richieste, righe } = await pushFinto(repo)
    check(`push su un repo ops ${nome}: una sola GET, nessun upload`,
      richieste.length === 1 && richieste[0] === `GET /repos/${OPS_REPO}`, richieste.join(', '))
    check('...e un warning che lo dice', righe.some((r) => r.startsWith('::warning::datamine snapshot not archived:')), righe.join(' | '))
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'OPS_ARCHIVE_TOKEN'))
  const r = spawnSync(process.execPath, ['db/prod/datamine-archive.mjs', 'push'], { encoding: 'utf8', env: { ...env, OPS_ARCHIVE_TOKEN: '' } })
  check('push senza OPS_ARCHIVE_TOKEN: una notice, uscita 0', r.status === 0 &&
    r.stdout.includes('::notice::OPS_ARCHIVE_TOKEN not set: datamine snapshot not archived'), `uscita ${r.status} ${r.stderr.slice(0, 200)}`)
  const r2 = spawnSync(process.execPath, ['db/prod/datamine-archive.mjs', 'restore'], { encoding: 'utf8', env: { ...env, OPS_ARCHIVE_TOKEN: '' } })
  check('restore senza OPS_ARCHIVE_TOKEN: rifiuta, senza toccare la cache', r2.status === 1 && /serve OPS_ARCHIVE_TOKEN/.test(r2.stderr))
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
