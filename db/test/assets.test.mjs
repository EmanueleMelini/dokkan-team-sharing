// Le immagini, lato puro: quali job fa fetch-assets per ogni carta (anche
// senza pagina wiki, db/import/asset-jobs.mjs), cosa vuol dire una
// risposta della CDN e quanto si aspetta prima di ritentare, da dove viene
// un asset (0033), i limiti di spazio (db/import/asset-limits.mjs), e la
// cornice delle miniature (0034): il job thumb-framed, quale delle due va
// in card.thumb_key, e come si riconosce il solo personaggio
// (db/import/asset-cornice.mjs) sulle maschere alfa di
// db/test/fixture/cornici e, se c'e' ffmpeg, su immagini fatte qui.
//
// Funzioni pure, niente database ne' rete. In fondo le pagine vere della
// cache, se c'e', per i casi che hanno fatto nascere il lavoro.
//
//   node db/test/assets.test.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONVENZIONE, cardJobs, cartaDellaFerma, collegaMiniature, directUrlIn, fileFromUrl, miniaturaVincente,
} from '../import/asset-jobs.mjs'
import { CORNICE, cornice, misuraCornice, senzaCornice } from '../import/asset-cornice.mjs'
import {
  ANIM_ART_BUDGET, ANIM_ART_MAX_FILE, ANIM_THUMB_MAX_FILE, PAGES_MAX_FILE_BYTES, avvisiSpazio, decisioneAnimato,
  kindOfKey, rapportoSpazio,
} from '../import/asset-limits.mjs'
import { MAX_RITENTI, attesaRitento, esitoHttp, keyIndex, provenienza, selectJobs, urlDiOrigine } from '../import/asset-select.mjs'
import { assignCardIds, datamineCards, lineField } from '../import/wiki-card.mjs'

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
  // 0034: senza un |thumb ferma l'APNG e' della miniatura con la cornice
  const ferma = jobs.find((j) => j.card === 1030970 && j.keyBase === 'cards/1030970/thumb')
  const framed = jobs.find((j) => j.card === 1030970 && j.keyBase === 'cards/1030970/thumb-framed')
  check('...e senza |thumb ferma: la miniatura con la cornice, card_thumb, dall\'APNG, non quiet',
    framed?.kind === 'card_thumb' && framed.col === 'thumb_key' && framed.cornice === true &&
    framed.directUrl === APNG.split('?')[0] && framed.quiet === false && !framed.raw, JSON.stringify(framed))
  vale('...che chiede il File: dell\'APNG (qui e\' gia\' il nome per convenzione)', framed?.files, ['Card 1030970 thumb apng.png'])
  check('...e la ferma non usa piu\' l\'APNG come ripiego, ed e\' quiet (nessun file dichiarato)',
    ferma?.directUrl === null && ferma.quiet === true && JSON.stringify(ferma.files) === '["Card 1030970 thumb.png"]')

  const soloAnim = cardJobs({ pages, ids, cardIds, still: false })
  vale('--only anim: niente convenzione ne\' immagini ferme (nemmeno la cornice)', soloAnim.map((j) => j.kind), ['card_thumb_animated'])
  const soloThumb = cardJobs({ pages, ids, cardIds, arts: false })
  check('--only thumb: niente artwork', !soloThumb.some((j) => j.kind.startsWith('card_art')))

  const { todo, dropped } = selectJobs(jobs, ['cards/1034030/thumb.webp'], { missing: true })
  check('--missing: il job per convenzione con la riga si toglie', dropped === 1 && !todo.some((j) => j.keyBase === 'cards/1034030/thumb')
    && todo.some((j) => j.keyBase === 'cards/1034030/art'))
  vale('la convenzione e\' quella del wiki', [CONVENZIONE.thumb(1), CONVENZIONE.thumbApng(1), CONVENZIONE.art(1)],
       [['Card 1 thumb.png'], ['Card 1 thumb apng.png'], ['Card 1 artwork.png', 'Card 1 bg.png']])
}

