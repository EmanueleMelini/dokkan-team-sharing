// I nomi giapponesi e gli alias delle categorie (db/import/categories/,
// migrazione 0037), e il piano che load-datamine esegue. Funzioni pure,
// niente database.
//
//   - japanese-names.mjs sul missions.csv vero della cache: i 99 nomi
//     della lista fatta a mano dal database JP (copiata qui sotto, le
//     categorie di ottobre 2026: quelle nuove di un datamine piu' recente
//     devono solo avere un id di card_categories.csv), e le trappole (le missioni della categoria 5 con le stesse condizioni
//     ma senza 「…」カテゴリ). Poi righe finte: disaccordo, nessuna
//     missione, piu' categorie, condizioni illeggibili, lo stesso nome su
//     due id;
//   - aliases.mjs contro le 99 voci del dizionario dell'app Android
//     (versione 2, copiate qui sotto): iniziali generate piu' soprannomi,
//     esattamente;
//   - plan.mjs su stati finti: il primo giro, un secondo giro che non
//     scrive niente, lo scambio di due nomi (rifatto con unique (locale,
//     name) a ogni riga), l'ultimo nome noto, la riga "  attenzione:
//     categorie senza nome giapponese:", gli id spariti e quelli sconosciuti.
//
//   node db/test/category-names.test.mjs
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DM_DIR, loadTable } from '../import/datamine.mjs'
import { NICKNAMES, aliasesFor, initialsAlias } from '../import/categories/aliases.mjs'
import { extractJapaneseNames } from '../import/categories/japanese-names.mjs'
import { MARCA_SENZA_GIAPPONESE, planCategories, planLines } from '../import/categories/plan.mjs'

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

