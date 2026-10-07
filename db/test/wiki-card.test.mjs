// L'id delle carte dalle pagine del wiki (db/import/wiki-card.mjs), che
// load-cards e fetch-assets usano tutti e due.
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
  assignCardIds, awakensInto, datamineCards, field, idFieldIds, idsByTitle, imageCardId, lineField,
} from '../import/wiki-card.mjs'

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

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
