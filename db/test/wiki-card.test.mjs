// L'id delle carte dalle pagine del wiki (db/import/wiki-card.mjs), che
// load-cards e fetch-assets usano tutti e due, e i testi delle skill
// (db/import/wiki-skills.mjs: template, note, EZA).
//
// Funzioni pure, niente database. La prima parte usa pagine scritte qui,
// cosi' ogni caso brutto c'e' di sicuro; la seconda le pagine vere della
// cache, se c'e', per i casi che hanno fatto nascere il fix (le Metal
// Cooler, 1033060).
//
//   node db/test/wiki-card.test.mjs
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assignCardIds, awakensInto, baseTexts, cleanSkill, datamineCards, field, idFieldIds, idsByTitle, imageCardId,
  inlineField, lineField, refsOf, skillsFromPage,
} from '../import/wiki-card.mjs'
import { lookupKey } from '../import/wiki-skills.mjs'

let fails = 0
let passes = 0
function check(nome, ok, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const vale = (nome, got, atteso) => {
  const g = JSON.stringify(got), a = JSON.stringify(atteso)
  check(nome, g === a, g === a ? `= ${g}` : `= ${g}, atteso ${a}`)
}

// una pagina carta minima, coi campi che servono
const pagina = (pageid, title, campi) => ({
  pageid, title,
  wikitext: '{{Characters\n' + Object.entries(campi).map(([k, v]) => `|${k} = ${v}`).join('\n') + '\n}}',
})
// un datamine finto: id -> riga, con element (tipo) e rarity come nei CSV
const TIPO = { AGL: 0, TEQ: 1, INT: 2, STR: 3, PHY: 4 }
const RAR = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4, LR: 5 }
const dmFinto = (righe) => new Map(righe.map(([id, tipo, rar]) =>
  [String(id), { id: String(id), element: String(20 + TIPO[tipo]), rarity: String(RAR[rar]) }]))

console.log('field e lineField')
{
  const w = '|thumb = \n|thumb apng = https://x/Card_1014470_thumb_apng.png\n|artwork = \n|Quotes = [[File:Card 1033060 sp phrase.png|200px]]\n|PS description =\n<b>Basic effect(s)</b> ATK +100%'
  vale('field scavalca l\'a capo (per i testi va bene)', field(w, 'artwork'), '|Quotes = [[File:Card 1033060 sp phrase.png|200px]]')
  vale('lineField no: un campo vuoto e\' vuoto', lineField(w, 'artwork'), null)
  vale('lineField: thumb vuoto non prende "|thumb apng"', lineField(w, 'thumb'), null)
  vale('field tiene la passiva scritta sulla riga dopo', field(w, 'PS description'), '<b>Basic effect(s)</b> ATK +100%')
  vale('lineField legge un valore normale', lineField(w, 'thumb apng'), 'https://x/Card_1014470_thumb_apng.png')
}

console.log('\nid dalle immagini')
{
  vale('dal thumb', imageCardId('|thumb = [[File:Card 1004600 thumb.png|120px]]'), 1004600)
  vale('dall\'APNG se il thumb e\' vuoto',
       imageCardId('|thumb = \n|thumb apng = https://v/images/c/cf/Card_1014470_thumb_apng.png/revision/latest'), 1014470)
  vale('da "thumb link" con {{ThumbLR}} e APNG vuoto',
       imageCardId('|thumb = {{ThumbLR|TEQ Golden Frieza + Gogeta|120}}\n|thumb apng = \n|thumb link = Card 1031720 thumb apng.png'), 1031720)
  vale('l\'immagine della frase non e\' un artwork',
       imageCardId('|thumb = {{ThumbLR|PHY X|120}}\n|artwork = \n|Quotes = [[File:Card 1033060 sp phrase.png|200px]]'), null)
}

console.log('\n|ID -> id della carta')
{
  vale('4 cifre', idFieldIds('|ID = 1461'), [1004610])
  vale('5 cifre', idFieldIds('|ID = 11569'), [1015690])
  vale('5 cifre, carte recenti', idFieldIds('|ID = 13219'), [1032190])
  vale('due versioni dietro le miniature',
       idFieldIds('|ID = [[File:Card 1031760 thumb.png|30px]] 13176<br>[[File:Card 1031770 thumb.png|30px]] 13177'),
       [1031760, 1031770])
  vale('7 cifre: e\' gia\' l\'id', idFieldIds('|ID = 1030200'), [1030200])
  vale('vuoto non scavalca la riga', idFieldIds('|ID = \n|cost = 77'), [])
}