// Le 99 categorie di ottobre 2026: id del gioco, nome inglese
// (card_categories.csv), nome giapponese (la lista fatta a mano dal
// database del gioco JP) e gli alias del dizionario dell'app (versione 2),
// nell'ordine dell'app.
const CATEGORIE = [
  [1, 'Fusion', 'フュージョン', []],
  [2, 'Shadow Dragon Saga', '邪悪龍編', ['sds']],
  [3, 'World Tournament', '天下一武道会', ['wt']],
  [4, 'Peppy Gals', 'ピチピチギャル', ['pg']],
  [5, 'Hybrid Saiyans', '混血サイヤ人', ['hybrid', 'half saiyan', 'hs']],
  [6, 'Universe Survival Saga', '宇宙サバイバル編', ['tournament of power', 'top', 'uss']],
  [7, 'Resurrected Warriors', '復活戦士', ['rw']],
  [8, 'Realm of Gods', '神次元', ['rog']],
  [9, 'Majin Buu Saga', '魔人ブウ編', ['mbs']],
  [10, 'Potara', 'ポタラ', []],
  [11, 'Low-Class Warrior', '下級戦士', ['lcw']],
  [12, 'Super Saiyan 3', '超サイヤ人3', ['ssj3', 'ss3']],
  [13, 'Giant Form', '巨大化', ['gf']],
  [14, 'Planet Namek Saga', 'ナメック星編', ['pns']],
  [15, 'Ginyu Force', 'ギニュー特戦隊', ['gf']],
  [16, 'Movie Bosses', '劇場版BOSS', ['mb']],
  [17, 'Pure Saiyans', '純粋サイヤ人', ['pure', 'saiyan', 'ps']],
  [18, 'Namekians', 'ナメック星人', []],
  [19, 'Future Saga', '未来編', ['fs']],
  [20, 'Full Power', 'フルパワー', ['fp']],
  [21, 'Androids', '人造人間', []],
  [22, 'Representatives of Universe 7', '第7宇宙代表', ['universe 7', 'u7', 'rou7']],
  [23, 'Transformation Boost', '変身強化', ['tb']],
  [24, 'Wicked Bloodline', '最凶の一族', ['wb']],
  [25, 'Dragon Ball Seekers', 'ドラゴンボールを求めし者', ['dbs']],
  [26, 'Time Travelers', '時空を超えし者', ['tt']],
  [27, 'Universe 6', '第6宇宙', ['u6']],
  [28, 'Joined Forces', 'コンビネーション', ['jf']],
  [29, 'Movie Heroes', '劇場版HERO', ['mh']],
  [30, "Goku's Family", '孫悟空の系譜', ['gf']],
  [31, "Vegeta's Family", 'ベジータの系譜', ['vf']],
  [32, 'Artificial Life Forms', '人工生命体', ['alf']],
  [33, 'Youth', '少年・少女', []],
  [34, 'DB Saga', '少年編', ['dragon ball saga']],
  [35, "Siblings' Bond", '兄弟の絆', ['sb']],
  [36, 'Super Saiyans', '超サイヤ人', ['ssj', 'ss']],
  [37, 'Worthy Rivals', '好敵手', ['wr']],
  [38, 'Androids/Cell Saga', '人造人間/セル編', ['acs']],
  [39, 'Kamehameha', 'かめはめ波', ['kame']],
  [40, 'Bond of Master and Disciple', '師弟の絆', ['bomad']],
  [41, 'Terrifying Conquerors', '恐怖の征服', ['tc']],
  [42, 'Dragon Ball Heroes', 'DBヒーローズ', ['dbh']],
  [43, 'Target: Goku', 'ターゲット孫悟空', ['tg']],
  [44, 'Otherworld Warriors', 'あの世の戦士', ['ow']],
  [45, 'Super Saiyan 2', '超サイヤ人2', ['ssj2', 'ss2']],
  [46, 'Final Trump Card', '最後の切り札', ['ftc']],
  [47, 'Exploding Rage', '怒り爆発', ['er']],
  [48, 'Revenge', 'リベンジ', []],
  [49, 'Team Bardock', 'バーダックチーム', ['tb']],
  [50, 'Inhuman Deeds', '悪逆非道', ['id']],
  [51, 'Earthlings', '地球人', []],
  [52, 'Special Pose', 'スペシャルポーズ', ['sp']],
  [53, 'Majin Power', '魔人の力', ['mp']],
  [54, 'Rapid Growth', '急激な成長', ['rg']],
  [55, 'All-Out Struggle', '力戦奮闘', ['aos']],
  [56, 'Universe 11', '第11宇宙', ['u11']],
  [57, 'Saviors', '救世主', []],
  [58, 'Battle of Wits', '頭脳戦', ['bow']],
  [59, 'Power Absorption', '力の吸収', ['pa']],
  [60, 'Giant Ape Power', '大猿パワー', ['great ape', 'oozaru', 'gap']],
  [61, 'Crossover', 'クロスオーバー', []],
  [62, 'Space-Traveling Warriors', '宇宙をわたる戦士', ['stw']],
  [63, 'Connected Hope', 'つながる希望', ['ch']],
  [64, 'Corroded Body and Mind', '心身の侵食', ['cbam']],
  [65, 'Turtle School', '亀仙流', ['ts']],
  [66, 'Miraculous Awakening', '奇跡の覚醒', ['ma']],
  [67, 'Powerful Comeback', '再起する力', ['pc']],
  [68, 'Gifted Warriors', '天才戦士', ['gw']],
  [69, 'Planetary Destruction', '惑星破壊', ['pd']],
  [70, 'Defenders of Justice', '正義の味方', ['doj']],
  [71, 'Storied Figures', '語り継がれし者', ['sf']],
  [72, 'GT Heroes', 'GT HERO', []],
  [73, 'GT Bosses', 'GT BOSS', []],
  [74, 'Heavenly Events', '天界の出来事', ['he']],
  [75, 'Time Limit', '時間制限', ['tl']],
  [76, 'Mastered Evolution', '体得した進化', ['me']],
  [77, 'Legendary Existence', '伝説の存在', ['le']],
  [78, 'Sworn Enemies', '永遠の宿敵', ['se']],
  [79, 'Bond of Friendship', '親友の絆', ['bof']],
  [80, 'Accelerated Battle', '高速戦闘', ['ab']],
  [81, 'Entrusted Will', '託された意志', ['ew']],
  [82, 'Worldwide Chaos', '世界の混乱', ['wc']],
  [83, 'Battle of Fate', '命運をかけた闘い', ['bof']],
  [84, 'Power Beyond Super Saiyan', '超サイヤ人を超えた力', ['pbss']],
  [85, 'Fused Fighters', '融合/合体戦士', ['ff']],
  [86, 'Saiyan Saga', 'サイヤ人編', ['ss']],
  [87, 'Bond of Parent and Child', '親子の絆', ['bopac']],
  [88, 'Super Heroes', '超HERO', ['sh']],
  [89, 'Earth-Bred Fighters', '地球育ちの戦士', ['ebf']],
  [90, 'Power of Wishes', '願いの力', ['pow']],
  [91, 'Tournament Participants', '大会出場者', ['tp']],
  [92, 'Super Bosses', '超BOSS', ['sb']],
  [93, 'Demonic Power', '魔の力', ['dp']],
  [94, 'Uncontrollable Power', '制御不能の力', ['up']],
  [95, 'Earth-Protecting Heroes', '地球を守りし英雄', ['eph']],
  [96, 'Successors', '継承する者', []],
  [97, 'Mission Execution', '任務遂行', ['me']],
  [98, 'DAIMA', 'DAIMA', []],
  [99, 'Golden Fighters', '金色の戦士', ['gf']],
]

