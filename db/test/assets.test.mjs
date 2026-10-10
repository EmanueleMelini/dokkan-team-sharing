// Le immagini, lato puro: quali job fa fetch-assets per ogni carta (anche
// senza pagina wiki, db/import/asset-jobs.mjs), cosa vuol dire una
// risposta della CDN e quanto si aspetta prima di ritentare, da dove viene
// un asset (0033), e i limiti di spazio (db/import/asset-limits.mjs).
//
// Funzioni pure, niente database ne' rete. In fondo le pagine vere della
// cache, se c'e', per i casi che hanno fatto nascere il lavoro.
//
//   node db/test/assets.test.mjs
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CONVENZIONE, cardJobs, directUrlIn, fileFromUrl } from '../import/asset-jobs.mjs'
import {
  ANIM_ART_BUDGET, ANIM_ART_MAX_FILE, ANIM_THUMB_MAX_FILE, PAGES_MAX_FILE_BYTES, avvisiSpazio, decisioneAnimato,
  kindOfKey, rapportoSpazio,
} from '../import/asset-limits.mjs'
import { MAX_RITENTI, attesaRitento, esitoHttp, provenienza, selectJobs, urlDiOrigine } from '../import/asset-select.mjs'
import { assignCardIds, datamineCards } from '../import/wiki-card.mjs'

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

const pagina = (pageid, campi) => ({
  pageid, title: `P${pageid}`,
  wikitext: '{{Characters\n' + Object.entries(campi).map(([k, v]) => `|${k} = ${v}`).join('\n') + '\n}}',
})
const APNG = 'https://static.wikia.nocookie.net/dbz-dokkanbattle/images/7/7d/Card_1030970_thumb_apng.png/revision/latest?cb=20250807200928&format=original'
const MiB = 1024 * 1024

console.log('i job delle carte')
{
  const pages = [
    pagina(1, { thumb: '[[File:Card 1000010 thumb.png|120px]]', artwork: '[[File:Card 1000010 artwork.png|250px]]' }),
    pagina(2, { thumb: '', artwork: '' }),
    pagina(3, { thumb: '[[File:Card 1999990 thumb.png|120px]]' }),
    pagina(4, { thumb: '{{ThumbLR|INT X|120}}', 'thumb apng': APNG, artwork: '' }),
  ]
  const ids = new Map([[1, { id: 1000010 }], [2, { id: 1031920 }], [3, { id: 1999990 }], [4, { id: 1030970 }]])
  const cardIds = new Set([1000010, 1031920, 1030970, 1034030])
  const jobs = cardJobs({ pages, ids, cardIds })
  const di = (id) => jobs.filter((j) => j.card === id)
  const job = (id, kind) => jobs.find((j) => j.card === id && j.kind === kind)

  vale('senza pagina (1034030): la miniatura per convenzione', job(1034030, 'card_thumb')?.files, ['Card 1034030 thumb.png'])
  vale('...e l\'artwork, poi il bg', job(1034030, 'card_art')?.files, ['Card 1034030 artwork.png', 'Card 1034030 bg.png'])
  check('...quiet, senza URL diretto e senza animati', di(1034030).every((j) => j.quiet && !j.directUrl) &&
    !di(1034030).some((j) => j.kind.endsWith('animated')), JSON.stringify(di(1034030).map((j) => j.kind)))
  vale('con pagina: prima il file dichiarato, poi la convenzione', job(1000010, 'card_thumb')?.files,
       ['Card 1000010 thumb.png'])
  vale('...l\'artwork dichiarato e la convenzione, senza doppioni', job(1000010, 'card_art')?.files,
       ['Card 1000010 artwork.png', 'Card 1000010 bg.png'])
  check('...e non e\' quiet', job(1000010, 'card_thumb')?.quiet === false && job(1000010, 'card_art')?.quiet === false)
  vale('una pagina con |thumb vuoto: solo la convenzione', job(1031920, 'card_thumb')?.files, ['Card 1031920 thumb.png'])
  check('...ed e\' quiet', job(1031920, 'card_thumb')?.quiet === true && job(1031920, 'card_art')?.quiet === true)
  check('una pagina il cui id non e\' in tabella: nessun job', di(1999990).length === 0)
  check('una carta con la pagina non riceve anche i job "senza pagina"', di(1000010).length === 2, `${di(1000010).length}`)
  const anim = job(1030970, 'card_thumb_animated')
  check('l\'APNG incollato: un job animato raw con il suo URL', anim?.raw === true && anim.directUrl === APNG.split('?')[0])
  vale('...che chiede anche il File: (per sapere quanto pesa)', anim?.files, ['Card 1030970 thumb apng.png'])
  check('...la miniatura ferma ha l\'APNG come ripiego e non e\' quiet',
    job(1030970, 'card_thumb')?.directUrl === APNG.split('?')[0] && job(1030970, 'card_thumb')?.quiet === false)

  const soloAnim = cardJobs({ pages, ids, cardIds, still: false })
  vale('--only anim: niente convenzione ne\' immagini ferme', soloAnim.map((j) => j.kind), ['card_thumb_animated'])
  const soloThumb = cardJobs({ pages, ids, cardIds, arts: false })
  check('--only thumb: niente artwork', !soloThumb.some((j) => j.kind.startsWith('card_art')))

  const { todo, dropped } = selectJobs(jobs, ['cards/1034030/thumb.webp'], { missing: true })
  check('--missing: il job per convenzione con la riga si toglie', dropped === 1 && !todo.some((j) => j.keyBase === 'cards/1034030/thumb')
    && todo.some((j) => j.keyBase === 'cards/1034030/art'))
  vale('la convenzione e\' quella del wiki', [CONVENZIONE.thumb(1), CONVENZIONE.art(1)],
       [['Card 1 thumb.png'], ['Card 1 artwork.png', 'Card 1 bg.png']])
}