console.log('\nassignCardIds')
{
  // cinque pagine con lo stesso thumb (le Metal Cooler), una con un |ID
  // che il gioco non conosce, una senza immagini col numero, una che
  // prova a prendersi l'id di un'altra pagina, una che resta condivisa
  const pages = [
    pagina(1, 'MC (AGL)', { thumb: '[[File:Card 1003640 thumb AGL.png|120px]]', type: 'AGL-E', rarity: 'SR', ID: '1364' }),
    pagina(2, 'MC (INT)', { thumb: '[[File:Card 1003640 thumb INT.png|120px]]', type: 'INT-E', rarity: 'SR', ID: '1461' }),
    pagina(3, 'MC (TEQ)', { thumb: '[[File:Card 1003640 thumb TEQ.png|120px]]', type: 'TEQ-E', rarity: 'SR', ID: '1462' }),
    pagina(4, 'MC (STR)', { thumb: '[[File:Card 1003640 thumb STR.png|120px]]', type: 'STR-E', rarity: 'SR', ID: '1463' }),
    pagina(5, 'MC (PHY)', { thumb: '[[File:Card 1003640 thumb PHY.png|120px]]', type: 'PHY-E', rarity: 'SR', ID: '1999' }),
    pagina(6, 'LR senza file', { thumb: '{{ThumbLR|STR Broly|120}}', type: 'ESTR', rarity: 'LR', ID: '13192' }),
    pagina(7, 'Altra carta', { thumb: '[[File:Card 1000010 thumb.png|120px]]', type: 'AGL-S', rarity: 'SSR', ID: '10' }),
    pagina(8, 'Refuso su |ID', { thumb: '', type: 'AGL-S', rarity: 'SSR', ID: '1001' }),
    pagina(9, 'Tipo sbagliato', { thumb: '', type: 'PHY-E', rarity: 'UR', ID: '13176' }),
    pagina(10, 'Copia A', { thumb: '[[File:Card 1005550 thumb.png|120px]]', type: 'AGL-S', rarity: 'SSR' }),
    pagina(11, 'Copia B', { thumb: '[[File:Card 1005550 thumb.png|120px]]', type: 'AGL-S', rarity: 'SSR' }),
  ]
  const dm = dmFinto([[1003640, 'AGL', 'SR'], [1004610, 'INT', 'SR'], [1004620, 'TEQ', 'SR'],
                      [1004630, 'STR', 'SR'], [1031920, 'STR', 'LR'], [1000010, 'AGL', 'SSR'],
                      [1031760, 'AGL', 'UR']])
  const ids = assignCardIds(pages, dm)
  const id = (pid) => ids.get(pid).id
  vale('Metal Cooler: |ID le separa', [1, 2, 3, 4].map(id), [1003640, 1004610, 1004620, 1004630])
  vale('immagine condivisa e |ID che il gioco non conosce: fuori', id(5), null)
  check('...e dice tutti e due i perche\'', /condiviso.*non esiste nel datamine/.test(ids.get(5).why ?? ''), ids.get(5).why)
  vale('LR senza un file col numero: id da |ID', id(6), 1031920)
  vale('|ID si dice quando e\' servito', ids.get(6).from, 'ID')
  vale('l\'immagine resta la fonte primaria', [id(7), ids.get(7).from], [1000010, 'immagine'])
  vale('un |ID col refuso (1001 -> 1000010) non ruba l\'id di un\'altra pagina', id(8), null)
  vale('un |ID col tipo sbagliato non vale', id(9), null)
  check('...e lo dice', /non e' PHY/.test(ids.get(9).why ?? ''), ids.get(9).why)
  vale('due pagine con lo stesso id e senza |ID: fuori tutte e due', [id(10), id(11)], [null, null])
  vale('senza datamine |ID non si usa', assignCardIds(pages, null).get(6).id, null)
  check('...e lo dice', /manca il datamine/.test(assignCardIds(pages, null).get(6).why), assignCardIds(pages, null).get(6).why)

  // l'immagine condivisa da sola non basta, nemmeno quando |ID ha gia'
  // separato le altre quattro: la quinta potrebbe essere un'altra carta
  const pages2 = pages.slice(0, 4).concat(pagina(5, 'MC (PHY)', { thumb: '[[File:Card 1003640 thumb PHY.png|120px]]', type: 'PHY-E', rarity: 'SR' }))
  const ids2 = assignCardIds(pages2, dm)
  vale('immagine condivisa senza |ID: fuori, le altre restano', [1, 2, 3, 4, 5].map((k) => ids2.get(k).id),
       [1003640, 1004610, 1004620, 1004630, null])
  // due pagine con lo stesso |ID verificato
  const pages3 = [pagina(1, 'A', { thumb: '', type: 'ESTR', rarity: 'LR', ID: '13192' }),
                  pagina(2, 'B', { thumb: '', type: 'ESTR', rarity: 'LR', ID: '13192' })]
  vale('due pagine con lo stesso |ID: fuori tutte e due', [...assignCardIds(pages3, dm).values()].map((r) => r.id), [null, null])
}

console.log('\nawakensInto')
{
  const pages = [
    pagina(1, 'Terrifying Metal Body Metal Cooler (AGL)', { thumb: '[[File:Card 1015680 thumb AGL.png|120px]]', type: 'EAGL', rarity: 'SSR', ID: '11568' }),
    pagina(2, 'Terrifying Metal Body Metal Cooler (INT)', { thumb: '[[File:Card 1015680 thumb INT.png|120px]]', type: 'EINT', rarity: 'SSR', ID: '11570' }),
  ]
  const dm = dmFinto([[1015680, 'AGL', 'SSR'], [1015700, 'INT', 'SSR']])
  const byTitle = idsByTitle(pages, assignCardIds(pages, dm))
  vale('vince la pagina del link=, non il nome del file',
       awakensInto('|dokkan thumb = [[File:Card 1015680 thumb INT.png|80px|link=Terrifying Metal Body Metal Cooler (INT)]]', byTitle), 1015700)
  vale('link a una pagina che non abbiamo: il nome del file',
       awakensInto('|dokkan thumb = [[File:Card 1025160 thumb.png|80px|link=Demonic Fighter of Steel Metal Cooler (AGL)]]', byTitle), 1025160)
  vale('{{ThumbLR}}: nessuna catena', awakensInto('|dokkan thumb = {{ThumbLR|TEQ SS Goku|80}}', byTitle), null)
  vale('vuoto non scavalca la riga', awakensInto('|dokkan thumb = \n|thumb = [[File:Card 1000010 thumb.png]]', byTitle), null)
}

console.log('\ninlineField (i testi delle skill)')
{
  const w = '|SA type = Ki |SA name = Galick Gun\n|UltraSA name = Big Bang\n|PS name = \n|PS description =\n'
    + '<b>Basic effect(s)</b><br>- ATK 100%<hr>\n<b>For every attack</b><br>- DEF 20%\n'
    + '|LS description = [[File:TEQ icon.png|30px|link=Category:TEQ]] & [[Prodigies|Prodigy]] Type ATK +60%\n'
    + '|Active skill = Causes damage<ref>x [[File:Global server.png|20px]]</ref> |Active skill condition = Once'
  vale('due campi sulla stessa riga: il secondo', inlineField(w, 'SA name'), 'Galick Gun')
  vale('...e il primo, fino al "|" del secondo', inlineField(w, 'SA type'), 'Ki')
  vale('"SA name" non e\' "|UltraSA name ="', inlineField('|UltraSA name = Big Bang', 'SA name'), null)
  vale('un [[a|b]] e un [[File:..|link=..]] nel valore non lo tagliano', inlineField(w, 'LS description'),
       '[[File:TEQ icon.png|30px|link=Category:TEQ]] & [[Prodigies|Prodigy]] Type ATK +60%')
  vale('un campo vuoto non prende la riga dopo', inlineField(w, 'PS name'), null)
  vale('la passiva a capo dopo l\'"=" e dopo un <hr> resta intera', inlineField(w, 'PS description'),
       '<b>Basic effect(s)</b><br>- ATK 100%<hr>\n<b>For every attack</b><br>- DEF 20%')
  vale('un "|" dentro una nota non chiude il campo', inlineField(w, 'Active skill'),
       'Causes damage<ref>x [[File:Global server.png|20px]]</ref>')
  vale('...e il campo dopo la nota si legge', inlineField(w, 'Active skill condition'), 'Once')
  vale('la prima scheda del tabber, non la seconda',
       inlineField('{{Characters\n|SA name = A\n}}\n|-|Rage=\n{{Characters\n|SA name = B\n|SA name2 = C\n}}', 'SA name2'), null)
}

console.log('\ncleanSkill')
{
  const c = (s, refs) => cleanSkill(s, refs)
  vale('<br> va a capo, <hr> separa, <b> diventa un titoletto',
       c('<b>Basic effect(s)</b><br>- ATK 120%<hr><b>When HP</b><br>- DEF 20%').text,
       'Basic effect(s)\n- ATK 120%\nWhen HP\n- DEF 20%')
  vale('{{Passive|UpArrow}} non resta nel testo: diventa la freccia', c('- ATK & DEF 120%{{Passive|UpArrow}}').text, '- ATK & DEF 120% ↑')
  vale('DownArrow e\' un calo, OneTime e Permanent restano parole',
       c('-{{Passive|OneTime}}DEF 20%{{Passive|DownArrow}}<br>-{{Passive|Permanent}}Ki +1').text,
       '- (Once only) DEF 20% ↓\n- (Permanent) Ki +1')
  vale('la nota va nei dettagli, e niente resta incollato',
       c('Raises DEF for 1 turn<ref>Raises DEF by 30% for 1 turn</ref>Raises ATK<ref>ATK +20%</ref>, then'),
       { text: 'Raises DEF for 1 turn Raises ATK, then', details: ['Raises DEF by 30% for 1 turn', 'ATK +20%'] })
  const refs = refsOf('x<ref name="[2]">Launched at 1-7 Ki</ref> y<ref name=lvl>From SA Lv.5</ref>')
  vale('una nota vuota col nome prende la definizione', c('Power Flick (Extreme)<ref name="[2]"></ref>', refs),
       { text: 'Power Flick (Extreme)', details: ['Launched at 1-7 Ki'] })
  vale('...anche scritta <ref name=x/>, senza virgolette', c('Blast<ref name=lvl/>', refs).details, ['From SA Lv.5'])
  vale('una nota che non esiste non lascia niente', c('Blast<ref name="[9]"/>', refs), { text: 'Blast', details: [] })
  vale('la stessa nota due volte si scrive una volta', c('a<ref>n</ref> b<ref>n</ref>').details, ['n'])
  vale('[[File:TEQ icon.png]] diventa TEQ, come prima; SINT e Rainbow pure',
       c('[[File:TEQ icon.png|30px|link=Category:TEQ]] Type; [[File:SINT icon.png|30px]] and [[File:Rainbow icon.png|30px|link=Rainbow Ki]] Ki').text,
       'TEQ Type; Super INT and Rainbow Ki')
  vale('gli altri [[File:]] spariscono, gli stati del nemico restano parole',
       c('[[File:Card 1 thumb.png|80px]]status: [[File:St 0100.png|30px|link=Stun]] or [[File:St_0012.png|link=Lower DEF]]').text,
       'status: Stun or Lower DEF')
  vale('[[a|b]] diventa b, [[:Category:X|Y]] diventa Y, [[c]] diventa c',
       c('"[[Prodigies|Prodigy]]", [[:Category:Super Class|Super Class]] and [[Youth]]').text, '"Prodigy", Super Class and Youth')
  vale('"-" da solo e\' "nessuna skill"', c('-').text, null)
  vale('spazi e righe vuote via, "-x" diventa "- x"', c('  <br><br>-ATK   +1<br> <br>').text, '- ATK +1')
  vale('commenti e template sconosciuti via', c('ATK<!-- nota | con pipe --> +1{{Foo|bar}}').text, 'ATK +1')
  vale('null resta null', c(null), { text: null, details: [] })
  vale('il link "How does it work?" non resta nella nota',
       c('raises ATK<ref>Raises ATK by 67% for 99 turns ([[Stack Attack|How does it work?]])</ref> and hits'),
       { text: 'raises ATK and hits', details: ['Raises ATK by 67% for 99 turns'] })
  vale('...nemmeno senza la parentesi chiusa, ne\' con Stack Defense',
       c('a<ref>DEF +9% for 9 turns ([[Stack Defense|How does it work?]]</ref>, b').details, ['DEF +9% for 9 turns'])
}

console.log('\nlookupKey')
{
  const stessa = (a, b) => check(`"${a}" e "${b}" sono lo stesso nome`, lookupKey(a) === lookupKey(b), `${lookupKey(a)} / ${lookupKey(b)}`)
  stessa('Universe’s Most Malevolent', "Universe's Most Malevolent")
  stessa('Warriors of Universe 6 ', 'Warriors of Universe 6')
  stessa('Namekians', 'Namekian')
  stessa('Androids/Cell Saga', 'Androids-Cell Saga')
  stessa('Fused Fighters', 'Fused Fighter')
  check('nomi diversi restano diversi', lookupKey('Androids') !== lookupKey('Androids/Cell Saga'))
}

console.log('\nskillsFromPage')
{
  const w = '{{Characters\n|LS description = Ki +3\n|LS description Z = Ki +4\n'
    + '|SA type = Ki |SA name = Galick Gun<ref name="[1]">12 Ki</ref>\n|SA description = Raises DEF<ref>DEF +30%</ref> and damages\n'
    + '|SA name Z = Galick Gun (Extreme)<ref name="[1]"></ref>\n|SA description Z = Raises DEF a lot\n'
    + '|PS name = Pride\n|PS description = - ATK 100%\n|PS description Z = - ATK 200%\n|PS description SZ = - ATK 300%\n'
    + '|SA type Active = M |Active skill name = Go!\n|Active skill = Causes damage |Active skill condition = Once only\n'
    + '|Transform type = Rage\n|Transform condition = HP 30% or less\n}}\n'
    + '|-|Standby=\n{{Characters\n|SA name = Other\n|SA description = not ours\n|Finish attack 1 name = End\n|Finish attack 1 description = Big hit\n}}'
  const rows = skillsFromPage(w)
  const k = (kind, tier = 'base', seq = 1) => rows.find((r) => r.kind === kind && r.tier === tier && r.seq === seq)
  vale('leader base ed EZA', [k('leader')?.description, k('leader', 'eza')?.description], ['Ki +3', 'Ki +4'])
  vale('super: nome, tipo e nota del nome e della descrizione', k('super'),
       { kind: 'super', tier: 'base', seq: 1, name: 'Galick Gun', description: 'Raises DEF and damages',
         details: ['12 Ki', 'DEF +30%'], condition: null, ki: 'Ki' })
  vale('super EZA col suo nome e la nota col nome risolta', [k('super', 'eza')?.name, k('super', 'eza')?.details], ['Galick Gun (Extreme)', ['12 Ki']])
  vale('passiva: il nome della base passa a EZA e Super EZA', ['base', 'eza', 'seza'].map((t) => k('passive', t)?.name), ['Pride', 'Pride', 'Pride'])
  vale('passiva Super EZA', k('passive', 'seza')?.description, '- ATK 300%')
  vale('attiva con condizione e tipo', [k('active')?.name, k('active')?.condition, k('active')?.ki], ['Go!', 'Once only', 'M'])
  vale('trasformazione: la condizione, col tipo come nome', [k('transform')?.name, k('transform')?.description], ['Rage', 'HP 30% or less'])
  vale('il Finish dalla scheda dello Standby', k('finish')?.name, 'End')
  vale('la super della seconda scheda non e\' della carta', rows.filter((r) => r.kind === 'super').length, 2)
  const tre = skillsFromPage('{{Characters\n|SA name = A<ref name="[2]">1-7 Ki</ref>\n|SA name2 = B\n|SA name3 = C\n'
    + '|SA description = one<br>two<ref>n2</ref><br> three\n}}')
  vale('tre super, una riga di descrizione ciascuna', tre.map((r) => [r.seq, r.name, r.description, r.details]),
       [[1, 'A', 'one', ['1-7 Ki']], [2, 'B', 'two', ['n2']], [3, 'C', 'three', []]])
  vale('una pagina senza testi non ha skill', skillsFromPage('{{Characters\n|PS description = -\n|LS description = \n}}'), [])
}

// --------------------------------------------- le pagine vere, se ci sono
const CACHE = fileURLToPath(new URL('../import/.cache/wiki-cards.json', import.meta.url))
const dm = datamineCards()
if (existsSync(CACHE) && dm) {
  console.log('\nle pagine vere della cache')
  const { pages } = JSON.parse(readFileSync(CACHE, 'utf8'))
  const ids = assignCardIds(pages, dm)
  const per = (re) => pages.filter((p) => re.test(p.title)).map((p) => ids.get(p.pageid).id).sort()
  vale('le cinque SR Metal Cooler hanno cinque id', per(/^Endless Horror Metal Cooler \(/),
       [1003640, 1004610, 1004620, 1004630, 1004640])
  vale('le cinque SSR Metal Cooler hanno cinque id', per(/^Terrifying Metal Body Metal Cooler \(/),
       [1015680, 1015690, 1015700, 1015710, 1015720])
  const tutti = [...ids.values()].filter((r) => r.id).map((r) => r.id)
  vale('nessun id su due pagine', tutti.length - new Set(tutti).size, 0)
  const p = pages.find((x) => /^\|[ \t]*ID[ \t]*=[ \t]*13306[ \t]*$/m.test(x.wikitext))
  if (p) vale('1033060: l\'artwork non e\' l\'immagine della frase', lineField(p.wikitext, 'artwork'), null)
}

// i testi delle skill sulle pagine vere: bastano le pagine, non il datamine
if (existsSync(CACHE)) {
  console.log('\nle skill delle pagine vere')
  const { pages } = JSON.parse(readFileSync(CACHE, 'utf8'))
  const pagina = (t) => pages.find((x) => x.title === t)?.wikitext
  const vegeta = pagina('Stable Combat Power Vegeta (Mini) (DAIMA)')        // 1030680
  check('c\'e\' la pagina di 1030680', Boolean(vegeta))
  if (vegeta) {
    const t = baseTexts(vegeta)
    check('1030680: la super non ha la nota incollata', !/turnRaises|Multiplier/.test(t.super_attack ?? ''), t.super_attack)
    check('1030680: la passiva ha i punti elenco', /\n- /.test(t.passive ?? ''), JSON.stringify(t.passive?.slice(0, 60)))
    check('1030680: la passiva tiene la parte dopo l\'<hr> a capo', /For every attack received or evaded/.test(t.passive ?? ''))
  }
  const pan = pagina('Wings Spread Out to the Cosmos Pan (GT) (Honey)')
  check('c\'e\' la pagina di Pan (GT) (Honey)', Boolean(pan))
  if (pan) {
    const rows = skillsFromPage(pan)
    const ultra = rows.find((r) => r.kind === 'ultra' && r.tier === 'eza')
    check('Pan: Ultra Super Attack EZA', Boolean(ultra), ultra?.name)
    check('Pan: la nota con nome risolta nei dettagli', ultra?.details.some((d) => /30% chance to stun/.test(d)), JSON.stringify(ultra?.details))
    const act = rows.find((r) => r.kind === 'active')
    check('Pan: attiva con la condizione', Boolean(act?.condition), act?.condition)
  }
  // su tutte le pagine: niente markup rimasto, e le super hanno il nome
  // (con field() a inizio riga, "|SA type = Ki |SA name = ..." lo perdeva)
  const tutte = pages.flatMap((x) => skillsFromPage(x.wikitext))
  const sporche = tutte.filter((r) => [r.name, r.description, r.condition, ...r.details]
    .some((v) => v && /\[\[|\]\]|\{\{|\}\}|<\/?(ref|br|hr|b)\b/i.test(v)))
  check('nessun markup nei testi', sporche.length === 0, sporche.length ? JSON.stringify(sporche[0]).slice(0, 200) : `${tutte.length} righe`)
  const come = tutte.filter((r) => [r.description, ...r.details].some((v) => /How does it work/i.test(v ?? '')))
  check('nessun "How does it work?" rimasto', come.length === 0, come.length ? JSON.stringify(come[0].details) : '')
  const conNome = tutte.filter((r) => r.kind === 'super' && r.tier === 'base' && r.name).length
  check('le super di base hanno il nome', conNome > 2500, `${conNome}`)
  const dup = new Set(), doppie = []
  for (const x of pages) {
    for (const r of skillsFromPage(x.wikitext)) {
      const k = `${x.pageid}/${r.kind}/${r.tier}/${r.seq}`
      if (dup.has(k)) doppie.push(k); dup.add(k)
    }
  }
  check('nessuna chiave (carta, tipo, livello, seq) doppia', doppie.length === 0, doppie.slice(0, 3).join(' '))
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