const NOME_EN = new Map(CATEGORIE.map(([id, en]) => [id, en]))
const NOME_JA = new Map(CATEGORIE.map(([id, , ja]) => [id, ja]))

// --------------------------------------------- i nomi dal missions.csv vero

console.log('i nomi giapponesi dal missions.csv della cache')
const CSV = join(DM_DIR, 'missions.csv')
const vere = existsSync(CSV) ? loadTable('missions') : null
if (!check('c\'e\' db/import/.cache/datamine/missions.csv (npm run db:datamine:fetch)', !!vere)) {
  console.log('  (senza la cache salto le verifiche sui dati veri)')
} else {
  const { names, problems } = extractJapaneseNames(vere)
  // la lista fatta a mano e' un sottoinsieme: un datamine piu' recente puo'
  // portare categorie nuove, che devono solo essere categorie vere
  tutte('ogni nome uguale alla lista fatta a mano (le 99 di ottobre 2026)', CATEGORIE, ([id, , ja]) => names.get(id) === ja)
  const idCategorie = existsSync(join(DM_DIR, 'card_categories.csv'))
    ? new Set(loadTable('card_categories').map((c) => Number(c.id))) : new Set()
  tutte('ogni id con un nome e\' una categoria di card_categories.csv', [...names.keys()], (id) => idCategorie.has(id))
  vale('nessun problema', problems.map((p) => p.msg), [])

  // le trappole: le missioni della categoria 5 con all_card_category_ids ma
  // senza 「…」カテゴリ in testa alla descrizione
  const conCategorie = vere.filter((r) => r.mission_category_id === '5' && r.conditions.includes('all_card_category_ids'))
  const per = (id) => conCategorie.filter((r) => [...new Set(JSON.parse(r.conditions).all_card_category_ids)].join() === String(id))
  const eroine = ['24844', '24845', '24846', '24870', '24871', '24872', '25150', '25151', '25152']
  const righeEroine = vere.filter((r) => eroine.includes(r.id))
  check('le nove missioni della ヒロインバトル ci sono, nella categoria 5 con [4, 4, 4, 4]', righeEroine.length === 9 &&
    righeEroine.every((r) => r.mission_category_id === '5' && JSON.parse(r.conditions).all_card_category_ids.join() === '4,4,4,4'))
  const soloEroine = extractJapaneseNames(righeEroine)
  check('...da sole non danno nessun nome e nessun problema', soloEroine.names.size === 0 && soloEroine.problems.length === 0)
  check('...e la categoria 4 ha almeno 12 missioni con le sue condizioni, ma il nome giusto',
    per(4).length >= 12 && names.get(4) === 'ピチピチギャル', `${per(4).length} missioni, ${names.get(4)}`)
  for (const id of [21, 77, 78, 81]) {
    const r = extractJapaneseNames(per(id))
    check(`categoria ${id}: ${per(id).length} missioni con le sue condizioni, il nome dalle 3 dei titoli`,
      per(id).length > 3 && r.names.get(id) === NOME_JA.get(id) && r.problems.length === 0,
      `${per(id).length} missioni, ${r.names.get(id)}`)
  }
  // le missioni di una categoria nuova arrivano col suo commit: senza le
  // tre dei titoli, nessun nome (e il piano tiene l'ultimo noto)
  const senza7 = extractJapaneseNames(vere.filter((r) => !per(7).includes(r)))
  check('senza le missioni della categoria 7: un nome in meno, la 7 manca', senza7.names.size === names.size - 1 && !senza7.names.has(7),
    `${senza7.names.size} nomi su ${names.size}`)
}

