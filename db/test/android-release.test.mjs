// La release automatica dell'app Android (.github/workflows/
// category-helper-release.yml) contro quello che le sta intorno: la firma
// di android/app/build.gradle.kts, il nome dell'APK di :app:releaseApk, il
// link della pagina /category-helper (lib/category-helper.ts), le note in
// android/release-notes/ e la sezione "Il rilascio" di android/README.md.
// Funzioni pure e file letti, niente database, niente rete, niente Gradle.
//
//   - il workflow parte solo dalla push di un tag category-helper-v*
//     (niente pull_request, pull_request_target, workflow_dispatch), con
//     contents: read in cima e due job: build (contents: read, i secret,
//     Gradle) e publish (contents: write, nessun secret, niente Gradle);
//     una concurrency sola per tutti i tag; ogni uses: fissato a uno sha di
//     40 caratteri con la versione in commento;
//   - il controllo del tag usa lo stesso prefisso del trigger, il file
//     passato a publish e caricato e' quello che :app:releaseApk scrive,
//     con il nome in fondo al link dell'APK; le note della versione di
//     build.gradle.kts ci sono, con almeno una riga "- " e senza lineette
//     lunghe; prima della build l'icona si controlla contro il marchio
//     (scripts/brand/icona-android.mjs --check); publish confronta versione
//     e certificato con la Latest;
//   - le variabili DCH_* del workflow sono quelle che build.gradle.kts legge
//     (con le chiavi dch.* di local.properties), i secret sono esattamente i
//     quattro del README, ognuno solo nell'env di un passo di build; la
//     firma di debug ferma il giro, --latest e --verify-tag ci sono;
//   - il README: i secret, la tabella, le chiavi dch.*, i comandi del tag;
//   - le controprove: lo stesso controllo su copie ritoccate in memoria
//     (un workflow_dispatch, un uses: a un tag, un nome diverso dell'APK, un
//     secret in publish, ...) deve dare rosso;
//   - con js-yaml (arriva con eslint) i passi run: girano davvero con bash,
//     in una cartella temporanea, con apksigner, aapt2 e gh finti.
//
//   node db/test/android-release.test.mjs
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let fails = 0
let passes = 0
function check(nome, ok, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
  return ok
}

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../..')
const leggi = (p) => readFileSync(join(RADICE, p), 'utf8')

const WORKFLOW = '.github/workflows/category-helper-release.yml'
const GRADLE = 'android/app/build.gradle.kts'
const LINK = 'lib/category-helper.ts'
const README = 'android/README.md'
const NOTE = 'android/release-notes'
const PREFISSO = 'category-helper-v'
const SECRET = ['DCH_KEYSTORE_BASE64', 'DCH_KEYSTORE_PASSWORD', 'DCH_KEY_ALIAS', 'DCH_KEY_PASSWORD']
const LINEETTE = /[\u2013\u2014]/
// l'ultima versione stabile dei build-tools, mai una -rc
const BUILD_TOOLS = String.raw`tools=$(ls -d "$ANDROID_HOME"/build-tools/* | grep -E '/[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)`

// Le righe di un blocco YAML "chiave:" al rientro dato: quelle dopo, piu'
// rientrate, senza commenti e righe vuote. null se la chiave non c'e'.
function blocco(testo, chiave, rientro = 0) {
  const righe = testo.split('\n')
  const testa = new RegExp(`^ {${rientro}}${chiave}:\\s*(#.*)?$`)
  const i = righe.findIndex((r) => testa.test(r))
  if (i < 0) return null
  const fuori = []
  for (const r of righe.slice(i + 1)) {
    const senza = r.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '')
    if (!senza.trim()) continue
    if (senza.length - senza.trimStart().length <= rientro) break
    fuori.push(senza.trim())
  }
  return fuori
}
// Il testo di un job (senza la riga "  nome:"), fino al job dopo
function lavoro(testo, nome) {
  const righe = (testo.split(/^jobs:\s*$/m)[1] ?? '').split('\n')
  const i = righe.indexOf(`  ${nome}:`)
  if (i < 0) return ''
  const fuori = []
  for (const r of righe.slice(i + 1)) {
    if (/^ {2}[A-Za-z][\w-]*:\s*$/.test(r)) break
    fuori.push(r)
  }
  return fuori.join('\n')
}
// Il run: di un passo, dal suo "- name:" al passo dopo
const passoDi = (testo, nome) => testo.split(`- name: ${nome}\n`)[1]?.split(/\n {6}- /)[0] ?? ''
const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ordinati = (xs) => [...new Set(xs)].sort()

/**
 * Tutte le verifiche sui testi, senza leggere file: le usano i file veri e
 * le controprove. note(versione) da' il testo di android/release-notes/<v>.md
 * o null; tutteLeNote e' { nome: testo } di ogni file della cartella.
 */
