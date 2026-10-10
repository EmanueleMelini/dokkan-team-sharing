// Quanto spazio prendono le immagini, e quanto ne possono prendere.
// Puro, per i test: lo usano fetch-assets (il tetto degli animati),
// db/prod/storage.mjs (il riepilogo e la guardia del deploy della CI) e
// scripts/assets-deploy.mjs (il deploy dal Mac).
//
// I limiti di Cloudflare Pages Free sono per deploy: 20.000 file e 25 MiB
// per file. Un deploy oltre fallisce a meta', quindi ci si ferma prima.
//
// Gli artwork animati si tengono (decisione del proprietario), ma con un
// tetto per file e un budget in tutto. Misurati su dokkan_dev il
// 2026-10-10: 170 righe, 678 MiB (88 collegate, 673 MiB; 82 fotogrammi
// appiattiti scollegati, 4,6 MiB). Il piu' grande 9,97 MiB, p99 10,4 MB,
// media 8 MB. Da qui:
//   - tetto per file 12 MiB: il 20% sopra il piu' grande di oggi, meta' dei
//     25 MiB di Pages. Un file oltre si salta: l'artwork fermo resta;
//   - budget 1 GiB: oggi al 66%, l'avviso all'80% (819 MiB) lascia posto a
//     una ventina di animazioni (dal 2021 ne sono uscite 9-25 l'anno);
//   - miniature animate 1 MiB: nessuna pagina le legge (thumb_animated_key),
//     e i veri APNG del wiki pesano 5 MB l'una. Senza tetto un
//     "--only anim --force" ne riscaricherebbe 850 MB.
// Per cambiarli si cambiano qui: valgono per CI, Mac e test insieme.

const MiB = 1024 * 1024

export const PAGES_MAX_FILES = 20000
export const PAGES_MAX_FILE_BYTES = 25 * MiB
export const AVVISO_PCT = 80
export const ANIM_ART_MAX_FILE = 12 * MiB
export const ANIM_ART_BUDGET = 1024 * MiB
export const ANIM_THUMB_MAX_FILE = 1 * MiB

/**
 * Il kind di asset (0004, 0006) di una chiave dell'albero, null se non e'
 * una chiave che fetch-assets scrive (_headers, file estranei).
 * @param {string} key
 */
export function kindOfKey(key) {
  const k = String(key ?? '').replace(/^\/+/, '')
  let m = k.match(/^cards\/\d+\/(thumb|thumb-animated|art|art-animated)\.[a-z0-9]+$/i)
  if (m) return { thumb: 'card_thumb', 'thumb-animated': 'card_thumb_animated', art: 'card_art', 'art-animated': 'card_art_animated' }[m[1]]
  if (/^events\/\d+\/banner\.[a-z0-9]+$/i.test(k)) return 'event_banner'
  m = k.match(/^icons\/(type|rarity|item)\/[^/]+$/)
  if (m) return `${m[1]}_icon`
  return null
}

/**
 * Se un file animato si puo' tenere. size null = non si sa ancora (si
 * riguarda dopo il download); totale = i byte di card_art_animated gia'
 * in tabella, senza questo file.
 * @param {string} kind
 * @param {number | null} size
 * @param {number} [totale]
 * @returns {'ok' | 'oltre-il-tetto' | 'oltre-il-budget'}
 */
export function decisioneAnimato(kind, size, totale = 0) {
  if (size == null) return 'ok'
  if (kind === 'card_art_animated') {
    if (size > ANIM_ART_MAX_FILE) return 'oltre-il-tetto'
    if (totale + size > ANIM_ART_BUDGET) return 'oltre-il-budget'
    return 'ok'
  }
  if (kind === 'card_thumb_animated' && size > ANIM_THUMB_MAX_FILE) return 'oltre-il-tetto'
  return 'ok'
}

const pct = (n, max) => Math.round((n / max) * 1000) / 10

/**
 * Il quadro dello spazio: file contro il tetto di Pages, e artwork
 * animati contro il loro budget.
 *
 * files: i file degli asset, _headers escluso (lo si conta qui: c'e' in
 * ogni deploy). perTipo: kind -> { files, bytes }. piuGrande: il file piu'
 * grande, in byte.
 * @param {{ files: number, perTipo?: Record<string, { files: number, bytes: number }>, piuGrande?: number }} x
 */
export function rapportoSpazio({ files, perTipo = {}, piuGrande = 0 }) {
  const totale = files + 1
  const anim = perTipo.card_art_animated?.bytes ?? 0
  const righe = Object.entries(perTipo)
    .map(([kind, v]) => ({ kind, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.kind.localeCompare(b.kind))
  return {
    files: totale,
    filesPct: pct(totale, PAGES_MAX_FILES),
    avviso: totale >= PAGES_MAX_FILES * AVVISO_PCT / 100,
    rifiuto: totale > PAGES_MAX_FILES || piuGrande > PAGES_MAX_FILE_BYTES,
    troppoGrande: piuGrande > PAGES_MAX_FILE_BYTES,
    anim: {
      bytes: anim,
      pct: pct(anim, ANIM_ART_BUDGET),
      avviso: anim >= ANIM_ART_BUDGET * AVVISO_PCT / 100,
      pieno: anim >= ANIM_ART_BUDGET,
    },
    righe,
  }
}

export const mib = (b) => (b / MiB).toFixed(1)

/**
 * Il riepilogo in markdown (### Storage), lo stesso per la CI e il Mac.
 * @param {ReturnType<typeof rapportoSpazio>} r
 */
export function spazioMarkdown(r, titolo = 'Storage') {
  const out = [`### ${titolo}`, '', '| Kind | Files | MiB |', '|---|---:|---:|']
  for (const x of r.righe) out.push(`| ${x.kind} | ${x.files} | ${mib(x.bytes)} |`)
  out.push('', `Files: ${r.files} of ${PAGES_MAX_FILES} per Pages deploy (${r.filesPct}%, warning at ${AVVISO_PCT}%), _headers included.`)
  out.push(`Animated art: ${mib(r.anim.bytes)} MiB of the ${mib(ANIM_ART_BUDGET)} MiB budget (${r.anim.pct}%);` +
           ` files over ${mib(ANIM_ART_MAX_FILE)} MiB are skipped, the still art stays.`)
  out.push('')
  return out.join('\n')
}

/**
 * Le frasi da mettere fra le cose da guardare: vuoto se va tutto bene.
 * @param {ReturnType<typeof rapportoSpazio>} r
 */
export function avvisiSpazio(r) {
  const out = []
  if (r.rifiuto) {
    out.push(r.troppoGrande ? `a file is over ${mib(PAGES_MAX_FILE_BYTES)} MiB: Cloudflare Pages refuses the deploy`
      : `${r.files} files: over the ${PAGES_MAX_FILES} Cloudflare Pages allows in a deploy`)
  } else if (r.avviso) out.push(`${r.files} files: ${r.filesPct}% of the ${PAGES_MAX_FILES} a Pages deploy allows`)
  if (r.anim.pieno) out.push(`animated art at ${mib(r.anim.bytes)} MiB: the ${mib(ANIM_ART_BUDGET)} MiB budget is full, new animations are skipped`)
  else if (r.anim.avviso) out.push(`animated art at ${mib(r.anim.bytes)} MiB: ${r.anim.pct}% of the ${mib(ANIM_ART_BUDGET)} MiB budget`)
  return out
}