console.log('\nla miniatura con la cornice (0034)')
{
  const DAIMA = 'https://static.wikia.nocookie.net/dbz-dokkanbattle/images/6/65/LRSTRDaimaSSJ4Goku.png/revision/latest?cb=20260130021933'
  const pages = [
    // LR con l'APNG sotto un altro nome, nessun |thumb
    pagina(11, { thumb: '', 'thumb apng': DAIMA, rarity: 'LR' }),
    // un |thumb dichiarato e l'APNG: niente cornice
    pagina(12, { thumb: '[[File:LRTEQBeastGohan.png|120px]]', 'thumb apng': APNG, rarity: 'LR' }),
    // LR con il template ThumbLR (gli strati del wiki) e niente APNG
    pagina(13, { thumb: '{{ThumbLR|INT Buu|120}}', 'thumb apng': '', rarity: 'LR' }),
    // una UR con il suo |thumb, misurato nudo (spoglie)
    pagina(14, { thumb: '[[File:Card 1014010 thumb.png|120px]]', rarity: 'UR' }),
    // una SSR senza niente: solo la convenzione, come prima
    pagina(15, { thumb: '', rarity: 'SSR' }),
  ]
  const ids = new Map([[11, { id: 1032550 }], [12, { id: 1032580 }], [13, { id: 1031720 }], [14, { id: 1014010 }], [15, { id: 1000020 }]])
  // 1032710: LR senza pagina; 1030010: UR senza pagina
  const cardIds = new Set([1032550, 1032580, 1031720, 1014010, 1000020, 1032710, 1030010])
  const rarity = new Map([[1032550, 'LR'], [1032580, 'LR'], [1031720, 'LR'], [1014010, 'UR'], [1000020, 'SSR'], [1032710, 'LR'], [1030010, 'UR']])
  const jobs = cardJobs({ pages, ids, cardIds, rarity, spoglie: new Set([1014010]), arts: false })
  const fr = (id) => jobs.find((j) => j.keyBase === `cards/${id}/thumb-framed`)
  const fe = (id) => jobs.find((j) => j.keyBase === `cards/${id}/thumb`)
  vale('l\'APNG della pagina prima, poi il nome per convenzione', fr(1032550)?.files, ['LRSTRDaimaSSJ4Goku.png', 'Card 1032550 thumb apng.png'])
  check('...con l\'URL della pagina come ripiego, non quiet', fr(1032550)?.directUrl === DAIMA.split('?')[0] && fr(1032550)?.quiet === false)
  check('un |thumb dichiarato e l\'APNG: nessuna cornice, la ferma tiene l\'APNG come ripiego',
    !fr(1032580) && fe(1032580)?.directUrl === APNG.split('?')[0] && fe(1032580)?.files[0] === 'LRTEQBeastGohan.png')
  vale('una LR con {{ThumbLR}}: la cornice per convenzione, quiet', [fr(1031720)?.files, fr(1031720)?.quiet, fr(1031720)?.directUrl],
       [['Card 1031720 thumb apng.png'], true, null])
  check('...e la ferma resta, per convenzione, quiet', fe(1031720)?.quiet === true && fe(1031720)?.directUrl === null)
  vale('una UR il cui |thumb e\' misurato nudo: anche lei la cornice, per convenzione', fr(1014010)?.files, ['Card 1014010 thumb apng.png'])
  check('...ma il file dichiarato resta il primo della ferma, e avvisa se sparisce',
    fe(1014010)?.files[0] === 'Card 1014010 thumb.png' && fe(1014010)?.quiet === false)
  check('una SSR senza niente: nessuna cornice', !fr(1000020) && !!fe(1000020))
  vale('una LR senza pagina: la cornice per convenzione, quiet', [fr(1032710)?.files, fr(1032710)?.quiet], [['Card 1032710 thumb apng.png'], true])
  check('una UR senza pagina: no', !fr(1030010) && !!fe(1030010))
  check('ogni job con la cornice (quattro): card_thumb, colonna thumb_key, mai raw', jobs.filter((j) => j.cornice).length === 4 &&
    jobs.filter((j) => j.cornice).every((j) => j.kind === 'card_thumb' && j.col === 'thumb_key' && !j.raw))
  check('--only anim: nessuna cornice', !cardJobs({ pages, ids, cardIds, rarity, still: false }).some((j) => j.cornice))
  check('--only art: nessuna cornice', !cardJobs({ pages, ids, cardIds, rarity, thumbs: false }).some((j) => j.cornice))
  check('senza la rarita\' (come prima): la cornice solo per chi ha l\'APNG',
    cardJobs({ pages, ids, cardIds, arts: false }).filter((j) => j.cornice).map((j) => j.card).join() === '1032550')

  // le chiavi: thumb e thumb-framed non si prendono la riga a vicenda
  const idx = keyIndex(['cards/1/thumb-framed.webp', 'cards/2/thumb.webp'])
  vale('keyIndex: thumb-framed non e\' thumb, e viceversa', [idx.get('cards/1/thumb'), idx.get('cards/1/thumb-framed'),
    idx.get('cards/2/thumb'), idx.get('cards/2/thumb-framed')], [undefined, 'cards/1/thumb-framed.webp', 'cards/2/thumb.webp', undefined])
  const sel = selectJobs([{ keyBase: 'cards/1/thumb' }, { keyBase: 'cards/1/thumb-framed' }], ['cards/1/thumb.webp'], { missing: true })
  check('--missing: con la sola ferma in tabella la cornice resta da fare', sel.dropped === 1 &&
    sel.todo.map((j) => j.keyBase).join() === 'cards/1/thumb-framed')
  vale('cartaDellaFerma: solo cards/<id>/thumb.<ext>', ['cards/12/thumb.webp', 'cards/12/thumb-framed.webp', 'cards/x/thumb.webp',
    'cards/12/art.webp'].map(cartaDellaFerma), [12, null, null, null])
}