// ------------------------------------------------------- righe finte

console.log('\ni nomi giapponesi su righe finte')
let prossima = 900000
const missione = (ids, descrizione, extra = {}) => ({
  id: String(prossima++), mission_category_id: '5', name: '', description: descrizione,
  conditions: JSON.stringify({ all_card_category_ids: ids }), ...extra,
})
const titoli = (id, nome) => [10, 100, 300].map((n) =>
  missione(Array(6).fill(id), `「${nome}」カテゴリに\n属するキャラクターを6体編成して${n}回クリア`))
{
  const r = extractJapaneseNames([...titoli(200, '試験'), ...titoli(201, '別の名前')])
  vale('tre missioni d\'accordo: il nome', [r.names.get(200), r.names.get(201), r.problems.length], ['試験', '別の名前', 0])
}
{
  const [a, b, c] = titoli(200, '試験')
  const r = extractJapaneseNames([a, b, { ...c, description: '「違う名前」カテゴリに属する...' }])
  check('missioni in disaccordo: nessun nome, un problema "disaccordo"', !r.names.has(200) &&
    r.problems.length === 1 && r.problems[0].kind === 'disaccordo' && r.problems[0].id === 200 &&
    r.problems[0].msg.includes('試験') && r.problems[0].msg.includes('違う名前'), r.problems.map((p) => p.msg).join())
}
{
  const r = extractJapaneseNames([missione([200, 200, 201], '「試験」カテゴリに属する...')])
  check('due categorie nella stessa missione: nessun nome, un problema "piu_categorie"',
    r.names.size === 0 && r.problems.length === 1 && r.problems[0].kind === 'piu_categorie')
  const v = extractJapaneseNames([missione([], '「試験」カテゴリに属する...')])
  check('nessuna categoria: nessun nome, un problema', v.names.size === 0 && v.problems[0]?.kind === 'piu_categorie')
  const x = extractJapaneseNames([{ ...missione([200], '「試験」カテゴリに属する...'), conditions: '{rotto' }])
  check('condizioni illeggibili: nessun nome, un problema "condizioni"', x.names.size === 0 && x.problems[0]?.kind === 'condizioni')
}
{
  const r = extractJapaneseNames([
    ...titoli(200, '試験').map((m) => ({ ...m, mission_category_id: '8' })),
    missione([201], '[en]「試験」カテゴリに属する...'),
    missione([202], 'チャレンジイベント\n「試験」カテゴリに属する...'),
    missione([203], '「超激闘大全」のステージ3を\n「試験」カテゴリに属するキャラクターを'),
    missione([204], '', { name: '「試験」結集！' }),
  ])
  check('fuori: un\'altra mission_category_id, 「…」カテゴリ non in testa, il nome solo nel campo name',
    r.names.size === 0 && r.problems.length === 0, JSON.stringify([...r.names]))
  const s = extractJapaneseNames([missione([205, 205], '  「試験」カテゴリに属する...'), { ...missione(['205.0'], '「試験」カテゴリ'), mission_category_id: '5.0' }])
  vale('spazi in testa e id scritti 205.0: lo stesso nome', [...s.names], [[205, '試験']])
}
{
  const r = extractJapaneseNames([...titoli(200, '同じ'), ...titoli(201, '同じ'), ...titoli(202, '別')])
  check('lo stesso nome su due id: nessuno dei due lo prende, un problema "nome_doppio"',
    !r.names.has(200) && !r.names.has(201) && r.names.get(202) === '別' &&
    r.problems.length === 1 && r.problems[0].kind === 'nome_doppio' && r.problems[0].ids?.join() === '200,201')
}
check('nessuna missione: nessun nome', extractJapaneseNames([]).names.size === 0)

