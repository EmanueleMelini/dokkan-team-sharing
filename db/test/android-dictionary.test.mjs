// Il dizionario incluso nell'app Android (android/app/src/main/assets/
// categories.json) contro il suo generatore (db/import/categories/
// export-android.mjs, regole in android-dictionary.mjs). Funzioni pure e
// file letti, niente database, niente rete.
//
//   - sui file veri: l'asset nel repository e' byte per byte quello che il
//     generatore scriverebbe adesso dalla cache del datamine. Se il
//     datamine porta una categoria nuova, o cambiano nomi o alias, questo
//     resta rosso finche' l'asset non si rigenera (e l'app non esce con il
//     dizionario nuovo); poi i nomi giapponesi sono quelli delle missioni
//     dei titoli e gli alias quelli dell'API (aliasesFor);
//   - gli slug: la regola dell'app (DictionaryFormat.uniqueId) riscritta
//     in JavaScript rifa' da zero i 99 id della versione 2 (copiati qui
//     sotto), e l'asset li tiene tutti sullo stesso gameId: recenti e
//     preferiti puntano li';
//   - il generatore su input finti: l'ultimo nome noto, un nome preso da
//     un'altra categoria, una categoria nuova con lo slug gia' usato, la
//     version che sale solo se le categorie cambiano, il testo stabile.
//
//   node db/test/android-dictionary.test.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DM_DIR, parseCsv } from '../import/datamine.mjs'
import { NICKNAMES, aliasesFor } from '../import/categories/aliases.mjs'
import { extractJapaneseNames } from '../import/categories/japanese-names.mjs'
import { ASSET, buildAndroidDictionary, normalizeName, uniqueId } from '../import/categories/android-dictionary.mjs'

let fails = 0
let passes = 0
function check(nome, ok, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
  return ok
}
const vale = (nome, got, atteso) => {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  return check(nome, g === a, g === a ? `= ${g}` : `= ${g}, atteso ${a}`)
}
// Una lista vuota non prova niente: [].every() e' sempre vero.
function tutte(nome, righe, ok) {
  if (righe.length === 0) return check(nome, false, 'nessuna riga da verificare')
  const male = righe.filter((x) => !ok(x))
  return check(nome, male.length === 0, male.length ? `${male.length} su ${righe.length}, per esempio ${JSON.stringify(male[0])}` : `${righe.length} righe`)
}

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../..')

