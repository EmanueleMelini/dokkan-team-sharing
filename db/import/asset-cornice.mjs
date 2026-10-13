// Se la miniatura di una carta ha la cornice del gioco o e' il solo
// personaggio (lo "strato nudo"): asset.frame (0034).
//
// Sul wiki la miniatura di una LR non e' un file: Module:Thumb la compone
// nel browser a strati, e "Card <id> thumb.png" e' solo il personaggio, su
// fondo trasparente. Il nome non basta a dirlo (un file caricato domani con
// quel nome potrebbe avere la cornice), e nemmeno la misura (le miniature
// nuove con la cornice sono 255x255, alcune animate 120x120): si guardano i
// pixel, con ffmpeg, che fetch-assets usa gia' per appiattire gli animati.
//
// La regola, sull'alfa del primo fotogramma ridotto a 64x64 (flags=area):
//   striscia   l'alfa medio (0-1) della striscia in basso della cornice,
//              x dal 30 al 70%, y dall'86 al 92%: a 64 px le colonne 19-44
//              e le righe 55-58. Nella cornice del gioco li' c'e' la barra
//              del nome, piena; sotto un personaggio scontornato e' vuota;
//   copertura  la parte del riquadro con alfa >= 128.
// Nuda quando striscia < 0,5 E copertura < 0,55; altrimenti incorniciata.
//
// Misurata il 2026-10-13 sulle 2632 miniature collegate di dokkan_dev, con
// questa stessa riduzione: le 179 nude hanno striscia 0,000 e copertura
// 0,264-0,462; le 2453 incorniciate striscia 1,000 e copertura da 0,650
// (p01 0,689); i 171 fotogrammi incorniciati degli APNG striscia 0,797-1,000
// e copertura 0,600-0,697. 179 nude trovate, nessun falso, nessuna mancata.
// Ognuna delle due misure da sola separa gia'; le due insieme vogliono due
// sbagli indipendenti per disegnare una cornice doppia su una carta che
// l'ha gia', mentre una nuda non vista resta solo com'era prima.
//
// null quando ffmpeg non legge il file (1 su 2632 con ffmpeg 8): vale come
// incorniciata, niente cornice disegnata. Le funzioni pure (misuraCornice,
// senzaCornice) le prova db/test/assets.test.mjs sulle maschere alfa di
// db/test/fixture/cornici, senza ffmpeg.
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const CORNICE = Object.freeze({
  lato: 64,
  striscia: Object.freeze({ x0: 0.30, x1: 0.70, y0: 0.86, y1: 0.92 }),
  sogliaStriscia: 0.5,
  sogliaCopertura: 0.55,
})

/**
 * Le due misure di una maschera alfa quadrata.
 * @param {Uint8Array} alfa lato*lato valori 0-255, per righe
 * @param {number} [lato]
 * @returns {{ striscia: number, copertura: number }}
 */
export function misuraCornice(alfa, lato = CORNICE.lato) {
  if (alfa.length !== lato * lato) throw new Error(`maschera di ${alfa.length} valori, ne servono ${lato * lato}`)
  const { x0, x1, y0, y1 } = CORNICE.striscia
  let somma = 0, n = 0
  for (let y = Math.floor(y0 * lato); y < Math.ceil(y1 * lato); y++) {
    for (let x = Math.floor(x0 * lato); x < Math.ceil(x1 * lato); x++) { somma += alfa[y * lato + x]; n++ }
  }
  let pieni = 0
  for (const v of alfa) if (v >= 128) pieni++
  return { striscia: somma / n / 255, copertura: pieni / alfa.length }
}

/** Nuda (il solo personaggio) secondo le due soglie. */
export const senzaCornice = (/** @type {{ striscia: number, copertura: number }} */ m) =>
  m.striscia < CORNICE.sogliaStriscia && m.copertura < CORNICE.sogliaCopertura

/**
 * L'alfa del primo fotogramma a 64x64, con ffmpeg; null se non lo legge.
 * Da un file temporaneo come flatten() in fetch-assets: certi formati
 * (APNG, WebP animato) ffmpeg non li legge da una pipe.
 * @param {Buffer} buf
 * @returns {Uint8Array | null}
 */
export function alfa64(buf) {
  const L = CORNICE.lato
  const src = join(tmpdir(), `dts-cornice-${process.pid}-${Math.random().toString(36).slice(2)}`)
  try {
    writeFileSync(src, buf)
    const rgba = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-frames:v', '1',
      '-vf', `scale=${L}:${L}:flags=area,format=rgba`, '-f', 'rawvideo', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 20 })
    if (rgba.length !== L * L * 4) return null
    const alfa = new Uint8Array(L * L)
    for (let i = 0; i < alfa.length; i++) alfa[i] = rgba[i * 4 + 3]
    return alfa
  } catch {
    return null
  } finally {
    try { rmSync(src) } catch { /* non c'era */ }
  }
}

/**
 * asset.frame di un file: true con la cornice, false il solo personaggio,
 * null se ffmpeg non lo legge.
 * @param {Buffer} buf
 * @returns {boolean | null}
 */
export function cornice(buf) {
  const alfa = alfa64(buf)
  return alfa ? !senzaCornice(misuraCornice(alfa)) : null
}
