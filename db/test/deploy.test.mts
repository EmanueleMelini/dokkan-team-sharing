// I deploy su Vercel (scripts/vercel-ignore.mjs, vercel.json ignoreCommand):
// ogni deploy di produzione riparte con la cache ISR vuota, quindi si
// costruisce solo dal branch release e solo quando cambia qualcosa che il
// sito esegue. La decisione con un git finto, poi su un repository git vero
// in una cartella temporanea (anche lanciata da un link simbolico), poi le
// guardie: ogni voce del repository e' classificata, e il codice del sito
// non legge niente di quello che il deploy salta.
//
// Niente database, niente rete. Il repository del progetto si legge e basta.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NON_RUNTIME, RAMO_PRODUZIONE, RUNTIME, decidi, saltabile } from '../../scripts/vercel-ignore-decidi.mjs'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = join(RADICE, 'scripts/vercel-ignore.mjs')
const A = 'a'.repeat(40), B = 'b'.repeat(40)

console.log('la decisione, con un git finto')
{
  type Git = (args: string[]) => { status: number | null, stdout?: string }
  const git = (diff: number | null, { manca = false, head = B, file = ['app/page.tsx'] }: { manca?: boolean, head?: string, file?: string[] } = {}): Git => (args) => {
    if (args[0] === 'rev-parse' && args.includes('HEAD^{commit}')) return { status: 0, stdout: `${head}\n` }
    if (args[0] === 'rev-parse') return manca ? { status: 1, stdout: '' } : { status: 0, stdout: `${A}\n` }
    if (args[0] === 'diff') {
      const attesi = ['diff', '--name-only', '--no-renames', '-z', A, 'HEAD']
      if (args.join(' ') !== attesi.join(' ')) throw new Error(`git ${args.join(' ')}?`)
      return { status: diff, stdout: diff === 0 ? file.map((f) => `${f}\0`).join('') : '' }
    }
    throw new Error(`git ${args.join(' ')}?`)
  }
  const nessunGit: Git = () => { throw new Error('git non va chiamato') }
  const prod = { VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: A, VERCEL_GIT_COMMIT_REF: RAMO_PRODUZIONE }
  const docs = { file: ['README.md', 'db/x.sql', '.github/workflows/w.yml', 'scripts/vercel-ignore.mjs'] }
  check('il branch di produzione e\' release', RAMO_PRODUZIONE === 'release')
  check('preview: mai (0)', decidi({ VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: A }, nessunGit).esito === 0)
  check('...anche dal branch release', decidi({ ...prod, VERCEL_ENV: 'preview' }, nessunGit).esito === 0)
  const daMain = decidi({ ...prod, VERCEL_GIT_COMMIT_REF: 'main' }, nessunGit)
  check('produzione da main (il Production Branch rimesso a main): saltata (0)', daMain.esito === 0 && /only from release, this is main/.test(daMain.motivo), daMain.motivo)
  check('...anche senza il commit di prima', decidi({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'dev' }, nessunGit).esito === 0)
  check('...e senza VERCEL_ENV', decidi({ VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: A }, nessunGit).esito === 0)
  check('senza VERCEL_GIT_COMMIT_REF (un deploy dalla CLI): si va avanti', decidi({ VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: A }, git(0)).esito === 1)
  check('...e con il ref vuoto, lo stesso', decidi({ ...prod, VERCEL_GIT_COMMIT_REF: ' ' }, git(0, docs)).esito === 0)
  check('produzione senza il commit di prima: si costruisce (1)', decidi({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'release' }, nessunGit).esito === 1)
  check('...anche vuoto o fatto di spazi', decidi({ ...prod, VERCEL_GIT_PREVIOUS_SHA: '  ' }, nessunGit).esito === 1)
  check('un commit di prima che non e\' uno SHA: si costruisce', decidi({ ...prod, VERCEL_GIT_PREVIOUS_SHA: 'main; rm -rf /' }, nessunGit).esito === 1)
  check('il commit di prima non e\' nel clone (poco profondo): si costruisce', decidi(prod, git(0, { manca: true, ...docs })).esito === 1)
  check('lo stesso commit (un Redeploy dalla dashboard): si costruisce', decidi(prod, git(0, { head: A, ...docs })).esito === 1)
  check('solo README, db/, workflow e scripts/: si salta (0)', decidi(prod, git(0, docs)).esito === 0)
  check('nessun file cambiato (un revert): si salta', decidi(prod, git(0, { file: [] })).esito === 0)
  check('codice cambiato: si costruisce', decidi(prod, git(0, { file: ['README.md', 'app/page.tsx'] })).esito === 1)
  check('una voce che lo script non conosce (types/, .npmrc, vercel.ts): si costruisce',
    ['types/g.d.ts', '.npmrc', 'vercel.ts', 'styles/a.css'].every((f) => decidi(prod, git(0, { file: ['README.md', f] })).esito === 1))
  check('un file in cima che somiglia a una voce saltata (db.ts, README.md.bak): si costruisce',
    decidi(prod, git(0, { file: ['db.ts'] })).esito === 1 && decidi(prod, git(0, { file: ['README.md.bak'] })).esito === 1)
  check('git diff fallito (128): si costruisce', decidi(prod, git(128)).esito === 1)
  check('git ucciso da un segnale o buffer pieno (status null): si costruisce', decidi(prod, git(null)).esito === 1)
  check('senza VERCEL_ENV (un deploy dalla CLI) vale come produzione', decidi({ VERCEL_GIT_PREVIOUS_SHA: A }, git(0, docs)).esito === 0)
  const motivo = decidi(prod, git(0, docs)).motivo
  check('il motivo dice da quale commit', motivo.includes(A.slice(0, 7)), motivo)
  const motivo2 = decidi(prod, git(0, { file: ['a.ts', 'app/1', 'app/2', 'app/3', 'app/4'] })).motivo
  check('...e quali file costruiscono, i primi tre', /\(a\.ts, app\/1, app\/2 and 2 more\): building$/.test(motivo2), motivo2)
  check('saltabile: la prima voce del percorso', saltabile('db/test/x.mts') && saltabile('README.md') && saltabile('.github/workflows/a.yml') &&
    !saltabile('app/db/x.ts') && !saltabile('lib/README.md') && !saltabile('dbx/a'))
}