console.log('\nURL e nomi dei file')
{
  vale('fileFromUrl: l\'APNG di 1030970', fileFromUrl(APNG), 'Card 1030970 thumb apng.png')
  vale('fileFromUrl: anche dal nome vecchio della CDN (vignette)',
       fileFromUrl('https://vignette.wikia.nocookie.net/dbz-dokkanbattle/images/a/ab/Card_1_artwork_apng.png/revision/latest'),
       'Card 1 artwork apng.png')
  vale('fileFromUrl: le percentuali si decodificano', fileFromUrl('https://static.wikia.nocookie.net/dbz-dokkanbattle/images/a/ab/HQ%2B_x.png'), 'HQ+ x.png')
  vale('fileFromUrl: un altro host da\' null', fileFromUrl('https://evil.example/dbz-dokkanbattle/images/a/ab/Card_1_thumb.png'), null)
  vale('directUrlIn: la CDN del wiki, senza query string', directUrlIn(`x ${APNG} y`), APNG.split('?')[0])
  vale('directUrlIn: un altro host no', directUrlIn('https://imgur.com/a/Card_1_thumb.png'), null)
  vale('directUrlIn: nemmeno un host che finge', directUrlIn('https://static.wikia.nocookie.net.evil.example/dbz-dokkanbattle/images/a/ab/x.png'), null)
  vale('directUrlIn: http no', directUrlIn(APNG.replace('https:', 'http:')), null)
}

console.log('\nle risposte della CDN')
{
  vale('esitoHttp', [200, 204, 403, 404, 410, 408, 425, 429, 500, 502, 503, 504, 400, 401, 418].map(esitoHttp),
       ['ok', 'ok', 'sfida', 'assente', 'assente', 'transitorio', 'transitorio', 'transitorio', 'transitorio',
        'transitorio', 'transitorio', 'transitorio', 'errore', 'errore', 'errore'])
  vale('attesaRitento raddoppia da 1,6 s', [1, 2, 3, 4].map((n) => attesaRitento(n)), [1600, 3200, 6400, 12800])
  vale('...quattro ritenti dopo il primo tentativo', MAX_RITENTI, 4)
  vale('Retry-After in secondi, se piu\' lungo', attesaRitento(1, '30'), 30000)
  vale('Retry-After piu\' corto: vince l\'attesa nostra', attesaRitento(3, '1'), 6400)
  const ora = Date.parse('2026-10-10T10:00:00Z')
  vale('Retry-After come data HTTP', attesaRitento(1, 'Sat, 10 Oct 2026 10:00:20 GMT', ora), 20000)
  vale('mai oltre 60 s', [attesaRitento(1, '3600'), attesaRitento(9)], [60000, 60000])
  vale('Retry-After illeggibile: si ignora', attesaRitento(2, 'domani'), 3200)
}

