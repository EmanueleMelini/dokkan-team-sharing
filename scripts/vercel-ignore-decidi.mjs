// La decisione dell'Ignored Build Step di Vercel (vercel.json ignoreCommand,
// lanciata da scripts/vercel-ignore.mjs): un deploy si costruisce o no.
// Esito 0 per saltarlo, 1 per costruirlo (la regola di Vercel). Ogni deploy
// di produzione riparte con la cache ISR vuota, e la prima visita di ogni
// pagina dopo il deploy e' una scrittura ISR: un deploy che non cambia
// niente di quello che gira costa come uno vero (sezione "Scritture ISR su
// Vercel Hobby" del README).
//
//   - preview: mai (le preview non servono, e costerebbero la stessa quota);
//   - produzione solo dal branch RAMO_PRODUZIONE: un deploy di produzione
//     da un altro branch (il Production Branch della dashboard rimesso su
//     main, una preview promossa) si salta. Senza VERCEL_GIT_COMMIT_REF (un
//     deploy dalla CLI) si va avanti;
//   - produzione solo se fra il commit dell'ultimo deploy riuscito
//     (VERCEL_GIT_PREVIOUS_SHA) e questo e' cambiato un file fuori da
//     NON_RUNTIME. Si salta solo quando OGNI file cambiato sta in una voce
//     di NON_RUNTIME (README, db/, test/, docs/, scripts/, i workflow): un
//     percorso che lo script non conosce (una cartella types/, un .npmrc, un
//     vercel.ts) costruisce;
//   - nel dubbio si costruisce: senza VERCEL_GIT_PREVIOUS_SHA (il primo
//     deploy, un deploy dalla CLI), con un commit che il clone di Vercel non
//     ha (e' poco profondo), con git che fallisce, e con lo stesso commit di
//     prima (un Redeploy dalla dashboard si fa apposta, per esempio dopo aver
//     cambiato una variabile).
//
// Modulo puro, senza effetti all'import: lo provano i test
// (db/test/deploy.test.mts), anche su un repository git temporaneo.

/** L'unico branch che fa deploy di produzione (Settings, Environments, Production). */
export const RAMO_PRODUZIONE = 'release'

/**
 * Cio' che il build legge, o che cambia cosa si carica. Serve alla guardia
 * del test (ogni voce del repository classificata) e al README: la decisione
 * guarda solo NON_RUNTIME, e tutto il resto costruisce. Il codice del sito
 * non importa niente da db/ (lo controlla il test), e il build non legge
 * eslint (Next 16 non lo lancia).
 */
export const RUNTIME = [
  'app', 'components', 'lib', 'public',
  'proxy.ts', 'instrumentation.ts', 'instrumentation-client.ts',
  'next.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json',
  'postcss.config.mjs', 'vercel.json', '.vercelignore',
]

/** Il resto del repository, che un deploy non deve aspettare. */
export const NON_RUNTIME = [
  '.github', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'README.md',
  'db', 'docs', 'scripts', 'test', 'eslint.config.mjs',
]

const SHA = /^[0-9a-f]{7,40}$/i

/** Un file cambiato che il deploy puo' ignorare: la sua prima voce e' in NON_RUNTIME. */
export const saltabile = (file) => NON_RUNTIME.includes(file.split('/')[0])

/**
 * La decisione, da env e da una funzione che lancia git (cwd: la radice del
 * repository). Torna { esito: 0 | 1, motivo }.
 *
 * @param {Record<string, string | undefined>} env
 * @param {(args: string[]) => { status: number | null, stdout?: string }} git
 */
export function decidi(env, git) {
  if (env.VERCEL_ENV === 'preview') return { esito: 0, motivo: 'preview: never built' }
  const ramo = (env.VERCEL_GIT_COMMIT_REF ?? '').trim()
  if (ramo && ramo !== RAMO_PRODUZIONE) {
    return { esito: 0, motivo: `production deploys come only from ${RAMO_PRODUZIONE}, this is ${ramo.slice(0, 80)}: skipped` }
  }
  const prima = (env.VERCEL_GIT_PREVIOUS_SHA ?? '').trim()
  if (!prima) return { esito: 1, motivo: 'no previous deployment to compare with: building' }
  if (!SHA.test(prima)) return { esito: 1, motivo: 'VERCEL_GIT_PREVIOUS_SHA is not a commit: building' }
  const corto = prima.slice(0, 7)
  const commit = git(['rev-parse', '--verify', '--quiet', `${prima}^{commit}`])
  if (commit.status !== 0) return { esito: 1, motivo: `previous commit ${corto} not in this clone: building` }
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'])
  if (head.status !== 0) return { esito: 1, motivo: 'cannot read HEAD: building' }
  if ((commit.stdout ?? '').trim() === (head.stdout ?? '').trim()) {
    return { esito: 1, motivo: 'same commit as the previous deployment (a redeploy): building' }
  }
  // --no-renames: uno spostamento da app/ a db/ conta anche il file tolto da
  // app/. -z: i nomi cosi' come sono, senza virgolette.
  const diff = git(['diff', '--name-only', '--no-renames', '-z', prima, 'HEAD'])
  if (diff.status !== 0) return { esito: 1, motivo: `git diff failed (exit ${diff.status}): building` }
  const cambiati = (diff.stdout ?? '').split('\0').filter(Boolean)
  const daCostruire = cambiati.filter((f) => !saltabile(f))
  if (!daCostruire.length) {
    return { esito: 0, motivo: `nothing the site runs changed since ${corto} (${cambiati.length} files changed): skipped` }
  }
  const altri = daCostruire.length > 3 ? ` and ${daCostruire.length - 3} more` : ''
  return { esito: 1, motivo: `files the site may run changed since ${corto} (${daCostruire.slice(0, 3).join(', ')}${altri}): building` }
}