console.log('su un repository git vero (cartella temporanea)')
{
  const dir = mkdtempSync(join(tmpdir(), 'dts-deploy-'))
  // git senza la configurazione di chi lancia i test: niente firme, hook o alias
  const ambiente = {
    ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  }
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env: ambiente, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const scrivi = (rel: string, testo: string) => { mkdirSync(join(dir, dirname(rel)), { recursive: true }); writeFileSync(join(dir, rel), testo) }
  const commit = (msg: string) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD') }
  // lo script com'e' sul disco, o da un altro percorso (un link simbolico)
  const lancia = (env: Record<string, string>, script = SCRIPT) => {
    const r = spawnSync(process.execPath, [script], {
      cwd: dir, encoding: 'utf8',
      // un ambiente minimo, come quello del build: solo quello che serve a git
      env: { PATH: process.env.PATH ?? '', HOME: dir, ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } as unknown as NodeJS.ProcessEnv,
    })
    return { esito: r.status, testo: (r.stdout + r.stderr).trim() }
  }
  const prod = (prima?: string, ramo = 'release') => ({
    VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: ramo, ...(prima ? { VERCEL_GIT_PREVIOUS_SHA: prima } : {}),
  })
  try {
    git('init', '-q', '-b', 'release')
    scrivi('app/page.tsx', 'export default 1\n')
    scrivi('README.md', '# prova\n')
    scrivi('db/x.sql', 'select 1;\n')
    scrivi('package.json', '{}\n')
    // i due file dello script nel repository, come nel clone di Vercel
    for (const f of ['vercel-ignore.mjs', 'vercel-ignore-decidi.mjs']) scrivi(`scripts/${f}`, readFileSync(join(RADICE, 'scripts', f), 'utf8'))
    const c0 = commit('base')
    scrivi('README.md', '# prova, due\n')
    scrivi('db/x.sql', 'select 2;\n')
    scrivi('db/è un file.sql', 'select 3;\n')
    scrivi('.github/workflows/w.yml', 'on: push\n')
    scrivi('test/smoke.sh', 'echo\n')
    const c1 = commit('solo docs, db, test, workflow')
    let r = lancia(prod(c0))
    check('README, db/ (anche un nome con spazi e accenti), test/ e un workflow: deploy saltato (0)', r.esito === 0, r.testo)
    check('...e lo dice nel log', /^ignored build step: nothing the site runs changed since [0-9a-f]{7} \(5 files changed\)/.test(r.testo), r.testo)
    const relativo = spawnSync(process.execPath, ['scripts/vercel-ignore.mjs'], { cwd: dir, encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: dir, ...prod(c0), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } as unknown as NodeJS.ProcessEnv })
    check('...anche come lo lancia Vercel (node scripts/vercel-ignore.mjs dalla radice del clone)', relativo.status === 0, (relativo.stdout + relativo.stderr).trim())
    scrivi('app/page.tsx', 'export default 2\n')
    const c2 = commit('codice')
    r = lancia(prod(c1))
    check('app/ cambiata: si costruisce (1)', r.esito === 1, r.testo)
    check('...e il log dice quale file', /app\/page\.tsx\): building$/.test(r.testo), r.testo)
    r = lancia(prod(c0))
    check('dal commit di due giri fa, con il codice in mezzo: si costruisce', r.esito === 1)
    r = lancia(prod(c1, 'main'))
    check('produzione da main, col codice cambiato: saltata (0)', r.esito === 0 && /only from release, this is main: skipped/.test(r.testo), r.testo)
    r = lancia({ VERCEL_ENV: 'production', VERCEL_GIT_PREVIOUS_SHA: c1 })
    check('senza VERCEL_GIT_COMMIT_REF (la CLI): si costruisce', r.esito === 1, r.testo)
    scrivi('types/g.d.ts', 'declare const x: number\n')
    scrivi('.npmrc', 'engine-strict=true\n')
    const c3 = commit('una cartella e un file che lo script non conosce')
    r = lancia(prod(c2))
    check('types/g.d.ts e .npmrc (voci non classificate): si costruisce', r.esito === 1, r.testo)
    git('mv', 'app/page.tsx', 'db/page.tsx')
    const c4 = commit('spostato da app/ a db/')
    r = lancia(prod(c3))
    check('un file spostato da app/ a db/: si costruisce (conta il file tolto da app/)', r.esito === 1, r.testo)
    scrivi('package-lock.json', '{}\n')
    const c5 = commit('dipendenze')
    r = lancia(prod(c4))
    check('package-lock.json cambiato: si costruisce', r.esito === 1)
    r = lancia(prod(c5))
    check('lo stesso commit di prima (Redeploy): si costruisce', r.esito === 1, r.testo)
    r = lancia(prod('c'.repeat(40)))
    check('un commit che il clone non ha: si costruisce', r.esito === 1, r.testo)
    r = lancia(prod())
    check('senza VERCEL_GIT_PREVIOUS_SHA: si costruisce', r.esito === 1)
    r = lancia({ VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: c0 })
    check('una preview: saltata, anche col codice cambiato', r.esito === 0)
    // Da un link simbolico lo script decide lo stesso: prima un controllo su
    // import.meta.url lo faceva uscire 0 senza dire niente (cioe' "salta")
    const link = mkdtempSync(join(tmpdir(), 'dts-link-'))
    try {
      symlinkSync(join(RADICE, 'scripts'), join(link, 'cartella'))
      symlinkSync(SCRIPT, join(link, 'script.mjs'))
      for (const via of [join(link, 'cartella', 'vercel-ignore.mjs'), join(link, 'script.mjs')]) {
        const nome = via.endsWith('script.mjs') ? 'il file' : 'la cartella'
        r = lancia(prod(c1), via)
        check(`da un link simbolico (${nome}), col codice cambiato: si costruisce`, r.esito === 1 && /: building$/.test(r.testo), r.testo || 'nessun output')
        r = lancia(prod(), via)
        check(`...e senza VERCEL_GIT_PREVIOUS_SHA: si costruisce`, r.esito === 1 && r.testo.length > 0, r.testo || 'nessun output')
        r = lancia(prod(c0, 'main'), via)
        check(`...e da main: saltata, e lo dice`, r.esito === 0 && /skipped$/.test(r.testo), r.testo || 'nessun output')
      }
    } finally { rmSync(link, { recursive: true, force: true }) }
    const fuori = mkdtempSync(join(tmpdir(), 'dts-nogit-'))
    try {
      const n = spawnSync(process.execPath, [SCRIPT], { cwd: fuori, encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', ...prod(c0) } as unknown as NodeJS.ProcessEnv })
      check('fuori da un repository git: si costruisce', n.status === 1, (n.stdout + n.stderr).trim())
    } finally { rmSync(fuori, { recursive: true, force: true }) }
  } catch (e) {
    check('nessuna eccezione inattesa', false, e instanceof Error ? e.message : String(e))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('le guardie sul repository')
{
  const vercel = JSON.parse(readFileSync(join(RADICE, 'vercel.json'), 'utf8')) as { ignoreCommand?: string }
  check('vercel.json: ignoreCommand e\' lo script', vercel.ignoreCommand === 'node scripts/vercel-ignore.mjs', vercel.ignoreCommand)
  const cli = readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  check('lo script decide sempre: nessun controllo sul modulo principale (import.meta.url, argv)',
    !/import\.meta\.url|process\.argv/.test(cli) && /r = decidi\(process\.env, git\)/.test(cli) && /process\.exit\(r\.esito === 0 \? 0 : 1\)/.test(cli))
  const doppi = RUNTIME.filter((x) => NON_RUNTIME.includes(x))
  check('nessuna voce e\' insieme runtime e no', doppi.length === 0, doppi.join(', '))
  // le voci di primo livello del repository (tracciate o nuove, non ignorate)
  const ls = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: RADICE, encoding: 'utf8' })
  const voci = [...new Set(ls.stdout.split('\n').filter(Boolean).map((f) => f.split('/')[0]))].sort()
  const senza = voci.filter((v) => !RUNTIME.includes(v) && !NON_RUNTIME.includes(v))
  check(`${voci.length} voci di primo livello, ognuna classificata (RUNTIME o NON_RUNTIME)`, ls.status === 0 && voci.length > 10 && senza.length === 0,
    senza.length ? `da classificare in scripts/vercel-ignore-decidi.mjs: ${senza.join(', ')}` : '')
  // Il deploy salta db/, scripts/, test/, docs/: il codice del sito non deve leggerli
  const radici = ['app', 'components', 'lib', 'proxy.ts', 'instrumentation.ts', 'instrumentation-client.ts', 'next.config.ts']
  const ls2 = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...radici], { cwd: RADICE, encoding: 'utf8' })
  const sorgenti = ls2.stdout.split('\n').filter((f) => /\.(ts|tsx|mjs|js|css)$/.test(f))
  const importa = sorgenti.filter((f) => {
    const t = readFileSync(join(RADICE, f), 'utf8')
    return /(?:from|import\(|require\()\s*['"](?:@\/|(?:\.\.?\/)+)(?:db|scripts|test|docs)\//.test(t)
  })
  check(`${sorgenti.length} file del sito: nessuno importa da db/, scripts/, test/ o docs/`, sorgenti.length > 100 && importa.length === 0, importa.join(', '))
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
