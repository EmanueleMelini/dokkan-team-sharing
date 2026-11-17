// L'icona dell'app Android (android/app/src/main/res/: drawable/
// ic_launcher_foreground.xml e ic_launcher_monochrome.xml, mipmap-anydpi/
// ic_launcher.xml, values/ic_launcher_background.xml) e la sua bolla
// (drawable/ic_bubble_foreground.xml) contro il marchio del sito e il
// generatore (scripts/brand/icona-android.mjs). Funzioni pure e file letti,
// niente database, niente Gradle.
//
//   - i file nel repository sono byte per byte quelli che il generatore
//     scriverebbe adesso dalla maskable.svg: se cambia il marchio questo resta
//     rosso finche' l'icona non si rigenera (npm run brand, o node
//     scripts/brand/icona-android.mjs da solo);
//   - senza passare dal generatore: i cinque `d` dei settori sono quelli di
//     components/brand/marchio.tsx, nello stesso ordine; i colori quelli della
//     variante scura di app/globals.css (--marchio-1..5 i settori, --marchio-0
//     lente e manico), il fondo quello della maskable della PWA; il livello
//     monocromo ha le stesse forme in un colore solo; l'adaptive icon punta ai
//     tre livelli e ic_launcher_background e' definito una volta sola;
//   - la bolla: le stesse forme del primo piano, ritagliate ai 72dp che il
//     launcher mostra, e la bolla e la sua anteprima (BubbleOverlay,
//     SettingsScreen) disegnano lei, non il primo piano di 108dp;
//   - la geometria sul canvas di 108dp, dai pathData campionati (archi
//     compresi): tutto dentro la zona sicura (il cerchio di 66dp), l'anello
//     centrato, lente e manico staccati dai settori almeno quanto un taglio;
//   - controprove: un colore o un `d` cambiato nella maskable cambiano i file,
//     la scala troppo grande, il manico troppo lungo o il vetro senza foro
//     fermano il generatore, un gruppo spostato esce dalla zona sicura.
//
//   node db/test/android-icon.test.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { regoleMarchio } from '../../scripts/brand/colori.mjs'
import {
  CANVAS, FILE, LENTE, MARGINE, SCALA, VISTA, ZONA_SICURA, iconaAndroid, iconaDalRepository, problemi, sorgenteMarchio,
} from '../../scripts/brand/icona-android.mjs'

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
const lancia = (fn) => {
  try {
    fn()
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '../..')
const leggi = (p) => readFileSync(join(RADICE, p), 'utf8')
const MASKABLE = leggi('scripts/brand/svg/maskable.svg')
const fixed = (n) => Number(n.toFixed(2))

/** Il gruppo e le forme di un VectorDrawable: lato, scala, traslazione, [colore, pathData]. */
function vettore(xml) {
  const attr = (nome) => Number(new RegExp(`android:${nome}="([^"]+)"`).exec(xml)?.[1])
  return {
    lato: [attr('viewportWidth'), attr('viewportHeight')],
    scala: [attr('scaleX'), attr('scaleY')],
    t: [attr('translateX'), attr('translateY')],
    forme: [...xml.matchAll(/<path\s+android:fillColor="([^"]+)"\s+android:pathData="([^"]+)"\s*\/>/g)]
      .map(([, colore, d]) => ({ colore: colore.toLowerCase(), d })),
  }
}

/**
 * I punti di un pathData con soli M, L, A (cerchi: rx = ry, rotazione 0) e Z,
 * assoluti: i vertici, e gli archi campionati ogni grado circa. Un comando
 * diverso lancia: il campionamento non saprebbe dove passa la forma.
 */
function punti(d) {
  const out = []
  let p = null
  for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : []
    if (cmd === 'M' || cmd === 'L') {
      p = [n[0], n[1]]
      out.push(p)
    } else if (cmd === 'A') {
      const [rx, ry, rot, grande, verso, x2, y2] = n
      if (rx !== ry || rot !== 0) throw new Error(`arco non circolare in ${d}`)
      // SVG 1.1, F.6.5: dagli estremi al centro.
      const x1p = (p[0] - x2) / 2, y1p = (p[1] - y2) / 2
      let r = rx
      const lambda = (x1p ** 2 + y1p ** 2) / r ** 2
      if (lambda > 1) r *= Math.sqrt(lambda)
      const k = (grande !== verso ? 1 : -1) * Math.sqrt(Math.max(0, (r ** 2 - x1p ** 2 - y1p ** 2) / (x1p ** 2 + y1p ** 2)))
      const cx = k * y1p + (p[0] + x2) / 2, cy = -k * x1p + (p[1] + y2) / 2
      const a1 = Math.atan2(p[1] - cy, p[0] - cx)
      let da = Math.atan2(y2 - cy, x2 - cx) - a1
      if (verso === 1 && da < 0) da += 2 * Math.PI
      if (verso === 0 && da > 0) da -= 2 * Math.PI
      const passi = Math.max(8, Math.ceil(Math.abs(da) / (Math.PI / 180)))
      for (let i = 1; i <= passi; i++) {
        const a = a1 + (da * i) / passi
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      p = [x2, y2]
    } else if (cmd !== 'Z') {
      throw new Error(`comando ${cmd} non gestito in ${d}`)
    }
  }
  return out
}

/** Le distanze dal centro del vettore, in dp: settori e lente separati. */
function geometria(xml) {
  const v = vettore(xml)
  const dist = (forma) => punti(forma.d).map(([x, y]) =>
    Math.hypot(x * v.scala[0] + v.t[0] - v.lato[0] / 2, y * v.scala[1] + v.t[1] - v.lato[1] / 2))
  const settori = v.forme.slice(0, 5).flatMap(dist)
  const lente = v.forme.slice(5).flatMap(dist)
  return {
    massimo: Math.max(...settori, ...lente),
    anelloFuori: Math.max(...settori),
    anelloDentro: Math.min(...settori),
    lente: Math.max(...lente),
  }
}

console.log('\n  icona dell\'app Android\n')

// --- i file veri contro il generatore ---------------------------------------
const generati = iconaDalRepository(RADICE)
vale('il generatore scrive i quattro file dell\'icona e quello della bolla', Object.keys(generati).sort(), Object.values(FILE).sort())
for (const [percorso, testo] of Object.entries(generati)) {
  let suDisco = null
  try {
    suDisco = leggi(percorso)
  } catch {}
  check(`${percorso} e' quello che il generatore scriverebbe adesso`, suDisco === testo,
    suDisco == null ? 'manca: node scripts/brand/icona-android.mjs' : suDisco === testo ? '' : 'diverso: node scripts/brand/icona-android.mjs')
}

// --- il marchio, senza passare dal generatore -------------------------------
const primo = vettore(leggi(FILE.primoPiano))
const mono = vettore(leggi(FILE.monocromo))
const tsx = leggi('components/brand/marchio.tsx')
const settoriTsx = [.../const SETTORI = \[([\s\S]*?)\]/.exec(tsx)?.[1].matchAll(/'(M[^']+)'/g) ?? []].map((m) => m[1])
vale('cinque settori in marchio.tsx', settoriTsx.length, 5)
vale('i settori del primo piano sono i `d` di marchio.tsx, nello stesso ordine', primo.forme.slice(0, 5).map((f) => f.d), settoriTsx)
vale('poi la lente e il manico, e nient\'altro', primo.forme.length, 7)
const scuro = regoleMarchio(leggi('app/globals.css')).scuro
vale('i colori dei settori: --marchio-1..5 della variante scura di globals.css',
  primo.forme.slice(0, 5).map((f) => f.colore), [1, 2, 3, 4, 5].map((n) => scuro.get(n)))
vale('lente e manico nell\'oro del disco (--marchio-0, scuro)', primo.forme.slice(5).map((f) => f.colore), [scuro.get(0), scuro.get(0)])
check('il vetro ha il foro (due cerchi)', (primo.forme[5]?.d.match(/M/g) ?? []).length === 2, primo.forme[5]?.d)
const fondoMaskable = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(MASKABLE)?.[1]?.toLowerCase()
const colori = [...readFileSync(join(RADICE, FILE.fondo), 'utf8').matchAll(/<color name="ic_launcher_background">(#[0-9A-Fa-f]{6})<\/color>/g)]
vale('il fondo e\' quello della maskable della PWA', colori.map((m) => m[1].toLowerCase()), [fondoMaskable])
vale('il monocromo ha le stesse forme del primo piano', mono.forme.map((f) => f.d), primo.forme.map((f) => f.d))
vale('...in un colore solo', [...new Set(mono.forme.map((f) => f.colore))], ['#ffffff'])
vale('...con lo stesso gruppo', [mono.scala, mono.t], [primo.scala, primo.t])
const adattiva = leggi(FILE.icona)
vale('l\'adaptive icon: fondo, primo piano e monocromo',
  ['background', 'foreground', 'monochrome'].map((l) => new RegExp(`<${l} android:drawable="([^"]+)"`).exec(adattiva)?.[1]),
  ['@color/ic_launcher_background', '@drawable/ic_launcher_foreground', '@drawable/ic_launcher_monochrome'])
const res = 'android/app/src/main/res'
const definizioni = readdirSync(join(RADICE, res)).filter((d) => d.startsWith('values'))
  .flatMap((d) => readdirSync(join(RADICE, res, d)).filter((f) => f.endsWith('.xml')).map((f) => `${d}/${f}`))
  .filter((f) => /name="ic_launcher_background"/.test(readFileSync(join(RADICE, res, f), 'utf8')))
vale('ic_launcher_background definito una volta sola', definizioni, ['values/ic_launcher_background.xml'])

// --- la geometria sul canvas ------------------------------------------------
const g = geometria(leggi(FILE.primoPiano))
check(`tutto dentro la zona sicura (${ZONA_SICURA}dp dal centro)`, g.massimo <= ZONA_SICURA, `al massimo ${fixed(g.massimo)}dp`)
const sorgente = sorgenteMarchio(MASKABLE)
check('l\'anello e\' centrato e alla scala del generatore', Math.abs(g.anelloFuori - sorgente.esterno * SCALA) < 0.05,
  `${fixed(g.anelloFuori)}dp, atteso ${sorgente.esterno * SCALA}`)
check(`lente e manico staccati dai settori almeno di un taglio (${MARGINE} nel marchio)`, g.lente + MARGINE * SCALA <= g.anelloDentro,
  `lente fino a ${fixed(g.lente)}dp, settori da ${fixed(g.anelloDentro)}dp`)
check('il monocromo ha la stessa geometria', JSON.stringify(geometria(leggi(FILE.monocromo))) === JSON.stringify(g))
vale('il primo piano e\' sul canvas di 108dp', primo.lato, [CANVAS, CANVAS])

// --- la bolla ---------------------------------------------------------------
const bolla = vettore(leggi(FILE.bolla))
vale('la bolla e\' il quadrato che il launcher mostra', bolla.lato, [VISTA, VISTA])
check('...con le forme e i colori del primo piano', JSON.stringify(bolla.forme) === JSON.stringify(primo.forme), `${bolla.forme.length} forme`)
vale('...la stessa scala, spostata di meta\' del bordo tagliato', [bolla.scala, bolla.t],
  [primo.scala, primo.t.map((t) => t - (CANVAS - VISTA) / 2)])
const gb = geometria(leggi(FILE.bolla))
check('...e la stessa geometria dal centro', Object.keys(g).every((k) => Math.abs(gb[k] - g[k]) < 1e-9),
  Object.keys(g).map((k) => `${k} ${fixed(gb[k])}`).join(', '))
check(`...dentro il cerchio della bolla (${VISTA / 2}dp)`, gb.massimo < VISTA / 2, `al massimo ${fixed(gb.massimo)}dp`)
const kotlin = (p) => leggi(`android/app/src/main/java/it/emanuelemelini/dokkants/categoryhelper/${p}`)
for (const p of ['overlay/BubbleOverlay.kt', 'ui/SettingsScreen.kt']) {
  const testo = kotlin(p)
  check(`${p} disegna la bolla, non il primo piano di 108dp`,
    testo.includes('R.drawable.ic_bubble_foreground') && !testo.includes('R.drawable.ic_launcher_foreground'))
}

// --- controprove ------------------------------------------------------------
const oro = sorgente.nucleo.colore
const unColore = iconaAndroid(MASKABLE.replace(sorgente.settori[2].colore, '#123456'))
check('un colore cambiato nella maskable cambia il primo piano', unColore[FILE.primoPiano] !== generati[FILE.primoPiano])
check('...ma non il monocromo', unColore[FILE.monocromo] === generati[FILE.monocromo])
const unD = iconaAndroid(MASKABLE.replace(sorgente.settori[0].d, sorgente.settori[0].d.replace('A30 30', 'A29 29')))
check('un `d` cambiato cambia primo piano e monocromo', unD[FILE.primoPiano] !== generati[FILE.primoPiano] && unD[FILE.monocromo] !== generati[FILE.monocromo])
check('un altro oro cambia lente e manico', iconaAndroid(MASKABLE.replace(`fill="${oro}"`, 'fill="#ffd700"'))[FILE.primoPiano].includes('#FFD700'))
check('una scala troppo grande ferma il generatore', /zona sicura/.test(lancia(() => iconaAndroid(MASKABLE, { scala: 1.2 }))))
check('un manico troppo lungo tocca i settori', problemi(sorgente, { opzioni: { ...LENTE, sporgenza: 16 } }).some((p) => /tocca i settori/.test(p)))
check('un vetro spesso quanto il disco non ha il foro', problemi(sorgente, { opzioni: { ...LENTE, spessore: 8 } }).some((p) => /foro/.test(p)))
check('la maskable senza un settore non passa', /5 settori/.test(lancia(() => sorgenteMarchio(MASKABLE.replace(/<path [^>]*\/>/, '')))))
const spostato = geometria(leggi(FILE.primoPiano).replace(/android:translateX="[^"]+"/, 'android:translateX="40"'))
check('un gruppo spostato esce dalla zona sicura', spostato.massimo > ZONA_SICURA, `${fixed(spostato.massimo)}dp`)
check('il campionamento non accetta comandi che non conosce', /comando C/.test(lancia(() => punti('M0 0C1 1 2 2 3 3'))))
check('una forma generata dal marchio attuale non lancia', problemi(sorgente).length === 0, problemi(sorgente).join(' | '))

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