function controlla({ workflow, gradle, link, readme, note, tutteLeNote }) {
  const esiti = []
  const c = (nome, ok, dettaglio = '') => esiti.push({ nome, ok: !!ok, dettaglio })
  // i commenti possono nominare quello che manca: le verifiche sul codice li saltano
  const codice = workflow.split('\n').filter((r) => !/^\s*#/.test(r)).join('\n')
  const build = lavoro(codice, 'build')
  const publish = lavoro(codice, 'publish')

  // il trigger: solo la push di un tag category-helper-v*
  const on = blocco(workflow, 'on')
  c('il trigger e\' solo la push di un tag category-helper-v*', uguali(on, ['push:', 'tags:', `- '${PREFISSO}*'`]), JSON.stringify(on))
  const testa = codice.split(/^jobs:\s*$/m)[0]
  c('niente pull_request, pull_request_target, workflow_dispatch, schedule, workflow_run',
    !/^\s*(pull_request(_target)?|workflow_dispatch)\s*:/m.test(codice) &&
    !/^\s*(schedule|workflow_run|workflow_call|release|repository_dispatch|issue_comment)\s*:/m.test(testa))
  c('in cima permissions: contents: read', uguali(blocco(workflow, 'permissions'), ['contents: read']), JSON.stringify(blocco(workflow, 'permissions')))
  const jobs = (codice.split(/^jobs:\s*$/m)[1] ?? '').split('\n').filter((r) => /^ {2}[A-Za-z][\w-]*:\s*$/.test(r)).map((r) => r.trim())
  c('due job, build e publish', uguali(jobs, ['build:', 'publish:']), jobs.join(' '))
  c('build ha solo contents: read', uguali(blocco(build, 'permissions', 4), ['contents: read']), JSON.stringify(blocco(build, 'permissions', 4)))
  c('publish ha solo contents: write', uguali(blocco(publish, 'permissions', 4), ['contents: write']), JSON.stringify(blocco(publish, 'permissions', 4)))
  c('publish parte dopo build', /^ {4}needs: build$/m.test(publish))
  c('publish non vede i secret e non compila niente (niente checkout, setup-java, setup-gradle, gradlew)',
    publish.length > 0 && !/secrets\.|actions\/checkout|setup-java|setup-gradle|gradlew/.test(publish))
  c('una concurrency sola per tutti i tag, mai interrotta', uguali(blocco(workflow, 'concurrency'), ['group: category-helper-release', 'cancel-in-progress: false']),
    JSON.stringify(blocco(workflow, 'concurrency')))
  c('i run: girano con bash, quelli di build in android/', uguali(blocco(workflow, 'defaults'), ['run:', 'shell: bash']) &&
    uguali(blocco(build, 'defaults', 4), ['run:', 'working-directory: android']), JSON.stringify([blocco(workflow, 'defaults'), blocco(build, 'defaults', 4)]))
  const repoLink = link.match(/const REPO = 'https:\/\/github\.com\/([^']+)'/)?.[1]
  const guardia = `    if: github.repository == '${repoLink}'`
  c('i due job girano solo sul repository del link dell\'APK', !!repoLink && build.split('\n').includes(guardia) && publish.split('\n').includes(guardia),
    repoLink ?? 'REPO non trovato')
  c('niente set -x', !/set\s+-[a-z]*x/.test(codice))

  // le azioni
  const uses = [...codice.matchAll(/^\s*-?\s*uses:\s*(.+)$/gm)].map((m) => m[1].trim())
  const fissate = uses.filter((u) => /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(u))
  c('ogni uses: fissato a uno sha di 40 caratteri, con la versione in commento', uses.length === 5 && fissate.length === uses.length,
    uses.filter((u) => !fissate.includes(u)).join(', ') || `${uses.length} azioni`)
  c('checkout, setup-java, setup-gradle, upload-artifact, download-artifact', uguali(uses.map((u) => u.split('@')[0]),
    ['actions/checkout', 'actions/setup-java', 'gradle/actions/setup-gradle', 'actions/upload-artifact', 'actions/download-artifact']))
  c('upload-artifact in build, download-artifact in publish', /uses: actions\/upload-artifact@/.test(build) && !/upload-artifact@/.test(publish) &&
    /uses: actions\/download-artifact@/.test(publish) && !/download-artifact@/.test(build))
  c('setup-java: temurin 25 (il toolchain del daemon di Gradle)', /distribution: temurin\n\s+java-version: 25\n/.test(workflow))
  c('setup-gradle senza cache', /setup-gradle@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+cache-disabled: true\n/.test(workflow))

  // il commit del tag sta su main
  c('checkout con tutta la storia e senza credenziali salvate', /fetch-depth: 0\n\s+persist-credentials: false\n/.test(workflow))
  c('il commit del tag deve stare su origin/main', /if ! git merge-base --is-ancestor HEAD origin\/main; then\n[^\n]*\n\s+exit 1\n/.test(workflow))

  // il tag e la versione
  const versioni = [...gradle.matchAll(/^ *versionName = "([^"]*)"$/gm)].map((m) => m[1])
  const versione = versioni.length === 1 ? versioni[0] : null
  c('build.gradle.kts ha un versionName X.Y.Z, uno solo', !!versione && /^\d+\.\d+\.\d+$/.test(versione), versioni.join(', '))
  c('il workflow legge versionName con la stessa riga', workflow.includes(`sed -n 's/^ *versionName = "\\([^"]*\\)"$/\\1/p' app/build.gradle.kts`))
  c('il controllo del tag usa il prefisso del trigger', workflow.includes(`if [ "${PREFISSO}$version" != "$GITHUB_REF_NAME" ]; then`))
  c('la versione controllata passa da build a publish (id tag, GITHUB_OUTPUT, outputs, env)',
    /- name: Check that the tag matches the app version\n\s+id: tag\n/.test(build) && build.includes('echo "version=$version" >> "$GITHUB_OUTPUT"') &&
    uguali(blocco(build, 'outputs', 4), ['version: ${{ steps.tag.outputs.version }}']) &&
    uguali(blocco(publish, 'env', 4), ['VERSION: ${{ needs.build.outputs.version }}']))

  // le note
  c('il workflow controlla android/release-notes/<versione>.md e lo passa a publish', (workflow.match(/release-notes\/\$VERSION\.md/g) ?? []).length === 2 &&
    build.includes('notes="release-notes/$VERSION.md"') && build.includes('cp "release-notes/$VERSION.md" "$RUNNER_TEMP/release/notes.md"'))
  const testoNote = versione ? note(versione) : null
  c(`le note della versione ${versione} ci sono`, testoNote != null, `${NOTE}/${versione}.md`)
  c('...con almeno una riga "- "', /^- \S/m.test(testoNote ?? ''))
  const conLineette = Object.entries(tutteLeNote).filter(([, t]) => LINEETTE.test(t)).map(([n]) => n)
  c('nessuna nota con lineette lunghe', Object.keys(tutteLeNote).length > 0 && conLineette.length === 0, conLineette.join(', '))
  const nomiNote = Object.keys(tutteLeNote).filter((n) => !/^\d+\.\d+\.\d+\.md$/.test(n))
  c('i file delle note si chiamano X.Y.Z.md', nomiNote.length === 0, nomiNote.join(', '))

  // l'APK: il nome di :app:releaseApk, il file passato a publish e caricato, il link del sito
  const rinomina = gradle.match(/rename \{ "([^"]+)" \}/)?.[1]
  const cartella = gradle.match(/val releaseDist: Provider<Directory> = layout\.buildDirectory\.dir\("([^"]+)"\)/)?.[1]
  const atteso = rinomina && cartella && /into\(releaseDist\)/.test(gradle) ? `app/build/${cartella}/${rinomina}` : null
  const nomeLink = link.match(/apk: `\$\{REPO\}\/releases\/latest\/download\/([^`]+)`/)?.[1]
  c(':app:releaseApk scrive app/build/dist/dokkants-category-helper.apk', atteso === 'app/build/dist/dokkants-category-helper.apk', String(atteso))
  const copia = build.match(/cp (\S+) "\$RUNNER_TEMP\/release\/([^"]+\.apk)"\n/)
  c('build passa a publish il file di :app:releaseApk, con lo stesso nome', !!copia && copia[1] === atteso && copia[2] === rinomina,
    copia ? `${copia[1]} -> ${copia[2]}` : 'cp non trovato')
  const caricato = publish.match(/gh release create "\$GITHUB_REF_NAME" "\$RUNNER_TEMP\/release\/([^"]+)" \\\n/)?.[1]
  c('publish carica quel file', !!caricato && caricato === rinomina, `${caricato} contro ${rinomina}`)
  c('...con il nome in fondo al link dell\'APK del sito', !!nomeLink && caricato === nomeLink, `${nomeLink}`)
  const sale = /uses: actions\/upload-artifact@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}name: ([\w-]+)\n {10}path: \$\{\{ runner\.temp \}\}\/release\n {10}if-no-files-found: error\n {10}retention-days: 1\n/.exec(build)
  const scende = /uses: actions\/download-artifact@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}name: ([\w-]+)\n {10}path: \$\{\{ runner\.temp \}\}\/release\n/.exec(publish)
  c('l\'artifact: stesso nome e stessa cartella in build e publish, mai vuoto, di un giorno', !!sale && !!scende && sale[1] === scende[1],
    `${sale?.[1]} / ${scende?.[1]}`)
  const percorsi = ordinati([...workflow.matchAll(/app\/build\/[\w./-]+\.apk/g)].map((m) => m[0]))
  c('firma, versione e copia sullo stesso file', uguali(percorsi, [atteso]), percorsi.join(', '))
  // il comando intero: dalla riga di gh release create fino alla prima senza "\" in fondo
  const crea = publish.match(/^ +gh release create "\$GITHUB_REF_NAME" (?:[^\n]*\\\n)*[^\n]*\n/m)?.[0] ?? ''
  const opzioni = ['--repo "$GITHUB_REPOSITORY"', '--title "DokkanTS Category Helper $VERSION"', '--notes-file "$RUNNER_TEMP/release/notes.md"', '--latest', '--verify-tag']
  c('gh release create con --latest e --verify-tag, il titolo con la versione, le note', opzioni.every((o) => crea.includes(o)),
    opzioni.filter((o) => !crea.includes(o)).join(', '))
  c('gh con il GITHUB_TOKEN del giro, solo in publish', (publish.match(/^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/gm) ?? []).length === 2 && !/github\.token/.test(build))
  const conLatest = passoDi(publish, 'Check the release against the current Latest')
  c('publish confronta la release con la Latest: una versione piu\' nuova, lo stesso certificato',
    conLatest.includes("--json tagName,isLatest --jq '.[] | select(.isLatest) | .tagName'") &&
    conLatest.includes(`if ! [[ $latest =~ ^${PREFISSO}([0-9]+\\.[0-9]+\\.[0-9]+)$ ]]; then`) &&
    conLatest.includes('[ "$previous" = "$VERSION" ] || [ "$(printf \'%s\\n\' "$previous" "$VERSION" | sort -V | tail -1)" != "$VERSION" ]') &&
    conLatest.includes(`--pattern ${rinomina} --dir`) &&
    conLatest.includes(`sha() { "$tools/apksigner" verify --print-certs "$1" | awk '/certificate SHA-256 digest: / { print $NF; exit }'; }`) &&
    conLatest.includes('old=$(sha "$RUNNER_TEMP/previous/dokkants-category-helper.apk")') && conLatest.includes('new=$(sha "$apk")') &&
    !/\^Signer #1/.test(conLatest) &&
    conLatest.includes('if [ -z "$new" ] || [ "$new" != "$old" ]; then'))
  const strumenti = [...codice.matchAll(/^\s*tools=.*$/gm)].map((m) => m[0].trim())
  c('i build-tools: l\'ultima versione stabile, mai una -rc, ogni volta', strumenti.length === 3 && strumenti.every((t) => t === BUILD_TOOLS),
    strumenti.filter((t) => t !== BUILD_TOOLS).join(' | ') || `${strumenti.length} volte`)

  // la firma
  const daGradle = [...gradle.matchAll(/signingValue\("(DCH_[A-Z_]+)", "(dch\.[a-z.]+)"\)/g)].map((m) => [m[1], m[2]])
  c('build.gradle.kts legge DCH_KEYSTORE_PATH, DCH_KEYSTORE_PASSWORD, DCH_KEY_ALIAS, DCH_KEY_PASSWORD', uguali(daGradle.map(([e]) => e).sort(),
    ['DCH_KEYSTORE_PASSWORD', 'DCH_KEYSTORE_PATH', 'DCH_KEY_ALIAS', 'DCH_KEY_PASSWORD']), daGradle.map(([e]) => e).join(', '))
  c('...ognuna con la sua chiave dch.* di local.properties', daGradle.length > 0 && daGradle.every(([e, p]) => p === e.toLowerCase().replace(/_/g, '.')),
    daGradle.map(([e, p]) => `${e}=${p}`).join(', '))
  c('...e la password della chiave vale quella del keystore se manca', /signingValue\("DCH_KEY_PASSWORD", "dch\.key\.password"\) \?: releaseKeystorePassword/.test(gradle))
  c('...e niente piu\' DCH_KEYSTORE_FILE da ~/.gradle/gradle.properties', !/DCH_KEYSTORE_FILE|gradleProperty\("DCH_/.test(gradle))
  c('checkReleaseSigning ferma ogni release senza firma', /tasks\.matching \{ it\.name == "preReleaseBuild" \}\.configureEach \{ dependsOn\(checkReleaseSigning\) \}/.test(gradle) &&
    /throw GradleException\(\s*"Release signing is not configured/.test(gradle))
  c('checkReleaseSigning svuota build/dist prima di tutto: una build fallita non lascia l\'APK di prima',
    /val dist = releaseDist\n\s+destroyables\.register\(dist\)\n\s+doLast \{\n(?:\s*\/\/[^\n]*\n)?\s+dist\.get\(\)\.asFile\.deleteRecursively\(\)\n/.test(gradle))
  c(':app:releaseApk si ferma se gli APK sono piu\' di uno', /rename \{ "[^"]+" \}\n(?:\s*\/\/[^\n]*\n)?\s+duplicatesStrategy = DuplicatesStrategy\.FAIL\n/.test(gradle))
  const dchWorkflow = ordinati([...workflow.matchAll(/^\s+(DCH_[A-Z_]+):/gm)].map((m) => m[1]))
  c('le variabili DCH_* del workflow sono quelle di build.gradle.kts', dchWorkflow.length > 0 && uguali(dchWorkflow, ordinati(daGradle.map(([e]) => e))), dchWorkflow.join(', '))
  const keystore = workflow.match(/base64 --decode > "\$RUNNER_TEMP\/([\w.-]+)"/)?.[1]
  c('DCH_KEYSTORE_PATH e\' il keystore ripristinato in $RUNNER_TEMP', !!keystore &&
    workflow.includes(`DCH_KEYSTORE_PATH: \${{ runner.temp }}/${keystore}\n`), String(keystore))
  c('un secret DCH_KEYSTORE_BASE64 vuoto ferma il giro', /if \[ -z "\$KEYSTORE_BASE64" \]; then\n[^\n]*\n\s+exit 1\n/.test(workflow))
  const secret = [...workflow.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1])
  c('i secret sono esattamente DCH_KEYSTORE_BASE64, DCH_KEYSTORE_PASSWORD, DCH_KEY_ALIAS, DCH_KEY_PASSWORD, una volta ciascuno',
    uguali([...secret].sort(), [...SECRET].sort()), secret.join(', '))
  c('...tutti nel job build', ([...build.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].length === SECRET.length))
  const righeSecret = workflow.split('\n').filter((r) => /secrets\.|github\.token/.test(r))
  c('ogni secret solo come valore di una variabile d\'ambiente, mai dentro un run:', righeSecret.length === SECRET.length + 2 &&
    righeSecret.every((r) => /^ {10}[A-Z][A-Z0-9_]*: \$\{\{ (secrets\.[A-Z0-9_]+|github\.token) \}\}$/.test(r)), righeSecret.filter((r) => !/^ {10}[A-Z]/.test(r)).join(' | '))
  for (const s of SECRET.filter((x) => x !== 'DCH_KEYSTORE_BASE64')) {
    c(`${s} arriva a Gradle con lo stesso nome`, workflow.includes(`          ${s}: \${{ secrets.${s} }}\n`))
  }
  c('la firma di debug ferma il giro', /if grep -q 'CN=Android Debug' "\$RUNNER_TEMP\/certs\.txt"; then\n[^\n]*\n\s+exit 1\n/.test(workflow))
  c('apksigner verify --print-certs, e lo SHA-256 nel riepilogo', /apksigner" verify --verbose --print-certs "\$apk"/.test(workflow) &&
    /grep -E 'certificate \(DN\|SHA-256 digest\)' "\$RUNNER_TEMP\/certs\.txt"\n[^\n]*\n\s+\} >> "\$GITHUB_STEP_SUMMARY"/.test(workflow))
  const applicationId = gradle.match(/applicationId = "([^"]+)"/)?.[1]
  c('aapt2 controlla package e versione dell\'APK', !!applicationId && /aapt2" dump badging "\$apk"/.test(workflow) &&
    workflow.includes(`[ "$name" != '${applicationId}' ] || [ "$version" != "$VERSION" ]`), String(applicationId))
  c('...e la riga package: la cerca, non la prende per posizione', workflow.includes('badging=$(grep -m1 \'^package:\' <<< "$dump" || true)'))
  const passiBuild = ['Check that the tagged commit is on main', 'Check that the tag matches the app version', 'Check the release notes',
    'Check that the app icon is generated from the site mark', 'Restore the signing keystore', 'Test, lint and build the signed APK', 'Check the APK signature',
    'Check the package and version inside the APK', 'Stage the APK and the notes for publishing']
  const passiPublish = ['Check the release against the current Latest', 'Publish the GitHub release']
  const ordine = [...passiBuild.map((n) => workflow.indexOf(`- name: ${n}\n`)), workflow.indexOf('uses: actions/upload-artifact@'),
    workflow.indexOf('uses: actions/download-artifact@'), ...passiPublish.map((n) => workflow.indexOf(`- name: ${n}\n`))]
  c('i passi, in quest\'ordine: main, tag, note, icona, keystore, build, firma, versione, artifact; poi la Latest e la release',
    ordine.every((x, i) => x > 0 && (i === 0 || x > ordine[i - 1])) && passiBuild.every((n) => build.includes(`- name: ${n}\n`)) &&
    passiPublish.every((n) => publish.includes(`- name: ${n}\n`)), ordine.join(' '))
  c('la build: test, lint e :app:releaseApk', /run: \.\/gradlew testDebugUnitTest lintDebug :app:releaseApk\n/.test(workflow))
  c('l\'icona contro il marchio, con il generatore in --check e senza npm',
    /- name: Check that the app icon is generated from the site mark\n {8}run: node \.\.\/scripts\/brand\/icona-android\.mjs --check\n/.test(build) &&
    existsSync(join(RADICE, 'scripts/brand/icona-android.mjs')))

  // il README, sezione "Il rilascio"
  const rilascio = readme.split(/^## /m).find((s) => s.startsWith('Il rilascio')) ?? ''
  const mancanti = [...SECRET, ...daGradle.map(([, p]) => p), WORKFLOW.split('/').pop(), `${PREFISSO}X.Y.Z`, 'release-notes/X.Y.Z.md']
    .filter((x) => !rilascio.includes(x))
  c('android/README.md, "Il rilascio": i secret, le chiavi dch.*, il workflow, il tag, le note', rilascio.length > 0 && mancanti.length === 0, mancanti.join(', '))
  c('...una riga della tabella per ogni secret', SECRET.every((s) => rilascio.includes(`| \`${s}\` |`)), SECRET.filter((s) => !rilascio.includes(`| \`${s}\` |`)).join(', '))
  c('...e le gh secret set sul repository del link', !!repoLink && SECRET.every((s) => rilascio.includes(`gh secret set ${s} -R ${repoLink}`)))
  c('...il tag annotato su origin/main e la sua push, con il prefisso del trigger',
    rilascio.includes(`git tag -a ${PREFISSO}X.Y.Z -m "DokkanTS Category Helper X.Y.Z" origin/main\n`) && rilascio.includes(`git push origin ${PREFISSO}X.Y.Z\n`))
  c('...e un tag senza release si toglie con lo stesso prefisso', rilascio.includes(`git push origin :refs/tags/${PREFISSO}X.Y.Z`))
  c('...e niente piu\' ~/.gradle/gradle.properties', !/gradle\.properties|DCH_KEYSTORE_FILE/.test(rilascio))
  return { esiti, versione, applicationId, nomeApk: rinomina }
}