// Gli id del dizionario dell'app, versione 2 (15/11/2026), con il nome
// inglese da cui la regola li ha fatti, in ordine di id del gioco (1-99).
const V2 = [
  ['fusion', 'Fusion'],
  ['shadow_dragon_saga', 'Shadow Dragon Saga'],
  ['world_tournament', 'World Tournament'],
  ['peppy_gals', 'Peppy Gals'],
  ['hybrid_saiyans', 'Hybrid Saiyans'],
  ['universe_survival_saga', 'Universe Survival Saga'],
  ['resurrected_warriors', 'Resurrected Warriors'],
  ['realm_of_gods', 'Realm of Gods'],
  ['majin_buu_saga', 'Majin Buu Saga'],
  ['potara', 'Potara'],
  ['low_class_warrior', 'Low-Class Warrior'],
  ['super_saiyan_3', 'Super Saiyan 3'],
  ['giant_form', 'Giant Form'],
  ['planet_namek_saga', 'Planet Namek Saga'],
  ['ginyu_force', 'Ginyu Force'],
  ['movie_bosses', 'Movie Bosses'],
  ['pure_saiyans', 'Pure Saiyans'],
  ['namekians', 'Namekians'],
  ['future_saga', 'Future Saga'],
  ['full_power', 'Full Power'],
  ['androids', 'Androids'],
  ['representatives_of_universe_7', 'Representatives of Universe 7'],
  ['transformation_boost', 'Transformation Boost'],
  ['wicked_bloodline', 'Wicked Bloodline'],
  ['dragon_ball_seekers', 'Dragon Ball Seekers'],
  ['time_travelers', 'Time Travelers'],
  ['universe_6', 'Universe 6'],
  ['joined_forces', 'Joined Forces'],
  ['movie_heroes', 'Movie Heroes'],
  ['gokus_family', "Goku's Family"],
  ['vegetas_family', "Vegeta's Family"],
  ['artificial_life_forms', 'Artificial Life Forms'],
  ['youth', 'Youth'],
  ['db_saga', 'DB Saga'],
  ['siblings_bond', "Siblings' Bond"],
  ['super_saiyans', 'Super Saiyans'],
  ['worthy_rivals', 'Worthy Rivals'],
  ['androids_cell_saga', 'Androids/Cell Saga'],
  ['kamehameha', 'Kamehameha'],
  ['bond_of_master_and_disciple', 'Bond of Master and Disciple'],
  ['terrifying_conquerors', 'Terrifying Conquerors'],
  ['dragon_ball_heroes', 'Dragon Ball Heroes'],
  ['target_goku', 'Target: Goku'],
  ['otherworld_warriors', 'Otherworld Warriors'],
  ['super_saiyan_2', 'Super Saiyan 2'],
  ['final_trump_card', 'Final Trump Card'],
  ['exploding_rage', 'Exploding Rage'],
  ['revenge', 'Revenge'],
  ['team_bardock', 'Team Bardock'],
  ['inhuman_deeds', 'Inhuman Deeds'],
  ['earthlings', 'Earthlings'],
  ['special_pose', 'Special Pose'],
  ['majin_power', 'Majin Power'],
  ['rapid_growth', 'Rapid Growth'],
  ['all_out_struggle', 'All-Out Struggle'],
  ['universe_11', 'Universe 11'],
  ['saviors', 'Saviors'],
  ['battle_of_wits', 'Battle of Wits'],
  ['power_absorption', 'Power Absorption'],
  ['giant_ape_power', 'Giant Ape Power'],
  ['crossover', 'Crossover'],
  ['space_traveling_warriors', 'Space-Traveling Warriors'],
  ['connected_hope', 'Connected Hope'],
  ['corroded_body_and_mind', 'Corroded Body and Mind'],
  ['turtle_school', 'Turtle School'],
  ['miraculous_awakening', 'Miraculous Awakening'],
  ['powerful_comeback', 'Powerful Comeback'],
  ['gifted_warriors', 'Gifted Warriors'],
  ['planetary_destruction', 'Planetary Destruction'],
  ['defenders_of_justice', 'Defenders of Justice'],
  ['storied_figures', 'Storied Figures'],
  ['gt_heroes', 'GT Heroes'],
  ['gt_bosses', 'GT Bosses'],
  ['heavenly_events', 'Heavenly Events'],
  ['time_limit', 'Time Limit'],
  ['mastered_evolution', 'Mastered Evolution'],
  ['legendary_existence', 'Legendary Existence'],
  ['sworn_enemies', 'Sworn Enemies'],
  ['bond_of_friendship', 'Bond of Friendship'],
  ['accelerated_battle', 'Accelerated Battle'],
  ['entrusted_will', 'Entrusted Will'],
  ['worldwide_chaos', 'Worldwide Chaos'],
  ['battle_of_fate', 'Battle of Fate'],
  ['power_beyond_super_saiyan', 'Power Beyond Super Saiyan'],
  ['fused_fighters', 'Fused Fighters'],
  ['saiyan_saga', 'Saiyan Saga'],
  ['bond_of_parent_and_child', 'Bond of Parent and Child'],
  ['super_heroes', 'Super Heroes'],
  ['earth_bred_fighters', 'Earth-Bred Fighters'],
  ['power_of_wishes', 'Power of Wishes'],
  ['tournament_participants', 'Tournament Participants'],
  ['super_bosses', 'Super Bosses'],
  ['demonic_power', 'Demonic Power'],
  ['uncontrollable_power', 'Uncontrollable Power'],
  ['earth_protecting_heroes', 'Earth-Protecting Heroes'],
  ['successors', 'Successors'],
  ['mission_execution', 'Mission Execution'],
  ['daima', 'DAIMA'],
  ['golden_fighters', 'Golden Fighters'],
]