console.log('\nquale miniatura va in card.thumb_key')
{
  const F = (frame) => ({ key: 'cards/1/thumb-framed.webp', frame })
  const A = (frame) => ({ key: 'cards/1/thumb.webp', frame })
  vale('la cornice incorniciata vince', miniaturaVincente({ ferma: A(false), cornice: F(true) })?.key, 'cards/1/thumb-framed.webp')
  vale('...anche non misurata (null)', miniaturaVincente({ ferma: A(false), cornice: F(null) })?.key, 'cards/1/thumb-framed.webp')
  vale('...anche contro una ferma incorniciata', miniaturaVincente({ ferma: A(true), cornice: F(true) })?.key, 'cards/1/thumb-framed.webp')
  vale('la cornice misurata nuda perde contro la ferma', miniaturaVincente({ ferma: A(true), cornice: F(false) })?.key, 'cards/1/thumb.webp')
  vale('...ma senza ferma resta lei', miniaturaVincente({ cornice: F(false) })?.key, 'cards/1/thumb-framed.webp')
  vale('solo la ferma: la ferma', miniaturaVincente({ ferma: A(false) })?.key, 'cards/1/thumb.webp')
  vale('nessuna: null', miniaturaVincente({}), null)

  const jobs = [
    { keyBase: 'cards/1/thumb', card: 1, col: 'thumb_key' }, { keyBase: 'cards/1/thumb-framed', card: 1, col: 'thumb_key', cornice: true },
    { keyBase: 'cards/2/thumb', card: 2, col: 'thumb_key' }, { keyBase: 'cards/2/thumb-framed', card: 2, col: 'thumb_key', cornice: true },
    { keyBase: 'cards/3/thumb', card: 3, col: 'thumb_key' }, { keyBase: 'cards/3/thumb-framed', card: 3, col: 'thumb_key', cornice: true },
    { keyBase: 'cards/4/thumb', card: 4, col: 'thumb_key' },
    { keyBase: 'cards/5/thumb', card: 5, col: 'thumb_key' }, { keyBase: 'cards/5/thumb-framed', card: 5, col: 'thumb_key', cornice: true },
    { keyBase: 'cards/1/art', card: 1, col: 'art_key' },
  ]
  // la riparazione con --missing: le ferme nude hanno gia' la riga (0034),
  // le cornici sono appena scaricate. 3: la cornice scaricata e' nuda anche
  // lei; 4: la cornice non e' chiesta (c'e' la riga di un giro vecchio);
  // 5: niente in questo giro
  const have = new Map([
    ['cards/1/thumb.webp', { frame: false }], ['cards/2/thumb.webp', { frame: false }], ['cards/3/thumb.webp', { frame: true }],
    ['cards/4/thumb.webp', { frame: false }], ['cards/4/thumb-framed.webp', { frame: true }],
    ['cards/5/thumb.webp', { frame: false }], ['cards/5/thumb-framed.webp', { frame: true }],
  ])
  const results = [
    { keyBase: 'cards/1/thumb-framed', col: 'thumb_key', key: 'cards/1/thumb-framed.webp', frame: true },
    { keyBase: 'cards/2/thumb-framed', col: 'thumb_key', key: 'cards/2/thumb-framed.webp', frame: null },
    { keyBase: 'cards/3/thumb-framed', col: 'thumb_key', key: 'cards/3/thumb-framed.webp', frame: false },
    { keyBase: 'cards/4/thumb', col: 'thumb_key', key: 'cards/4/thumb.webp' },
    { keyBase: 'cards/1/art', col: 'art_key', key: 'cards/1/art.webp' },
  ]
  const m = collegaMiniature({ jobs, results, have })
  vale('--missing: la ferma dalla riga in tabella, la cornice dal risultato', m.coppie,
       [[1, 'cards/1/thumb-framed.webp'], [2, 'cards/2/thumb-framed.webp'], [3, 'cards/3/thumb.webp'], [4, 'cards/4/thumb.webp']])
  vale('...contate: 2 con la cornice, 1 ancora nuda (la 4, senza job della cornice)', [m.conCornice, m.nude], [2, 1])
  // --offline in produzione: tutte le righe tenute, nessun frame nei risultati
  const kept = jobs.filter((j) => j.col === 'thumb_key').map((j) => ({ ...j, key: [...have.keys()].find((k) => k.startsWith(j.keyBase + '.')) }))
    .filter((j) => j.key)
  vale('--offline: le stesse scelte dalle righe in tabella', collegaMiniature({ jobs, results: kept, have }).coppie,
       [[1, 'cards/1/thumb.webp'], [2, 'cards/2/thumb.webp'], [3, 'cards/3/thumb.webp'], [4, 'cards/4/thumb.webp'], [5, 'cards/5/thumb-framed.webp']])
  vale('nessun risultato: nessun collegamento', collegaMiniature({ jobs, results: [], have }).coppie, [])
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
                     'events/552139/banner.webp', 'icons/type/SAGL.webp', 'icons/rarity/LR-animated.png', 'icons/item/zeni.webp',
                     'cards/1/thumb-framed.webp']
    .map(kindOfKey),
       ['card_thumb', 'card_thumb_animated', 'card_art', 'card_art_animated', 'event_banner', 'type_icon', 'rarity_icon', 'item_icon',
        'card_thumb'])
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