// I file veri
const notes = {}
const cartellaNote = join(RADICE, NOTE)
// i file nascosti (un .DS_Store di Finder) non sono note
if (existsSync(cartellaNote)) for (const n of readdirSync(cartellaNote).filter((x) => !x.startsWith('.'))) notes[n] = readFileSync(join(cartellaNote, n), 'utf8')
const veri = {
  workflow: leggi(WORKFLOW), gradle: leggi(GRADLE), link: leggi(LINK), readme: leggi(README),
  note: (v) => notes[`${v}.md`] ?? null, tutteLeNote: notes,
}
console.log(`${WORKFLOW}, ${GRADLE}, ${LINK}, ${NOTE}/`)
const { esiti, versione, applicationId, nomeApk } = controlla(veri)
for (const e of esiti) check(e.nome, e.ok, e.dettaglio)

// Le controprove: ogni ritocco deve far diventare rossa la sua verifica
console.log('\nle controprove (copie ritoccate in memoria)')
{
  const rosso = (nome, ritocco, verifica) => {
    const copia = { ...veri, ...ritocco(veri) }
    const cambiato = Object.keys(copia).some((k) => copia[k] !== veri[k])
    const e = controlla(copia).esiti.find((x) => x.nome.startsWith(verifica))
    check(`${nome}: rosso "${verifica.slice(0, 60)}"`, cambiato && !!e && !e.ok, !cambiato ? 'il ritocco non cambia niente' : e ? '' : 'verifica non trovata')
  }
  const wf = (da, a) => (v) => ({ workflow: v.workflow.replace(da, a) })
  const gr = (da, a) => (v) => ({ gradle: v.gradle.replace(da, a) })
  const rd = (da, a) => (v) => ({ readme: v.readme.replace(da, a) })
  rosso('un workflow_dispatch', wf("      - 'category-helper-v*'\n", "      - 'category-helper-v*'\n  workflow_dispatch:\n"), 'niente pull_request')
  rosso('un pull_request', wf('  push:\n    tags:\n', '  pull_request:\n  push:\n    tags:\n'), 'niente pull_request')
  rosso('un set -x', wf('        run: |\n          if ! git merge-base', '        run: |\n          set -x\n          if ! git merge-base'), 'niente set -x')
  rosso('anche i branch', wf('  push:\n    tags:\n', '  push:\n    branches: [main]\n    tags:\n'), 'il trigger e\' solo')
  rosso('un altro prefisso del tag', wf("- 'category-helper-v*'", "- 'v*'"), 'il trigger e\' solo')
  rosso('l\'icona controllata con npm', wf('run: node ../scripts/brand/icona-android.mjs --check', 'run: npm ci && npm run brand'), 'l\'icona contro il marchio')
  rosso('il controllo del tag con v$version', wf('"category-helper-v$version" !=', '"v$version" !='), 'il controllo del tag usa')
  rosso('contents: write in cima', wf('permissions:\n  contents: read\n', 'permissions:\n  contents: write\n'), 'in cima permissions')
  rosso('contents: write anche in build', wf('    permissions:\n      contents: read\n', '    permissions:\n      contents: write\n'), 'build ha solo contents: read')
  rosso('anche actions: write in publish', wf('      contents: write\n', '      contents: write\n      actions: write\n'), 'publish ha solo contents: write')
  rosso('un job solo', (v) => ({ workflow: v.workflow.replace(/\n {2}# Il solo job[\s\S]*?\n {2}publish:\n[\s\S]*?\n {4}steps:\n/, '\n') }), 'due job, build e publish')
  rosso('un secret in publish', wf('          GH_TOKEN: ${{ github.token }}\n        run: |\n          gh release create',
    '          GH_TOKEN: ${{ github.token }}\n          DCH_KEY_ALIAS: ${{ secrets.DCH_KEY_ALIAS }}\n        run: |\n          gh release create'), 'publish non vede i secret')
  rosso('Gradle in publish', wf('      - name: Publish the GitHub release\n', '      - run: ./gradlew tasks\n      - name: Publish the GitHub release\n'), 'publish non vede i secret')
  rosso('publish senza needs', wf('    needs: build\n', ''), 'publish parte dopo build')
  rosso('la concurrency per tag', wf('  group: category-helper-release\n', '  group: category-helper-release-${{ github.ref }}\n'), 'una concurrency sola')
  rosso('publish senza la guardia del repository', wf("    needs: build\n    if: github.repository == 'EmanueleMelini/dokkan-team-sharing'\n", '    needs: build\n'), 'i due job girano solo')
  rosso('un uses: a un tag', wf(/actions\/setup-java@[0-9a-f]{40} # v[\d.]+/, 'actions/setup-java@v6'), 'ogni uses: fissato')
  rosso('un uses: senza versione in commento', wf(/(actions\/checkout@[0-9a-f]{40}) # v[\d.]+/, '$1'), 'ogni uses: fissato')
  rosso('l\'artifact con un altro nome in publish', wf(/(download-artifact@[0-9a-f]{40} # v[\d.]+\n {8}with:\n {10}name: )[\w-]+/, '$1altro'), 'l\'artifact: stesso nome')
  rosso('l\'artifact che tiene 90 giorni', wf('retention-days: 1\n', 'retention-days: 90\n'), 'l\'artifact: stesso nome')
  rosso('un altro nome dell\'APK in Gradle', gr('rename { "dokkants-category-helper.apk" }', 'rename { "app.apk" }'), 'build passa a publish il file')
  rosso('un altro nome nel link del sito', (v) => ({ link: v.link.replace('/download/dokkants-category-helper.apk', '/download/helper.apk') }), '...con il nome in fondo')
  rosso('l\'APK di AGP invece di quello rinominato', wf('cp app/build/dist/dokkants-category-helper.apk', 'cp app/build/outputs/apk/release/app-release.apk'), 'build passa a publish il file')
  rosso('publish carica un altro file', wf('gh release create "$GITHUB_REF_NAME" "$RUNNER_TEMP/release/dokkants-category-helper.apk"', 'gh release create "$GITHUB_REF_NAME" "$RUNNER_TEMP/release/app.apk"'), 'publish carica quel file')
  rosso('senza --latest', wf('--latest --verify-tag', '--verify-tag'), 'gh release create con --latest')
  rosso('senza --verify-tag', wf('--latest --verify-tag', '--latest'), 'gh release create con --latest')
  rosso('senza il confronto con la Latest', wf("select(.isLatest)", 'select(.isDraft)'), 'publish confronta la release')
  rosso('la Latest confrontata senza sort -V', wf('| sort -V | tail -1)" != "$VERSION" ]', '| tail -1)" != "$VERSION" ]'), 'publish confronta la release')
  rosso('il certificato della Latest non confrontato', wf('if [ -z "$new" ] || [ "$new" != "$old" ]; then', 'if [ -z "$new" ]; then'), 'publish confronta la release')
  rosso('i build-tools anche -rc', wf(" | grep -E '/[0-9]+\\.[0-9]+\\.[0-9]+$' | sort -V", ' | sort -V'), 'i build-tools')
  rosso('aapt2 alla prima riga', wf('badging=$(grep -m1 \'^package:\' <<< "$dump" || true)', 'badging=$(sed -n \'1p\' <<< "$dump")'), '...e la riga package')
  rosso('un secret con un altro nome', wf(/secrets\.DCH_KEY_ALIAS/, 'secrets.DCH_ALIAS'), 'i secret sono esattamente')
  rosso('una variabile che Gradle non legge', wf('          DCH_KEY_ALIAS:', '          DCH_ALIAS:'), 'le variabili DCH_* del workflow')
  rosso('Gradle con un altro nome', gr('"DCH_KEYSTORE_PATH", "dch.keystore.path"', '"DCH_KEYSTORE_FILE", "dch.keystore.file"'), 'le variabili DCH_* del workflow')
  rosso('checkReleaseSigning senza la pulizia di build/dist', gr('        dist.get().asFile.deleteRecursively()\n', ''), 'checkReleaseSigning svuota')
  rosso(':app:releaseApk senza DuplicatesStrategy.FAIL', gr('duplicatesStrategy = DuplicatesStrategy.FAIL', 'duplicatesStrategy = DuplicatesStrategy.INCLUDE'), ':app:releaseApk si ferma')
  rosso('un secret dentro un run:', wf('run: ./gradlew testDebugUnitTest', 'run: echo "${{ secrets.DCH_KEY_ALIAS }}" && ./gradlew testDebugUnitTest'), 'ogni secret solo come valore')
  rosso('senza il controllo della firma di debug', wf(/ {10}if grep -q 'CN=Android Debug'[\s\S]*?\n {10}fi\n/, ''), 'la firma di debug ferma')
  rosso('il keystore vuoto che passa', wf(/ {10}if \[ -z "\$KEYSTORE_BASE64" \]; then\n[\s\S]*?\n {10}fi\n/, ''), 'un secret DCH_KEYSTORE_BASE64 vuoto')
  rosso('un tag di dev', wf('git merge-base --is-ancestor HEAD origin/main', 'true'), 'il commit del tag deve stare')
  rosso('la versione che non arriva a publish', wf('      VERSION: ${{ needs.build.outputs.version }}\n', '      VERSION: ${{ github.ref_name }}\n'), 'la versione controllata passa')
  rosso('versionName senza note', gr(`versionName = "${versione}"`, 'versionName = "9.9.9"'), 'le note della versione')
  rosso('note senza punti', () => ({ note: () => 'First release.\n', tutteLeNote: { [`${versione}.md`]: 'First release.\n' } }), '...con almeno una riga')
  rosso('note con una lineetta lunga', (v) => ({ tutteLeNote: { ...v.tutteLeNote, '0.9.0.md': '- Fixes \u2014 many\n' } }), 'nessuna nota con lineette')
  rosso('il README senza un secret', (v) => ({ readme: v.readme.replace(/DCH_KEY_ALIAS/g, 'KEY_ALIAS') }), 'android/README.md, "Il rilascio"')
  rosso('il README con un secret rinominato nella tabella', rd('| `DCH_KEY_PASSWORD` |', '| `DCH_KEY_PASS` |'), '...una riga della tabella')
  rosso('il README col tag senza prefisso', rd(`git tag -a ${PREFISSO}X.Y.Z`, 'git tag -a vX.Y.Z'), '...il tag annotato')
  rosso('il README con la push di un altro tag', rd(`git push origin ${PREFISSO}X.Y.Z\n`, 'git push origin vX.Y.Z\n'), '...il tag annotato')
  rosso('il README col tag su HEAD', rd('-m "DokkanTS Category Helper X.Y.Z" origin/main\n', '-m "DokkanTS Category Helper X.Y.Z"\n'), '...il tag annotato')
}

// I passi run: veri, con bash, come li lancia GitHub (bash --noprofile
// --norc -eo pipefail). Una cartella temporanea fa da android/, da
// $RUNNER_TEMP e da $ANDROID_HOME; apksigner, aapt2 e gh sono finti: l'APK
// finto e' un file di testo con quello che apksigner stamperebbe.
console.log('\ni passi run: del workflow, con bash')
let load = null
const YAML_MOD = 'js-yaml'
try { load = (await import(YAML_MOD)).load } catch { console.log('  (js-yaml non disponibile: salto i passi eseguiti)') }
if (load) {
  const wf = load(veri.workflow)
  const jobs = wf?.jobs ?? {}
  check('js-yaml: on.push.tags e\' solo category-helper-v*, e nient\'altro sotto on', uguali(Object.keys(wf?.on ?? {}), ['push']) &&
    uguali(Object.keys(wf.on.push ?? {}), ['tags']) && uguali(wf.on.push.tags, [`${PREFISSO}*`]))
  check('js-yaml: in cima { contents: read }, build { contents: read }, publish { contents: write } dopo build', uguali(wf?.permissions, { contents: 'read' }) &&
    uguali(jobs.build?.permissions, { contents: 'read' }) && uguali(jobs.publish?.permissions, { contents: 'write' }) &&
    uguali(Object.keys(jobs), ['build', 'publish']) && jobs.publish?.needs === 'build')
  check('js-yaml: una concurrency sola, mai interrotta', uguali(wf?.concurrency, { group: 'category-helper-release', 'cancel-in-progress': false }))
  const passo = (job, nome) => jobs[job]?.steps?.find((s) => s.name === nome)?.run ?? 'exit 9'
  const tmp = mkdtempSync(join(tmpdir(), 'dts-apk-'))
  try {
    const android = join(tmp, 'android')
    const ws = join(tmp, 'workspace')
    const runner = join(tmp, 'runner')
    const sdk = join(tmp, 'sdk')
    const bin = join(tmp, 'bin')
    for (const d of [join(android, 'app'), join(android, 'release-notes'), ws, runner, bin]) mkdirSync(d, { recursive: true })
    writeFileSync(join(android, 'app/build.gradle.kts'), veri.gradle)
    const script = (p, testo) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, testo); chmodSync(p, 0o755) }
    // i build-tools: lo stabile stampa il file, il -rc direbbe sempre "chiave di debug"
    script(join(sdk, 'build-tools/36.1.0/apksigner'), '#!/bin/bash\nfor a; do f=$a; done\ncat "$f"\n')
    script(join(sdk, 'build-tools/36.1.0/aapt2'), '#!/bin/bash\nprintf \'%s\' "$FAKE_BADGING"\n')
    script(join(sdk, 'build-tools/37.0.0-rc1/apksigner'), '#!/bin/bash\necho "Signer #1 certificate DN: C=US, O=Android, CN=Android Debug"\necho "Signer #1 certificate SHA-256 digest: deb0"\n')
    script(join(sdk, 'build-tools/37.0.0-rc1/aapt2'), '#!/bin/bash\necho "package: name=\'rc\' versionName=\'0\'"\n')
    script(join(bin, 'gh'), [
      '#!/bin/bash',
      'case "$1 $2" in',
      "  'release list')",
      "    [ -z \"${FAKE_GH_FAIL:-}\" ] || { echo 'gh: HTTP 502' >&2; exit 1; }",
      '    [ -z "${FAKE_LATEST:-}" ] || echo "$FAKE_LATEST" ;;',
      "  'release download')",
      "    dir=''",
      '    while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir=$2; shift; done',
      "    [ -n \"${FAKE_PREVIOUS_APK:-}\" ] || { echo 'no assets match the file pattern' >&2; exit 1; }",
      '    mkdir -p "$dir" && cp "$FAKE_PREVIOUS_APK" "$dir/dokkants-category-helper.apk" ;;',
      "  'release create')",
      '    printf \'%s\\n\' "$@" > "$FAKE_GH_ARGS" ;;',
      '  *) echo "fake gh: $*" >&2; exit 3 ;;',
      'esac',
      '',
    ].join('\n'))
    const certificato = (dn, sha) => `Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\nNumber of signers: 1\nSigner #1 certificate DN: ${dn}\nSigner #1 certificate SHA-256 digest: ${sha}\n`
    // come lo stampa l'apksigner del runner (log della release di Steno, 2026-10-29)
    const certificatoV2 = (dn, sha) => `V2 Signer: certificate DN: ${dn}\nV2 Signer: certificate SHA-256 digest: ${sha}\nV2 Signer: certificate SHA-1 digest: 0f0f\nV2 Signer: certificate MD5 digest: 0e0e\n`
    const leggiSe = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
    const esegui = (run, env = {}, cwd = android) => {
      const id = randomBytes(4).toString('hex')
      const file = { GITHUB_ENV: join(tmp, `env-${id}`), GITHUB_OUTPUT: join(tmp, `out-${id}`), GITHUB_STEP_SUMMARY: join(tmp, `sum-${id}`) }
      const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
        cwd, encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, RUNNER_TEMP: runner, ANDROID_HOME: sdk, GITHUB_REPOSITORY: 'owner/repo', ...file, ...env },
      })
      return { status: r.status, env: leggiSe(file.GITHUB_ENV), out: leggiSe(file.GITHUB_OUTPUT), sum: leggiSe(file.GITHUB_STEP_SUMMARY), err: r.stdout + r.stderr }
    }

    // build: il tag
    const tag = passo('build', 'Check that the tag matches the app version')
    const giusto = esegui(tag, { GITHUB_REF_NAME: `${PREFISSO}${versione}` })
    check(`tag ${PREFISSO}${versione}: passa, VERSION per i passi dopo e version per publish`, giusto.status === 0 &&
      giusto.env === `VERSION=${versione}\n` && giusto.out === `version=${versione}\n`, `uscita ${giusto.status}, ${JSON.stringify(giusto.env + giusto.out)}`)
    for (const sbagliato of [`${PREFISSO}9.9.9`, `v${versione}`, versione, `${PREFISSO}${versione}-rc1`]) {
      const r = esegui(tag, { GITHUB_REF_NAME: sbagliato })
      check(`tag ${sbagliato}: rosso, senza VERSION`, r.status === 1 && r.env === '' && r.out === '' && /::error::/.test(r.err), `uscita ${r.status}`)
    }
    // build: le note
    const noteRun = passo('build', 'Check the release notes')
    const senza = esegui(noteRun, { VERSION: versione })
    check('note mancanti: rosso', senza.status === 1 && /::error::android\/release-notes\/.*missing/.test(senza.err), `uscita ${senza.status}`)
    writeFileSync(join(android, 'release-notes', `${versione}.md`), 'Only a sentence.\n')
    const vuote = esegui(noteRun, { VERSION: versione })
    check('note senza una riga "- ": rosso', vuote.status === 1, `uscita ${vuote.status}`)
    writeFileSync(join(android, 'release-notes', `${versione}.md`), veri.note(versione) ?? '')
    const ok = esegui(noteRun, { VERSION: versione })
    check(`le note vere della ${versione}: passano`, ok.status === 0, `uscita ${ok.status}`)
    // build: il keystore
    const ks = passo('build', 'Restore the signing keystore')
    const vuoto = esegui(ks, { KEYSTORE_BASE64: '' })
    check('keystore: secret vuoto, rosso', vuoto.status === 1 && /DCH_KEYSTORE_BASE64 secret is empty/.test(vuoto.err), `uscita ${vuoto.status}`)
    const byte = randomBytes(2500)
    // come lo scrive base64 di GNU: a capo ogni 76 caratteri
    const b64 = byte.toString('base64').replace(/.{76}/g, '$&\n')
    const giro = esegui(ks, { KEYSTORE_BASE64: b64 })
    const scritto = existsSync(join(runner, 'dokkants-category-helper.jks')) ? readFileSync(join(runner, 'dokkants-category-helper.jks')) : null
    check('keystore: il base64 torna byte per byte in $RUNNER_TEMP', giro.status === 0 && !!scritto && scritto.equals(byte), `uscita ${giro.status}`)
    const rotto = esegui(ks, { KEYSTORE_BASE64: '%%% non base64 %%%' })
    check('keystore: un secret che non e\' base64, rosso', rotto.status !== 0, `uscita ${rotto.status}`)
    rmSync(join(runner, 'dokkants-category-helper.jks'), { force: true })
    // build: la firma, con i build-tools finti
    const apk = join(android, 'app/build/dist', nomeApk ?? 'x.apk')
    mkdirSync(dirname(apk), { recursive: true })
    const firma = passo('build', 'Check the APK signature')
    writeFileSync(apk, certificato('CN=Release Test', 'aa11'))
    const buona = esegui(firma, { VERSION: versione })
    check('firma: un certificato di release passa, DN e SHA-256 nel riepilogo (il -rc dei build-tools resta fuori)', buona.status === 0 &&
      /certificate DN: CN=Release Test/.test(buona.sum) && /SHA-256 digest: aa11/.test(buona.sum), `uscita ${buona.status}`)
    writeFileSync(apk, certificatoV2('CN=Release Test', 'aa11'))
    const buonaV2 = esegui(firma, { VERSION: versione })
    check('firma: anche nel formato "V2 Signer:" del runner passa, DN e SHA-256 nel riepilogo', buonaV2.status === 0 &&
      /certificate DN: CN=Release Test/.test(buonaV2.sum) && /SHA-256 digest: aa11/.test(buonaV2.sum), `uscita ${buonaV2.status}`)
    writeFileSync(apk, certificatoV2('C=US, O=Android, CN=Android Debug', 'bb22'))
    const debugV2 = esegui(firma, { VERSION: versione })
    check('firma: la chiave di debug nel formato "V2 Signer:", rosso', debugV2.status === 1 && /signed with the Android debug key/.test(debugV2.err), `uscita ${debugV2.status}`)
    writeFileSync(apk, certificato('C=US, O=Android, CN=Android Debug', 'bb22'))
    const debug = esegui(firma, { VERSION: versione })
    check('firma: la chiave di debug, rosso e niente riepilogo', debug.status === 1 && /signed with the Android debug key/.test(debug.err) && debug.sum === '', `uscita ${debug.status}`)
    writeFileSync(apk, 'DOES NOT VERIFY\n')
    const nessuno = esegui(firma, { VERSION: versione })
    check('firma: nessun certificato, rosso', nessuno.status === 1 && /printed no certificate/.test(nessuno.err), `uscita ${nessuno.status}`)
    // build: package e versione, con un avviso di aapt2 prima della riga package:
    const dentro = passo('build', 'Check the package and version inside the APK')
    const badging = (pkg, v) => `W/ziparchive: a warning first\npackage: name='${pkg}' versionCode='6' versionName='${v}' platformBuildVersionName='16'\nsdkVersion:'26'\n`
    const giusta = esegui(dentro, { VERSION: versione, FAKE_BADGING: badging(applicationId, versione) })
    check('aapt2: package e versione giusti, anche dopo un avviso, passano', giusta.status === 0, `uscita ${giusta.status}`)
    for (const [nome, b] of [['un\'altra versione', badging(applicationId, '9.9.9')], ['un altro package', badging('it.altro', versione)], ['niente riga package:', 'W: nothing\n']]) {
      const r = esegui(dentro, { VERSION: versione, FAKE_BADGING: b })
      check(`aapt2: ${nome}, rosso`, r.status === 1 && /::error::/.test(r.err), `uscita ${r.status}`)
    }
    // build: l'APK e le note per publish
    writeFileSync(apk, certificato('CN=Release Test', 'aa11'))
    const stage = esegui(passo('build', 'Stage the APK and the notes for publishing'), { VERSION: versione })
    const pronto = join(runner, 'release')
    check('l\'APK e le note in $RUNNER_TEMP/release, con i nomi che publish usa', stage.status === 0 &&
      leggiSe(join(pronto, nomeApk ?? 'x.apk')) === leggiSe(apk) && leggiSe(join(pronto, 'notes.md')) === (veri.note(versione) ?? '?'), `uscita ${stage.status}`)

    // publish: il confronto con la Latest (VERSION 1.2.0; l'APK pronto ha il certificato aa11)
    const conLatest = passo('publish', 'Check the release against the current Latest')
    const precedente = join(tmp, 'previous.apk')
    const prova = (nome, env, verde) => {
      const r = esegui(conLatest, { VERSION: '1.2.0', ...env }, ws)
      rmSync(join(runner, 'previous'), { recursive: true, force: true })
      check(`Latest: ${nome}, ${verde ? 'passa' : 'rosso'}`, verde ? r.status === 0 : r.status !== 0, `uscita ${r.status}`)
      return r
    }
    writeFileSync(precedente, certificato('CN=Release Test', 'aa11'))
    prova('nessuna release, la prima', {}, true)
    const stessa = prova(`la ${PREFISSO}1.1.9, stesso certificato`, { FAKE_LATEST: `${PREFISSO}1.1.9`, FAKE_PREVIOUS_APK: precedente }, true)
    check('Latest: lo stesso certificato nel riepilogo', /Same signing certificate as category-helper-v1\.1\.9: aa11/.test(stessa.sum))
    prova(`la ${PREFISSO}1.10.0 e' piu' nuova (sort -V, non alfabetico)`, { FAKE_LATEST: `${PREFISSO}1.10.0`, FAKE_PREVIOUS_APK: precedente }, false)
    prova(`la ${PREFISSO}1.2.0 e' gia' questa`, { FAKE_LATEST: `${PREFISSO}1.2.0`, FAKE_PREVIOUS_APK: precedente }, false)
    prova('una Latest che non e\' dell\'app (v1.1.0)', { FAKE_LATEST: 'v1.1.0', FAKE_PREVIOUS_APK: precedente }, false)
    prova('la Latest senza l\'APK', { FAKE_LATEST: `${PREFISSO}1.1.9` }, false)
    prova('gh che non risponde', { FAKE_GH_FAIL: '1' }, false)
    // la Latest letta da un apksigner che stampa "V2 Signer:", il nuovo APK con "Signer #1": conta il digest
    writeFileSync(precedente, certificatoV2('CN=Release Test', 'aa11'))
    const misto = prova(`la ${PREFISSO}1.1.9, stesso certificato ma nel formato "V2 Signer:"`, { FAKE_LATEST: `${PREFISSO}1.1.9`, FAKE_PREVIOUS_APK: precedente }, true)
    check('Latest: formato "V2 Signer:", lo stesso certificato nel riepilogo', /Same signing certificate as category-helper-v1\.1\.9: aa11/.test(misto.sum))
    writeFileSync(precedente, certificatoV2('CN=Another Key', 'cc33'))
    prova('la Latest firmata con un\'altra chiave, formato "V2 Signer:"', { FAKE_LATEST: `${PREFISSO}1.1.9`, FAKE_PREVIOUS_APK: precedente }, false)
    writeFileSync(precedente, certificato('CN=Another Key', 'cc33'))
    prova('la Latest firmata con un\'altra chiave', { FAKE_LATEST: `${PREFISSO}1.1.9`, FAKE_PREVIOUS_APK: precedente }, false)

    // publish: gh release create, con il file e le note che build ha passato
    const argomenti = join(tmp, 'gh-args')
    const pub = esegui(passo('publish', 'Publish the GitHub release'), { VERSION: versione, GITHUB_REF_NAME: `${PREFISSO}${versione}`, FAKE_GH_ARGS: argomenti }, ws)
    const a = leggiSe(argomenti).split('\n')
    const fileNote = a[a.indexOf('--notes-file') + 1]
    check('gh release create: il tag, l\'APK pronto col nome del link, il titolo, le note, --latest --verify-tag', pub.status === 0 &&
      a[0] === 'release' && a[1] === 'create' && a[2] === `${PREFISSO}${versione}` && existsSync(a[3] ?? '') && basename(a[3]) === nomeApk &&
      a.includes(`DokkanTS Category Helper ${versione}`) && leggiSe(fileNote ?? '') === veri.note(versione) && a.includes('--latest') && a.includes('--verify-tag') &&
      a[a.indexOf('--repo') + 1] === 'owner/repo', `uscita ${pub.status}, ${a.slice(0, 4).join(' ')}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