console.log('la regola degli slug (DictionaryFormat.uniqueId dell\'app)')
{
  vale('normalize come CategorySearch.normalize', [
    "Goku's Family", 'Low-Class Warrior', 'Androids/Cell Saga', 'Target: Goku', '  Super   Saiyan 3!! ', 'Ｆｕｓｉｏｎ', 'Siblings’ Bond', 'a`b', '!!!',
  ].map(normalizeName), ['gokus family', 'low class warrior', 'androids cell saga', 'target goku', 'super saiyan 3', 'fusion', 'siblings bond', 'ab', ''])
  const presi = new Set()
  const a = uniqueId("Goku's Family", presi); presi.add(a)
  const b = uniqueId("Goku's  family!", presi); presi.add(b)
  const c = uniqueId('GOKUS FAMILY', presi)
  vale('gli stessi casi del test Kotlin, poi _2 e _3 se preso', [a, b, c], ['gokus_family', 'gokus_family_2', 'gokus_family_3'])
  vale('un nome senza lettere ne\' cifre: category', uniqueId('!!', new Set()), 'category')
  check('la versione 2 ha 99 voci con id diversi', V2.length === 99 && new Set(V2.map(([id]) => id)).size === 99)
  const taken = new Set()
  const rifatti = V2.map(([, en]) => { const id = uniqueId(en, taken); taken.add(id); return id })
  const diversi = V2.filter(([id], i) => rifatti[i] !== id)
  check('la regola, da zero e in ordine di id del gioco, rifa\' i 99 id della versione 2', diversi.length === 0,
    diversi.length ? `${diversi.length} diversi, per esempio ${diversi[0][0]} -> ${rifatti[V2.indexOf(diversi[0])]}` : '99 su 99')
}