console.log('\nla cornice dai pixel (asset-cornice.mjs)')
{
  vale('le soglie e la striscia, fissate', CORNICE,
       { lato: 64, striscia: { x0: 0.3, x1: 0.7, y0: 0.86, y1: 0.92 }, sogliaStriscia: 0.5, sogliaCopertura: 0.55 })
  const L = CORNICE.lato
  // Le maschere alfa vere, 64x64 (PGM P5: solo la sagoma, niente immagini
  // del gioco nel repository), fatte con:
  //   ffmpeg -i <miniatura> -frames:v 1 -vf "scale=64:64:flags=area,format=rgba,alphaextract,format=gray" -c:v pgm <nome>.pgm
  // spoglia-*: il personaggio nudo ("Card <id> thumb.png" di una LR, una con
  // la pagina e l'APNG, una con {{ThumbLR}}); cornice-1000010: una SSR
  // 256x224; cornice-apng-1024930: il primo fotogramma dell'APNG con la
  // cornice della stessa LR di spoglia-1024930.
  const TESTA = 'P5\n64 64\n255\n'
  const pgm = (nome) => {
    const b = readFileSync(fileURLToPath(new URL(`./fixture/cornici/${nome}.pgm`, import.meta.url)))
    if (b.toString('latin1', 0, TESTA.length) !== TESTA || b.length !== TESTA.length + L * L) throw new Error(`${nome}.pgm non e' una maschera 64x64`)
    return new Uint8Array(b.subarray(TESTA.length))
  }
  for (const [nome, striscia, copertura, conCornice] of [['spoglia-1024930', 0, 0.281, false], ['spoglia-1031720', 0, 0.284, false],
    ['cornice-1000010', 1, 0.714, true], ['cornice-apng-1024930', 0.825, 0.602, true]]) {
    const m = misuraCornice(pgm(nome))
    check(`${nome}: striscia ${striscia}, copertura ${copertura}, ${conCornice ? 'con la cornice' : 'nuda'}`,
      Math.abs(m.striscia - striscia) < 0.001 && Math.abs(m.copertura - copertura) < 0.001 && senzaCornice(m) === !conCornice,
      `${m.striscia.toFixed(3)} ${m.copertura.toFixed(3)}`)
  }
  const maschera = (pieno) => {
    const a = new Uint8Array(L * L)
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) a[y * L + x] = pieno(x, y) ? 255 : 0
    return a
  }
  // la cornice del gioco e' alta in basso (la barra del nome): un anello di 10 px
  const anello = maschera((x, y) => x < 10 || x >= L - 10 || y < 10 || y >= L - 10)
  // un personaggio scontornato, che non arriva al fondo
  const sagoma = maschera((x, y) => (x - 32) ** 2 + (y - 28) ** 2 < 20 ** 2)
  vale('tutta trasparente: nuda; tutta piena: incorniciata', [senzaCornice(misuraCornice(maschera(() => false))),
    senzaCornice(misuraCornice(maschera(() => true)))], [true, false])
  vale('un anello opaco col centro trasparente: incorniciata', senzaCornice(misuraCornice(anello)), false)
  vale('una sagoma al centro, la striscia in basso vuota: nuda', senzaCornice(misuraCornice(sagoma)), true)
  // le due soglie insieme: una sola non basta a dire nuda
  vale('la striscia vuota ma il riquadro quasi pieno: incorniciata',
    senzaCornice(misuraCornice(maschera((x, y) => !(y >= 50 && x >= 16 && x < 48)))), false)
  vale('la sola barra in basso, piena: incorniciata', senzaCornice(misuraCornice(maschera((x, y) => y >= 54 && y < 60))), false)
  let rotta = false
  try { misuraCornice(new Uint8Array(10)) } catch { rotta = true }
  check('una maschera della misura sbagliata: errore, non una misura a caso', rotta)

  // cornice() vera, con ffmpeg, su immagini fatte qui dalle stesse maschere
  let ffmpeg = true
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { ffmpeg = false }
  if (!ffmpeg) console.log('  (ffmpeg non c\'e\': salto le prove di cornice() sui file)')
  else {
    const dir = mkdtempSync(join(tmpdir(), 'dts-cornice-test-'))
    try {
      // RGBA con un colore qualsiasi e l'alfa della maschera; piu' maschere
      // sono piu' fotogrammi
      const raw = (...alfe) => {
        const b = Buffer.alloc(L * L * 4 * alfe.length)
        alfe.forEach((alfa, f) => alfa.forEach((v, i) => b.set([200, 120, 40, v], (f * L * L + i) * 4)))
        return b
      }
      const fai = (nome, args, ...alfe) => {
        const r = join(dir, `${nome}.raw`), out = join(dir, nome)
        writeFileSync(r, raw(...alfe))
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${L}x${L}`, '-framerate', '2',
          '-i', r, ...args, out], { stdio: 'pipe' })
        return readFileSync(out)
      }
      const FORMATI = [['png', ['-frames:v', '1', '-c:v', 'png', '-f', 'image2']], ['webp', ['-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1']]]
      for (const [fmt, args] of FORMATI) {
        let nuda, conCornice
        try { nuda = fai(`sagoma.${fmt}`, args, sagoma); conCornice = fai(`anello.${fmt}`, args, anello) } catch (err) {
          console.log(`  (ffmpeg non sa scrivere ${fmt}: salto, ${String(err.message).split('\n')[0]})`); continue
        }
        vale(`${fmt}: la sagoma e' nuda (false), l'anello ha la cornice (true)`, [cornice(nuda), cornice(conCornice)], [false, true])
      }
      try {
        // un APNG di due fotogrammi: conta il primo, come per l'appiattimento
        const apng = fai('due.png', ['-c:v', 'apng', '-plays', '0', '-f', 'apng'], anello, sagoma)
        vale('APNG: si misura il primo fotogramma (l\'anello)', cornice(apng), true)
        const rovescio = fai('rovescio.png', ['-c:v', 'apng', '-plays', '0', '-f', 'apng'], sagoma, anello)
        vale('...e al rovescio la sagoma', cornice(rovescio), false)
      } catch (err) { console.log(`  (ffmpeg non sa scrivere APNG: salto, ${String(err.message).split('\n')[0]})`) }
      vale('byte che non sono un\'immagine: null (vale come incorniciata)', cornice(Buffer.from('non e\' un\'immagine')), null)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
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

  // 0034: le miniature con la cornice delle LR, con la rarita' come la scrive
  // la pagina (le due solo del datamine: dal datamine)
  const RAR = ['N', 'R', 'SR', 'SSR', 'UR', 'LR']
  const rarity = new Map()
  for (const p of pages) { const id = ids.get(p.pageid)?.id; if (id) rarity.set(id, (lineField(p.wikitext, 'rarity') ?? '').toUpperCase()) }
  for (const id of [1034030, 1034130]) rarity.set(id, RAR[Number(dm.get(String(id))?.rarity)])
  const conCornice = cardJobs({ pages, ids, cardIds, rarity, arts: false }).filter((j) => j.cornice)
  const fr = (id) => conCornice.find((j) => j.card === id)
  const dallApng = conCornice.filter((j) => j.directUrl)
  check('le pagine con |thumb apng e senza |thumb: una cornice ciascuna, dall\'APNG (172 il 2026-10-13)', dallApng.length >= 170 &&
    dallApng.every((j) => j.quiet === false && j.files[0] === fileFromUrl(j.directUrl)), `${dallApng.length}`)
  check('...quasi tutte col nome per convenzione (171 su 172)',
    dallApng.filter((j) => j.files[0] === CONVENZIONE.thumbApng(j.card)[0]).length >= dallApng.length - 3)
  vale('1024930 (Metal Cooler LR, |thumb vuoto): l\'APNG della pagina', [fr(1024930)?.files, fr(1024930)?.keyBase],
       [['Card 1024930 thumb apng.png'], 'cards/1024930/thumb-framed'])
  vale('1032550 (Goku SSJ4 DAIMA): l\'APNG col suo nome, poi la convenzione', fr(1032550)?.files,
       ['LRSTRDaimaSSJ4Goku.png', 'Card 1032550 thumb apng.png'])
  check('1031720 ({{ThumbLR}}, niente APNG): la cornice per convenzione, quiet',
    fr(1031720)?.quiet === true && fr(1031720)?.files.join() === 'Card 1031720 thumb apng.png')
  check('1034030 (LR solo del datamine): la cornice per convenzione, quiet', fr(1034030)?.quiet === true && !fr(1034030)?.directUrl)
  check('le quattro LR con un |thumb dichiarato (incorniciato): nessuna cornice',
    [1032580, 1033940, 1034340, 1034380].every((id) => rarity.get(id) === 'LR' && !fr(id)))
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
