#!/usr/bin/env node
// Una copia durevole delle fotografie del datamine che importiamo, in un
// repository PRIVATO (EmanueleMelini/dokkan-team-sharing-ops).
//
//   node db/prod/datamine-archive.mjs push      archivia la cache di adesso
//   node db/prod/datamine-archive.mjs restore   rimette l'ultima archiviata
//
// Perche': il datamine e' il repo di un privato, senza licenza, con un
// database.db a un passo dal limite di 100 MiB di GitHub. Se sparisce o
// smette di aggiornarsi, la cache della CI non basta: qui resta, per
// sempre, ogni commit buono, cioe' arrivato intero e passato dal controllo
// delle sorgenti e dal giro di prova coi limiti (il settimanale archivia
// solo allora; in prova la produzione non lo importa, il giro di prova si').
// LATEST.json e' l'ultima fotografia buona, quella del ripiego. Mai in un
// posto pubblico: i CSV sono dati del gioco, non nostri da pubblicare.
// Per questo push controlla, a ogni giro, che il repo ops sia privato:
// creato pubblico per sbaglio, o reso pubblico dopo, non riceve niente.
//
// Serve il secret facoltativo OPS_ARCHIVE_TOKEN (un token fine-grained con
// Contents in lettura e scrittura sul solo repo ops; Metadata in lettura,
// che GitHub aggiunge da se', basta a vedere se e' privato). Senza, push
// dice una notice ed esce 0: il giro va avanti. Il token e' solo un header
// Authorization verso api.github.com: mai su disco, mai stampato, mai
// seguito su un redirect verso un altro host.
//
// Nel repo ops: datamine/datamine-<giorno del commit>-<sha7>.tar.gz, e
// datamine/LATEST.json { commit, committed_at, file, sha256, bytes }. Un
// tarball per commit del datamine: un push con lo stesso commit di
// LATEST.json non fa niente.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TABLES, UA } from '../import/datamine-source.mjs'
import { DM_DIR } from '../import/datamine.mjs'

export const OPS_REPO = 'EmanueleMelini/dokkan-team-sharing-ops'
export const OPS_BRANCH = 'main'
const API = 'https://api.github.com'
const DIR_REMOTA = 'datamine'

/**
 * Il nome del tarball di una fotografia (_snapshot.json di fetch-datamine).
 * @param {{ commit?: string | null, committed_at?: string | null }} snapshot
 */