console.log('\nl\'asset nel repository contro il generatore (cache del datamine)')
const csv = (nome) => join(DM_DIR, `${nome}.csv`)
const file = join(RADICE, ASSET)
if (!existsSync(csv('card_categories')) || !existsSync(csv('missions'))) {
  check('la cache del datamine c\'e\' (card_categories.csv, missions.csv)', false, 'npm run db:fetch')
} else if (!existsSync(file)) {
  check(`${ASSET} c'e'`, false)
} else {
  const testo = readFileSync(file, 'utf8')
  const asset = JSON.parse(testo)
  const categorie = parseCsv(readFileSync(csv('card_categories'), 'utf8'))
  const japanese = extractJapaneseNames(parseCsv(readFileSync(csv('missions'), 'utf8')))
  const atteso = buildAndroidDictionary({ categories: categorie, japaneseNames: japanese.names, previous: asset })
  const righeA = testo.split('\n'), righeB = atteso.text.split('\n')
  const prima = righeA.findIndex((r, i) => r !== righeB[i])
  check('l\'asset e\' quello che il generatore scriverebbe adesso', testo === atteso.text,
    testo === atteso.text ? `${asset.categories.length} categorie, version ${asset.version}`
      : `riga ${prima + 1}: ${JSON.stringify(righeA[prima])} invece di ${JSON.stringify(righeB[prima])}; rigenera con node db/import/categories/export-android.mjs`)
  check('...e il generatore non ha niente da dire (nessun nome mancante, nessuna voce tolta)', atteso.warnings.length === 0, atteso.warnings.join(' | '))
  const voci = Array.isArray(asset.categories) ? asset.categories : []
  check('version 3 o piu\' (la 2 non aveva il gameId)', Number.isInteger(asset.version) && asset.version >= 3, String(asset.version))
  check('almeno le 99 categorie della versione 2', voci.length >= 99, String(voci.length))
  const daGioco = new Map(categorie.map((r) => [Number(r.id), r.name.trim()]))
  tutte('ogni voce ha un gameId del datamine, con lo stesso nome inglese', voci, (c) => Number.isInteger(c.gameId) && daGioco.get(c.gameId) === c.en)
  check('gameId e id diversi da voce a voce', new Set(voci.map((c) => c.gameId)).size === voci.length && new Set(voci.map((c) => c.id)).size === voci.length)
  tutte('in ordine di gameId', voci.slice(1), (c) => c.gameId > voci[voci.indexOf(c) - 1].gameId)
  tutte('il nome giapponese e\' quello delle missioni dei titoli', voci, (c) => japanese.names.get(c.gameId) === c.jp)
  tutte('gli alias sono quelli dell\'API (aliasesFor), prima i soprannomi', voci, (c) =>
    JSON.stringify([...c.aliases].sort()) === JSON.stringify(aliasesFor(c.gameId, c.en)) &&
    JSON.stringify(c.aliases.slice(0, (NICKNAMES[c.gameId] ?? []).length)) === JSON.stringify(NICKNAMES[c.gameId] ?? []))
  const perGioco = new Map(voci.map((c) => [c.gameId, c]))
  tutte('i 99 id della versione 2 restano, sullo stesso gameId', V2.map(([id], i) => ({ id, gameId: i + 1 })),
    (v) => perGioco.get(v.gameId)?.id === v.id)
  // oggi nessuna: la prima categoria nuova del gioco entra qui
  const presi = new Set(V2.map(([id]) => id))
  const nuove = voci.filter((c) => !V2.some(([id], i) => i + 1 === c.gameId && id === c.id))
  const storte = nuove.filter((c) => { const id = uniqueId(c.en, presi); presi.add(id); return id !== c.id })
  check(`le voci dopo la versione 2 (${nuove.length}) hanno lo slug della regola, mai uno gia' usato`, storte.length === 0,
    storte.map((c) => `${c.gameId} ${c.id}`).join(', '))
}