// ------------------------------------------------------------- alias

console.log('\ngli alias contro il dizionario dell\'app')
tutte('aliasesFor rifa\' gli alias dell\'app, per tutte le 99', CATEGORIE,
  ([id, en, , app]) => JSON.stringify(aliasesFor(id, en)) === JSON.stringify([...app].sort()))
tutte('...e le iniziali generate, quando ci sono, sono fra quelli', CATEGORIE,
  ([, en, , app]) => initialsAlias(en) == null || app.includes(initialsAlias(en)))
tutte('...e ogni altro alias dell\'app e\' un soprannome di NICKNAMES', CATEGORIE,
  ([id, en, , app]) => JSON.stringify(app.filter((a) => a !== initialsAlias(en)).sort()) === JSON.stringify([...(NICKNAMES[id] ?? [])].sort()))
tutte('i soprannomi sono di categorie vere, minuscoli, senza spazi ai bordi e diversi dalle iniziali',
  Object.entries(NICKNAMES), ([id, ns]) => NOME_EN.has(Number(id)) && ns.length > 0 &&
    ns.every((n) => n === n.trim().toLowerCase() && n !== '' && n !== initialsAlias(NOME_EN.get(Number(id)))))
vale('nessuna iniziale per un nome di una parola o con una sigla',
  ['Fusion', 'DAIMA', 'DB Saga', 'GT Heroes', 'Kamehameha', '', '  '].map(initialsAlias), [null, null, null, null, null, null, null])
vale('apostrofi (anche curvi), trattini, barre, due punti, numeri interi',
  ["Goku's Family", 'Goku’s Family', "Siblings' Bond", 'Low-Class Warrior', 'Androids/Cell Saga', 'Target: Goku',
    'Universe 11', 'Super Saiyan 3', 'Bond of Master and Disciple', 'Representatives of Universe 7'].map(initialsAlias),
  ['gf', 'gf', 'sb', 'lcw', 'acs', 'tg', 'u11', 'ss3', 'bomad', 'rou7'])
vale('una categoria nuova ha le sue iniziali e niente soprannomi', aliasesFor(500, 'Brand New Category'), ['bnc'])
vale('alias in ordine, senza doppioni', aliasesFor(22, 'Representatives of Universe 7'), ['rou7', 'u7', 'universe 7'])

// ------------------------------------------------------------- il piano

console.log('\nil piano delle categorie')
const DM = CATEGORIE.map(([id, name]) => ({ id, name }))
const JP = { names: new Map(CATEGORIE.map(([id, , ja]) => [id, ja])), problems: [] }