console.log('\nda dove viene un asset (0033)')
{
  const base = 'https://static.wikia.nocookie.net/dbz-dokkanbattle/images/a/ab/Card_1_thumb.png/revision/latest'
  vale('un download: l\'URL del file, senza ridimensionamento ne\' query',
       provenienza({ scaricatoDa: `${base}/scale-to-width-down/256?format=webp` }), { source: 'wiki', source_url: base })
  vale('un download raw: com\'e\'', provenienza({ scaricatoDa: base }), { source: 'wiki', source_url: base })
  const voce = { key: 'cards/1/thumb.webp', source: 'wiki', source_url: base, checksum: 'abc' }
  vale('un file adottato con la voce del manifest e lo stesso checksum: il suo URL',
       provenienza({ voceManifest: voce, checksum: 'abc' }), { source: 'wiki', source_url: base })
  vale('checksum diverso: null', provenienza({ voceManifest: voce, checksum: 'xyz' }), { source: 'wiki', source_url: null })
  vale('senza manifesto: wiki e null', provenienza({ checksum: 'abc' }), { source: 'wiki', source_url: null })
  vale('un URL fuori dal wiki non diventa una provenienza', provenienza({ scaricatoDa: 'https://evil.example/x.png' }),
       { source: 'wiki', source_url: null })
  vale('urlDiOrigine: il dominio del wiki va bene', urlDiOrigine('https://dbz-dokkanbattle.fandom.com/wiki/File:X.png?x=1'),
       'https://dbz-dokkanbattle.fandom.com/wiki/File:X.png')
  vale('urlDiOrigine: http no', urlDiOrigine(base.replace('https:', 'http:')), null)
  // lo stesso controllo del vincolo asset_source_url_wiki
  const sql = readFileSync(fileURLToPath(new URL('../migrations/0033_asset_source.sql', import.meta.url)), 'utf8')
  const re = new RegExp(sql.match(/source_url ~ '([^']+)'/)[1])
  check('ogni URL che provenienza scrive passa il vincolo della 0033',
    [base, urlDiOrigine(base.replace('static.', 'vignette.')), urlDiOrigine('https://dbz-dokkanbattle.fandom.com/x')].every((u) => re.test(u)))
}

console.log('\ni limiti di spazio')
{
  vale('kindOfKey', ['cards/1/thumb.webp', 'cards/1/thumb-animated.png', 'cards/1/art.webp', 'cards/1/art-animated.webp',
                     'events/552139/banner.webp', 'icons/type/SAGL.webp', 'icons/rarity/LR-animated.png', 'icons/item/zeni.webp']
    .map(kindOfKey),
       ['card_thumb', 'card_thumb_animated', 'card_art', 'card_art_animated', 'event_banner', 'type_icon', 'rarity_icon', 'item_icon'])
  vale('kindOfKey: _headers e i file estranei no', ['_headers', 'cards/1/foo.webp', 'altro/x.png', 'cards/x/thumb.webp'].map(kindOfKey),
       [null, null, null, null])
  check('15.998 file + _headers: nessun avviso', !rapportoSpazio({ files: 15998 }).avviso)
  check('16.000 file: avviso (80%)', rapportoSpazio({ files: 16000 }).avviso && !rapportoSpazio({ files: 16000 }).rifiuto)
  check('19.999 file + _headers: ancora si pubblica', !rapportoSpazio({ files: 19999 }).rifiuto)
  check('20.000 file + _headers: rifiuto', rapportoSpazio({ files: 20000 }).rifiuto)
  check('un file da 26 MiB: rifiuto', rapportoSpazio({ files: 10, piuGrande: 26 * MiB }).rifiuto &&
    !rapportoSpazio({ files: 10, piuGrande: PAGES_MAX_FILE_BYTES }).rifiuto)
  vale('decisioneAnimato: 12 MiB esatti vanno bene', decisioneAnimato('card_art_animated', ANIM_ART_MAX_FILE, 0), 'ok')
  vale('...12 MiB + 1 byte no', decisioneAnimato('card_art_animated', ANIM_ART_MAX_FILE + 1, 0), 'oltre-il-tetto')
  vale('...oltre il budget di 1 GiB', decisioneAnimato('card_art_animated', 10 * MiB, ANIM_ART_BUDGET - 5 * MiB), 'oltre-il-budget')
  vale('...fino al budget si', decisioneAnimato('card_art_animated', 5 * MiB, ANIM_ART_BUDGET - 5 * MiB), 'ok')
  vale('...una miniatura animata oltre 1 MiB no', decisioneAnimato('card_thumb_animated', ANIM_THUMB_MAX_FILE + 1, 0), 'oltre-il-tetto')
  vale('...le immagini ferme sempre', ['card_art', 'card_thumb', 'event_banner'].map((k) => decisioneAnimato(k, 30 * MiB, 2 * ANIM_ART_BUDGET)),
       ['ok', 'ok', 'ok'])
  vale('...un peso che non si sa ancora: si guarda dopo il download', decisioneAnimato('card_art_animated', null, ANIM_ART_BUDGET), 'ok')
  const anim = (mib) => rapportoSpazio({ files: 6246, perTipo: { card_art_animated: { files: 170, bytes: mib * MiB } } }).anim
  check('animati a 678 MiB (oggi): niente avviso', !anim(678).avviso, `${anim(678).pct}%`)
  check('animati a 820 MiB: avviso', anim(820).avviso && !anim(820).pieno, `${anim(820).pct}%`)
  check('animati a 1 GiB: pieno', anim(1024).pieno)
  check('avvisiSpazio: vuoto oggi, una frase all\'80%', avvisiSpazio(rapportoSpazio({ files: 6246 })).length === 0 &&
    avvisiSpazio(rapportoSpazio({ files: 16500 })).length === 1)
}