console.log('\nil generatore su input finti')
{
  const nomi = new Map([[1, 'フュージョン'], [2, '邪悪龍編'], [3, '天下一武道会']])
  const cat3 = [{ id: '1', name: 'Fusion' }, { id: '2', name: 'Shadow Dragon Saga' }, { id: '3', name: 'World Tournament' }]
  const v1 = buildAndroidDictionary({ categories: cat3, japaneseNames: nomi, previous: null })
  vale('senza un file di prima: version 1, slug dalla regola, gameId', v1.dictionary.categories.map((c) => [c.id, c.gameId]).concat([[v1.dictionary.version]]),
    [['fusion', 1], ['shadow_dragon_saga', 2], ['world_tournament', 3], [1]])
  vale('una voce per riga, come la versione 2', v1.text.split('\n').slice(0, 5), [
    '{', '  "version": 1,', '  "categories": [',
    '    { "id": "fusion", "gameId": 1, "en": "Fusion", "jp": "フュージョン", "aliases": [] },',
    '    { "id": "shadow_dragon_saga", "gameId": 2, "en": "Shadow Dragon Saga", "jp": "邪悪龍編", "aliases": ["sds"] },',
  ])
  const di = (previous, extra = {}) => buildAndroidDictionary({ categories: cat3, japaneseNames: nomi, previous, ...extra })
  const stesso = di(JSON.parse(v1.text))
  check('sul suo stesso testo: identico, version uguale, nessun avviso', stesso.text === v1.text && stesso.warnings.length === 0)
  // la versione 2: id scelti a mano, nessun gameId, gli alias com'erano
  const v2 = { version: 2, categories: [
    { id: 'fusione', en: 'Fusion', jp: 'フュージョン', aliases: [] },
    { id: 'sds', en: 'shadow dragon saga', jp: '邪悪龍編', aliases: ['sds'] },
  ] }
  const da2 = di(v2)
  vale('dalla versione 2 (senza gameId): gli id restano, per nome inglese', da2.dictionary.categories.map((c) => c.id), ['fusione', 'sds', 'world_tournament'])
  check('...e la version sale di uno', da2.dictionary.version === 3, String(da2.dictionary.version))
  const preso = di({ version: 5, categories: [{ id: 'world_tournament', gameId: 77, en: 'Old', jp: '古い', aliases: [] }] })
  vale('una categoria nuova con lo slug gia\' usato da una voce tolta: _2', preso.dictionary.categories.map((c) => c.id), ['fusion', 'shadow_dragon_saga', 'world_tournament_2'])
  check('...la voce tolta lo dice', preso.warnings.some((w) => /voce world_tournament \(Old\) del file di prima: non e' piu' nel dizionario/.test(w)), preso.warnings.join(' | '))
  check('...e la version sale (le categorie sono cambiate)', preso.dictionary.version === 6)
  const senza3 = new Map([[1, 'フュージョン'], [2, '邪悪龍編']])
  const ultimo = di(JSON.parse(v1.text), { japaneseNames: senza3 })
  vale('una categoria senza nome dalle missioni tiene l\'ultimo noto', ultimo.dictionary.categories.map((c) => c.jp), ['フュージョン', '邪悪龍編', '天下一武道会'])
  check('...e lo dice', ultimo.warnings.length === 1 && /categoria 3 World Tournament: .*ultimo noto 「天下一武道会」/.test(ultimo.warnings[0]), ultimo.warnings.join(' | '))
  check('...senza cambiare il testo ne\' la version', ultimo.text === v1.text)
  const rubato = di(JSON.parse(v1.text), { japaneseNames: new Map([[1, 'フュージョン'], [2, '天下一武道会']]) })
  vale('l\'ultimo nome noto preso da un\'altra categoria: la voce resta fuori', rubato.dictionary.categories.map((c) => [c.gameId, c.jp]), [[1, 'フュージョン'], [2, '天下一武道会']])
  check('...e lo dice', rubato.warnings.some((w) => /categoria 3 World Tournament: il suo ultimo nome 「天下一武道会」 ora e' di un'altra categoria/.test(w)), rubato.warnings.join(' | '))
  const mai = di(null, { japaneseNames: senza3 })
  check('senza nessun nome giapponese la categoria resta fuori, con un avviso', mai.dictionary.categories.length === 2 &&
    mai.warnings.some((w) => /categoria 3 World Tournament: nessun nome giapponese/.test(w)), mai.warnings.join(' | '))
  const strane = buildAndroidDictionary({ categories: [{ id: '2', name: ' Shadow Dragon Saga ' }, { id: 'x', name: 'Nope' }, { id: '1', name: 'Fusion' }, { id: '1', name: 'Again' }, { id: '3', name: '' }], japaneseNames: nomi })
  vale('righe del csv in disordine, doppie, senza id o senza nome: in ordine, una per id, nomi puliti',
    strane.dictionary.categories.map((c) => [c.gameId, c.en]), [[1, 'Fusion'], [2, 'Shadow Dragon Saga']])
  const sop = buildAndroidDictionary({ categories: [{ id: '17', name: 'Pure Saiyans' }, { id: '12', name: 'Super Saiyan 3' }], japaneseNames: new Map([[17, '純粋サイヤ人'], [12, '超サイヤ人3']]) })
  vale('gli alias nell\'ordine dell\'app: prima i soprannomi, poi le iniziali', sop.dictionary.categories.map((c) => c.aliases), [['ssj3', 'ss3'], ['pure', 'saiyan', 'ps']])
}

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