// Rifa' le scritture di write.mjs su un modello in memoria, nello stesso
// ordine, con le chiavi primarie, la cascata e unique (locale, name)
// controllati riga per riga. Torna il nuovo stato, o { errore }.
function applica(stato, plan) {
  const ids = new Set(stato.ids)
  let text = stato.text.map((r) => ({ ...r }))
  let aliases = stato.aliases.map((a) => ({ ...a }))
  for (const id of plan.insertIds) {
    if (ids.has(id)) return { errore: `category ${id} c'e' gia'` }
    ids.add(id)
  }
  for (const id of plan.deleteIds) {
    ids.delete(id)
    text = text.filter((r) => r.category_id !== id)
    aliases = aliases.filter((a) => a.category_id !== id)
  }
  for (const d of plan.text.delete) text = text.filter((r) => !(r.category_id === d.category_id && r.locale === d.locale))
  for (const r of plan.text.insert) {
    if (!ids.has(r.category_id)) return { errore: `FK: category ${r.category_id} non c'e'` }
    if (text.some((t) => t.category_id === r.category_id && t.locale === r.locale)) return { errore: `PK: ${r.category_id} ${r.locale}` }
    if (text.some((t) => t.locale === r.locale && t.name === r.name)) return { errore: `unique (locale, name): ${r.locale} ${r.name}` }
    text.push({ ...r })
  }
  for (const d of plan.aliases.delete) aliases = aliases.filter((a) => !(a.category_id === d.category_id && a.alias === d.alias))
  for (const a of plan.aliases.insert) {
    if (!ids.has(a.category_id)) return { errore: `FK alias: ${a.category_id}` }
    if (aliases.some((x) => x.category_id === a.category_id && x.alias === a.alias)) return { errore: `PK alias: ${a.category_id} ${a.alias}` }
    aliases.push({ ...a })
  }
  return { ids: [...ids].sort((a, b) => a - b), text, aliases }
}
const niente = (p) => !p.insertIds.length && !p.deleteIds.length && !p.text.delete.length && !p.text.insert.length &&
  !p.aliases.delete.length && !p.aliases.insert.length
const nome = (stato, id, locale) => stato.text.find((r) => r.category_id === id && r.locale === locale)?.name
const marca = (righe) => righe.find((l) => l.startsWith(`  ${MARCA_SENZA_GIAPPONESE}`))

// la fixture dei test: le categorie 1-3 con nomi inventati, anche
// giapponesi, e un nome inglese ("Pure Saiyans") che nel datamine e' di
// un'altra categoria (17), e una riga in un'altra lingua
const FIXTURE = {
  ids: [1, 2, 3],
  text: [
    { category_id: 1, locale: 'en', name: 'Wicked Bloodline', source: 'official' }, { category_id: 1, locale: 'ja', name: '邪悪な血統', source: 'official' },
    { category_id: 2, locale: 'en', name: 'Pure Saiyans', source: 'official' }, { category_id: 2, locale: 'ja', name: '純粋サイヤ人', source: 'official' },
    { category_id: 3, locale: 'en', name: 'Realm of Gods', source: 'official' }, { category_id: 3, locale: 'ja', name: '神の領域', source: 'official' },
    { category_id: 3, locale: 'it', name: 'Regno degli dei', source: 'community' },
  ],
  aliases: [],
}
const p1 = planCategories({ datamine: DM, japanese: JP, current: FIXTURE })
const s1 = applica(FIXTURE, p1)
check('primo giro sulla fixture: le scritture reggono i vincoli riga per riga', !s1.errore, s1.errore)
vale('...96 categorie nuove, nessuna tolta', [p1.insertIds.length, p1.deleteIds.length], [96, 0])
check('...99 nomi inglesi e 99 giapponesi, quelli del datamine e delle missioni', !s1.errore &&
  CATEGORIE.every(([id, en, ja]) => nome(s1, id, 'en') === en && nome(s1, id, 'ja') === ja) &&
  s1.text.filter((r) => r.locale === 'en').length === 99 && s1.text.filter((r) => r.locale === 'ja').length === 99)
check('...la riga in italiano resta', !s1.errore && nome(s1, 3, 'it') === 'Regno degli dei')
check('...gli alias sono quelli di aliasesFor, col tipo giusto', !s1.errore &&
  CATEGORIE.every(([id, en]) => JSON.stringify(s1.aliases.filter((a) => a.category_id === id).map((a) => a.alias).sort()) === JSON.stringify(aliasesFor(id, en))) &&
  s1.aliases.every((a) => a.kind === (a.alias === initialsAlias(NOME_EN.get(a.category_id)) ? 'initials' : 'nickname')))
vale('...conti: 99 + 99 nomi, alias (iniziali, soprannomi)',
  [p1.counts.en, p1.counts.ja, p1.counts.jaFromMissions, p1.counts.initials, p1.counts.nicknames],
  [99, 99, 99, CATEGORIE.filter(([, en]) => initialsAlias(en)).length, Object.values(NICKNAMES).flat().length])