// --------------------------------------------- le pagine vere, se ci sono
const CACHE = fileURLToPath(new URL('../import/.cache/wiki-cards.json', import.meta.url))
const dm = datamineCards()
if (existsSync(CACHE) && dm) {
  console.log('\nle pagine vere della cache')
  const { pages } = JSON.parse(readFileSync(CACHE, 'utf8'))
  const ids = assignCardIds(pages, dm, { now: new Date('2026-10-10T00:00:00Z') })
  // tutte le carte che hanno un id, piu' due solo del datamine
  const cardIds = new Set([...[...ids.values()].map((r) => r.id).filter(Boolean), 1034030, 1034130])
  const jobs = cardJobs({ pages, ids, cardIds })
  const job = (id, kind) => jobs.find((j) => j.card === id && j.kind === kind)
  // Le 19 carte con la pagina ma senza immagini: i nomi per convenzione
  // sono gia' fra i candidati, e le Metal Cooler hanno il loro file
  vale('1031920 (|ID, thumb vuoto): la miniatura per convenzione', job(1031920, 'card_thumb')?.files, ['Card 1031920 thumb.png'])
  check('1032010 e 1032550: l\'artwork per convenzione fra i candidati',
    [1032010, 1032550].every((id) => job(id, 'card_art')?.files.includes(`Card ${id} artwork.png`)))
  vale('Metal Cooler (INT) SR: prima il thumb dichiarato, poi la convenzione', job(1004610, 'card_thumb')?.files,
       ['Card 1003640 thumb INT.png', 'Card 1004610 thumb.png'])
  vale('...e l\'artwork dichiarato', job(1004610, 'card_art')?.files[0], 'SR Metal Cooler HD.png')
  check('la pagina abbozzata (1034150) ha i nomi per convenzione, quiet',
    job(1034150, 'card_thumb')?.files[0] === 'Card 1034150 thumb.png' && job(1034150, 'card_thumb')?.quiet === true)
  check('1034030 e 1034130, solo del datamine: miniatura e artwork per convenzione',
    [1034030, 1034130].every((id) => job(id, 'card_thumb')?.quiet && job(id, 'card_art')?.files.length === 2))
  const animati = jobs.filter((j) => j.kind.endsWith('_animated'))
  check('ogni job animato chiede il suo File: (il peso per il tetto)', animati.length > 100 &&
    animati.every((j) => j.files.length === 1 && /apng|\.webp$|\.gif$|\.png$/i.test(j.files[0])),
    `${animati.length} job, ${animati.filter((j) => j.files.length !== 1).length} senza nome`)
  const fuori = jobs.filter((j) => j.directUrl && !/^https:\/\/(static|vignette)\.wikia\.nocookie\.net\//.test(j.directUrl))
  check('nessun URL diretto fuori dalla CDN del wiki', fuori.length === 0, fuori.slice(0, 2).map((j) => j.directUrl).join(' '))
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