export function nomeArchivio(snapshot) {
  const sha = String(snapshot?.commit ?? '')
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('la fotografia non dice un commit valido')
  const day = String(snapshot.committed_at ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('la fotografia non dice la data del commit')
  return `datamine-${day}-${sha.slice(0, 7)}.tar.gz`
}

/**
 * Se la fotografia va archiviata: si', a meno che LATEST.json dica gia'
 * lo stesso commit.
 * @param {{ commit?: string } | null} latest
 * @param {{ commit?: string | null }} snapshot
 */
export function daArchiviare(latest, snapshot) {
  if (!snapshot?.commit) return false
  return !latest || latest.commit !== snapshot.commit
}

// ---------------------------------------------------------------- GitHub

function gh(token) {
  return async (path, { method = 'GET', body, accept = 'application/vnd.github+json', raw = false } = {}) => {
    const u = `${API}${path}`
    const res = await fetch(u, {
      method, redirect: 'manual', signal: AbortSignal.timeout(120000),
      headers: { 'User-Agent': UA, Accept: accept, Authorization: `Bearer ${token}`,
                 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    // un redirect (i file grandi) si segue SENZA il token: l'URL nuovo
    // porta gia' la sua autorizzazione, e non e' api.github.com
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const r2 = await fetch(res.headers.get('location'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) })
      if (!r2.ok) throw Object.assign(new Error(`HTTP ${r2.status} dopo il redirect`), { status: r2.status })
      return raw ? Buffer.from(await r2.arrayBuffer()) : r2.json()
    }
    if (res.status === 404) return null
    if (!res.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${res.status}`), { status: res.status })
    return raw ? Buffer.from(await res.arrayBuffer()) : res.json()
  }
}

const RAW = 'application/vnd.github.raw+json'
const contents = (p) => `/repos/${OPS_REPO}/contents/${p}?ref=${OPS_BRANCH}`

async function leggiLatest(call) {
  const buf = await call(contents(`${DIR_REMOTA}/LATEST.json`), { accept: RAW, raw: true })
  return buf ? JSON.parse(buf.toString('utf8')) : null
}

function leggiSnapshot(dir = DM_DIR) {
  const p = join(dir, '_snapshot.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

/**
 * Perche' non archiviare nel repo ops, o null se si puo': deve vedersi col
 * token ed essere privato. repo: la risposta di GET /repos/{owner}/{repo}
 * (null per un 404). Un repo "internal" di un'organizzazione ha anche lui
 * private: true.
 * @param {{ private?: boolean } | null} repo
 */
export function motivoNonPrivato(repo) {
  if (!repo) return `${OPS_REPO} non si vede con questo token (non esiste, o il token non ha accesso)`
  if (repo.private !== true) return `${OPS_REPO} non e' privato: i CSV del datamine non vanno in un repository pubblico`
  return null
}

/** call: le richieste a api.github.com (i test ne passano una finta). */
export async function push(token, call = gh(token)) {
  // prima di tutto, e a ogni giro: un repo che e' diventato pubblico dopo
  // la creazione del token non deve ricevere niente
  const no = motivoNonPrivato(await call(`/repos/${OPS_REPO}`))
  if (no) { console.log(`::warning::datamine snapshot not archived: ${no}`); return }
  const snap = leggiSnapshot()
  if (!snap?.commit) { console.log('::notice::no datamine snapshot with a known commit: nothing to archive'); return }
  const nome = nomeArchivio(snap)
  const latest = await leggiLatest(call)
  if (!daArchiviare(latest, snap)) { console.log(`  gia' archiviato: ${nome}`); return }

  // le tabelle che importiamo e _snapshot.json, nient'altro
  const files = [...TABLES.map((t) => `${t}.csv`), '_snapshot.json'].filter((f) => existsSync(join(DM_DIR, f)))
  const tmp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'datamine-archive-'))
  try {
    const out = join(tmp, nome)
    const t = spawnSync('tar', ['-czf', out, '-C', DM_DIR, ...files], { stdio: ['ignore', 'inherit', 'inherit'] })
    if (t.status !== 0) throw new Error(`tar e' uscito ${t.status}`)
    const buf = readFileSync(out)
    if (buf.length > 95 * 1024 * 1024) throw new Error(`il tarball pesa ${(buf.length / 1e6).toFixed(0)} MB: oltre quello che un blob di GitHub accetta`)
    const sha256 = createHash('sha256').update(buf).digest('hex')
    const nuovo = { commit: snap.commit, committed_at: snap.committed_at, file: nome, sha256, bytes: buf.length }

    // Git Data API: blob, albero, commit, ref. Il repo ops deve avere gia'
    // un primo commit (creato con un README): su un repo vuoto non si puo'.
    const ref = await call(`/repos/${OPS_REPO}/git/ref/heads/${OPS_BRANCH}`)
    if (!ref?.object?.sha) {
      throw new Error(`${OPS_REPO} non ha il branch ${OPS_BRANCH}, o il token non lo vede: crealo con un primo commit` +
                      ' (un README) e dai al token Contents in lettura e scrittura su quel repo')
    }
    const parent = await call(`/repos/${OPS_REPO}/git/commits/${ref.object.sha}`)
    const blob = await call(`/repos/${OPS_REPO}/git/blobs`, { method: 'POST', body: { content: buf.toString('base64'), encoding: 'base64' } })
    const tree = await call(`/repos/${OPS_REPO}/git/trees`, { method: 'POST', body: {
      base_tree: parent.tree.sha,
      tree: [
        { path: `${DIR_REMOTA}/${nome}`, mode: '100644', type: 'blob', sha: blob.sha },
        { path: `${DIR_REMOTA}/LATEST.json`, mode: '100644', type: 'blob', content: JSON.stringify(nuovo, null, 1) + '\n' },
      ],
    } })
    const commit = await call(`/repos/${OPS_REPO}/git/commits`, { method: 'POST', body: {
      message: `Archive datamine ${snap.commit.slice(0, 7)} of ${String(snap.committed_at).slice(0, 10)}`,
      tree: tree.sha, parents: [ref.object.sha],
    } })
    await call(`/repos/${OPS_REPO}/git/refs/heads/${OPS_BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: false } })
    console.log(`  archiviato ${nome} (${(buf.length / 1e6).toFixed(1)} MB) in ${OPS_REPO}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function restore(token, dest = DM_DIR) {
  const call = gh(token)
  const latest = await leggiLatest(call)
  if (!latest?.file || !/^datamine-\d{4}-\d{2}-\d{2}-[0-9a-f]{7}\.tar\.gz$/.test(latest.file)) {
    throw new Error(`${OPS_REPO} non ha un datamine/LATEST.json valido`)
  }
  const buf = await call(contents(`${DIR_REMOTA}/${latest.file}`), { accept: RAW, raw: true })
  if (!buf) throw new Error(`${latest.file} non c'e' in ${OPS_REPO}`)
  const sha = createHash('sha256').update(buf).digest('hex')
  if (sha !== latest.sha256) throw new Error(`${latest.file}: sha256 diverso da LATEST.json`)
  // si estrae accanto alla cartella vera (lo stesso disco: rename e'
  // atomico) e si sposta solo se e' intera e coerente
  mkdirSync(dirname(dest), { recursive: true })
  const tmp = mkdtempSync(join(dirname(dest), '.datamine-restore-'))
  try {
    const tgz = join(tmp, latest.file)
    writeFileSync(tgz, buf)
    const out = join(tmp, 'datamine')
    mkdirSync(out)
    const t = spawnSync('tar', ['-xzf', tgz, '-C', out], { stdio: ['ignore', 'inherit', 'inherit'] })
    if (t.status !== 0) throw new Error(`tar e' uscito ${t.status}`)
    const snap = leggiSnapshot(out)
    if (snap?.commit !== latest.commit) throw new Error('il _snapshot.json del tarball non e\' il commit di LATEST.json')
    if (existsSync(dest)) {
      if (!statSync(dest).isDirectory()) throw new Error(`${dest} non e' una cartella`)
      rmSync(dest, { recursive: true, force: true })
    }
    renameSync(out, dest)
    console.log(`  ripristinato ${latest.file}: commit ${latest.commit.slice(0, 8)} del ${String(latest.committed_at).slice(0, 10)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cmd = process.argv[2]
  const token = process.env.OPS_ARCHIVE_TOKEN || ''
  if (cmd !== 'push' && cmd !== 'restore') {
    console.error('  uso: datamine-archive.mjs push|restore'); process.exit(1)
  }
  if (!token) {
    if (cmd === 'push') { console.log('::notice::OPS_ARCHIVE_TOKEN not set: datamine snapshot not archived'); process.exit(0) }
    console.error('\n  restore: serve OPS_ARCHIVE_TOKEN (vedi il README, "Fonti fresche e copia del datamine")\n')
    process.exit(1)
  }
  try {
    if (cmd === 'push') await push(token)
    else await restore(token)
  } catch (err) {
    // push non ferma mai il giro; restore si', chi lo chiama decide
    if (cmd === 'push') { console.log(`::warning::datamine snapshot not archived: ${err.message}`); process.exit(0) }
    console.error(`\n  restore: ${err.message}\n`); process.exit(1)
  }
}