check('...nessuna riga "attenzione" nel log', !marca(planLines(p1)), planLines(p1).join(' | '))

const p2 = planCategories({ datamine: DM, japanese: JP, current: s1 })
check('secondo giro: niente da scrivere', niente(p2), JSON.stringify({ ...p2, problems: undefined }).slice(0, 300))
vale('...e il log lo dice', planLines(p2).slice(0, 3), [
  '  categorie con gli id del gioco: 99 (nuove 0, tolte 0)',
  '  nomi giapponesi delle categorie: 99, 99 dalle missioni dei titoli (nuovi 0, cambiati 0); nomi inglesi cambiati: 0',
  `  alias delle categorie: ${p1.counts.aliases} (iniziali ${p1.counts.initials}, soprannomi ${p1.counts.nicknames}; righe cambiate 0)`,
])

{
  // due categorie che si scambiano i nomi, in tutte e due le lingue
  const scambiati = structuredClone(s1)
  for (const r of scambiati.text) {
    if (r.category_id === 1 || r.category_id === 2) r.name = (r.category_id === 1 ? nome(s1, 2, r.locale) : nome(s1, 1, r.locale))
  }
  const p = planCategories({ datamine: DM, japanese: JP, current: scambiati })
  const s = applica(scambiati, p)
  check('due nomi scambiati: si rimettono a posto senza violare unique (locale, name)', !s.errore &&
    nome(s, 1, 'en') === 'Fusion' && nome(s, 2, 'en') === 'Shadow Dragon Saga' && nome(s, 1, 'ja') === 'フュージョン' &&
    nome(s, 2, 'ja') === '邪悪龍編', s.errore)
  vale('...toccando solo quelle quattro righe', [p.text.delete.length, p.text.insert.length, p.counts.enChanged, p.counts.jaChanged], [4, 4, 2, 2])
}
{
  // un nome giapponese che passa alla categoria 5 mentre la 6 lo teneva
  const jp = { names: new Map(JP.names), problems: [] }
  jp.names.set(5, '宇宙サバイバル編'); jp.names.set(6, '新しい名前')
  const p = planCategories({ datamine: DM, japanese: jp, current: s1 })
  const s = applica(s1, p)
  check('un nome che passa da un id a un altro nello stesso giro: regge', !s.errore && nome(s, 5, 'ja') === '宇宙サバイバル編' && nome(s, 6, 'ja') === '新しい名前', s.errore)
}
{
  // l'ultimo nome noto: la 7 senza missioni dei titoli
  const jp = { names: new Map(JP.names), problems: [] }
  jp.names.delete(7)
  const p = planCategories({ datamine: DM, japanese: jp, current: s1 })
  const s = applica(s1, p)
  check('una categoria senza nome dalle missioni tiene l\'ultimo noto, senza riscriverlo', !s.errore &&
    nome(s, 7, 'ja') === '復活戦士' && !p.text.delete.some((d) => d.category_id === 7) && !p.text.insert.some((d) => d.category_id === 7))
  vale('...missingJa lo dice', p.missingJa, [{ id: 7, name_en: 'Resurrected Warriors', kept: '復活戦士' }])
  const righe = planLines(p)
  vale('...la riga che il giro settimanale cerca', marca(righe), '  attenzione: categorie senza nome giapponese: 7 Resurrected Warriors')
  check('...seguita dal dettaglio', righe[righe.indexOf(marca(righe)) + 1] === '    (resta l\'ultimo nome noto: 7)', righe.join(' | '))
  // e una categoria nuova (100) che un nome giapponese non l'ha mai avuto
  const dm = [...DM, { id: 100, name: 'Brand New Category' }]
  const q = planCategories({ datamine: dm, japanese: jp, current: s1 })
  const t = applica(s1, q)
  check('una categoria nuova senza missioni: entra col nome inglese e le iniziali, senza giapponese', !t.errore &&
    nome(t, 100, 'en') === 'Brand New Category' && nome(t, 100, 'ja') == null &&
    t.aliases.some((a) => a.category_id === 100 && a.alias === 'bnc' && a.kind === 'initials'))
  vale('...e la riga la elenca con le altre', marca(planLines(q)),
    '  attenzione: categorie senza nome giapponese: 7 Resurrected Warriors, 100 Brand New Category')
  check('...dicendo quale tiene l\'ultimo nome e quale non ne ha', planLines(q).includes('    (resta l\'ultimo nome noto: 7; nessun nome giapponese: 100)'),
    planLines(q).join(' | '))
}
{
  // l'ultimo nome noto della 7 ora e' di un'altra categoria per le missioni
  const jp = { names: new Map(JP.names), problems: [] }
  jp.names.delete(7); jp.names.set(8, '復活戦士')
  const p = planCategories({ datamine: DM, japanese: jp, current: s1 })
  const s = applica(s1, p)
  check('un ultimo nome noto che le missioni danno a un\'altra categoria: lo prende quella, la vecchia resta senza', !s.errore &&
    nome(s, 8, 'ja') === '復活戦士' && nome(s, 7, 'ja') == null && p.missingJa.some((m) => m.id === 7 && m.kept === null) &&
    p.problems.some((x) => x.kind === 'nome_preso' && x.id === 7), s.errore)
}
{
  // una categoria sparita dal datamine, e un nome giapponese per un id che non c'e'
  const dm = DM.filter((c) => c.id !== 99)
  const jp = { names: new Map(JP.names), problems: [] }
  jp.names.set(300, '幽霊')
  const p = planCategories({ datamine: dm, japanese: jp, current: s1 })
  const s = applica(s1, p)
  check('una categoria sparita si toglie (la cascata porta via testi e alias), senza cancellare righe a parte', !s.errore &&
    p.deleteIds.join() === '99' && !s.ids.includes(99) && !s.text.some((r) => r.category_id === 99) &&
    !p.text.delete.some((d) => d.category_id === 99) && !p.aliases.delete.some((d) => d.category_id === 99))
  // la 99 ha ancora le sue missioni dei titoli, la 300 non e' mai esistita
  check('un nome per un id che il datamine non ha: ignorato, con un problema', p.ignored.map((x) => x.id).join() === '99,300' &&
    !p.text.insert.some((r) => r.category_id === 300 || r.category_id === 99) &&
    planLines(p).some((l) => l.includes('categoria 300') && l.includes('lo ignoro')), p.ignored.map((x) => x.id).join())
  check('...e niente riga "attenzione" (ogni categoria del datamine ha il suo nome)', !marca(planLines(p)))
}
{
  // un nome inglese corretto nel datamine, un alias cambiato di tipo, una
  // riga 'ja' della community che le missioni rendono ufficiale
  const dm = DM.map((c) => (c.id === 49 ? { ...c, name: 'Team Bardock Revised' } : c))
  const stato = structuredClone(s1)
  stato.text.find((r) => r.category_id === 9 && r.locale === 'ja').source = 'community'
  stato.aliases.find((a) => a.category_id === 12 && a.alias === 'ssj3').kind = 'initials'
  stato.aliases.push({ category_id: 13, alias: 'vecchio', kind: 'nickname' })
  const p = planCategories({ datamine: dm, japanese: JP, current: stato })
  const s = applica(stato, p)
  check('un nome inglese cambiato si riscrive, con le iniziali nuove', !s.errore && nome(s, 49, 'en') === 'Team Bardock Revised' &&
    s.aliases.some((a) => a.category_id === 49 && a.alias === 'tbr') && !s.aliases.some((a) => a.category_id === 49 && a.alias === 'tb'))
  check('una riga della community diventa ufficiale', !s.errore && s.text.find((r) => r.category_id === 9 && r.locale === 'ja')?.source === 'official')
  check('un alias col tipo sbagliato si corregge, uno in piu\' si toglie', !s.errore &&
    s.aliases.find((a) => a.category_id === 12 && a.alias === 'ssj3')?.kind === 'nickname' && !s.aliases.some((a) => a.alias === 'vecchio'))
  check('...e dopo, un altro giro non scrive niente', !s.errore && niente(planCategories({ datamine: dm, japanese: JP, current: s })))
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
