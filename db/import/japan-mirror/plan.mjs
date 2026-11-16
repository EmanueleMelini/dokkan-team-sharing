// Il piano dello specchio Japan: dalle finestre Global del gioco e dalle
// run Japan che ci sono, cosa scrivere. Puro (niente database): lo usa
// mirror-japan.mjs e lo provano i test senza Postgres.
//
// Le finestre Japan volute sono le run Global del gioco (source 'game') e
// quelle a mano (source 'manual': set-event-window --reg global corregge
// una data Global, e la stessa correzione vale per Japan) che iniziano da D
// in poi, di tutti gli eventi, anche di quelli con run Japan del wiki piu'
// vecchie (le repliche ora hanno lo stesso calendario), meno le eccezioni
// di rules.mjs. Stesso inizio, stessa fine, stessa fine nota. La copia e'
// sempre 'mirror', da qualunque delle due venga. Le run Global del wiki
// (la prima uscita, un giorno) no.
// Poi, evento per evento, come load-windows fa per Global:
//   - una run a mano (manual) vince sempre: la finestra che la tocca (si
//     sovrappone, o inizia entro due giorni) si salta, e lei non si tocca;
//     nemmeno la copia che la finestra saltata aveva gia' (set-event-window
//     la chiude o la prende): resta com'e';
//   - la copia che c'e' gia' si riconosce dall'evento e dall'inizio (entro
//     due giorni, o sovrapposta), MAI dall'id della run Global: load-windows
//     scambia le righe per tenere i clear al loro posto. Si aggiorna sul
//     posto. Le copie entro due giorni vanno alle finestre nello stesso
//     ordine (due copie incrociate non si possono scrivere: una dovrebbe
//     passare sopra l'altra);
//   - la run del wiki della stessa uscita (inizio entro due giorni) diventa
//     la copia sul posto, con il suo id. Con la data Japan del wiki (JPdate)
//     la stessa uscita la dice la data, non dove sta la run: e' quella che
//     load-events ci avrebbe messo, e non sempre ce la puo' mettere. Se la
//     finestra ha gia' la sua copia, le due si riuniscono: la run del wiki
//     prende la finestra e la copia se ne va; se la copia ha dei clear resta
//     lei, e se ne va la run del wiki (senza clear). Senza, restava per
//     sempre un pezzetto di run del wiki prima della copia, dove un import
//     da zero ha una run sola;
//   - una run piu' vecchia che si sovrappone (del wiki) si chiude
//     all'inizio della finestra, con la fine non nota. La run del wiki della
//     data del wiki che load-events non ha potuto spostare (inizia dentro la
//     finestra, la data e' prima) va alla data, chiusa li';
//   - una data Japan del wiki da D in poi vince: le finestre che iniziano
//     piu' di due giorni prima non si copiano (conflitto). Oggi nella
//     cache non succede;
//   - la run del wiki sta alla data Japan del wiki gia' dopo questo giro,
//     qualunque sia la data, anche prima di D (un errore corretto, una
//     modifica annullata): load-events gira prima, e finche' una copia si
//     sovrappone a [data, infinito) non la puo' ne' spostare ne' creare.
//     Il risultato e' quello di un import da zero, che la metterebbe li';
//   - una copia con dei clear che inizia dentro una finestra (e la
//     bloccava) la prende lei, al posto della copia senza clear che la
//     finestra aveva scelto, che si toglie: restava un conflitto per
//     sempre, con un pezzetto di copia accanto (una set-event-window --reg
//     global con il --dal dentro la finestra, poi annullata);
//   - una copia che nessuna finestra vuole piu' (una regola nuova, la run
//     Global sparita) si toglie, a meno che non ci siano clear sopra: allora
//     resta (e mirror-japan.mjs stampa "  tengo la run ..."). Se era la run
//     del wiki adottata (l'uscita della data del wiki, e nessun'altra run
//     del wiki o della stessa uscita), torna la run del wiki (inizio JPdate,
//     fine non nota) con il suo id, invece di sparire;
//   - la regola dei clear, solo per le run del wiki: una run del wiki si
//     sposta, si adotta (o prende una finestra), si accorcia o si chiude
//     solo se i suoi clear (quelli che stanno dentro la sua corsa) restano
//     tutti dentro la corsa nuova, o se mirror-japan.mjs li porta con la sua
//     riga in una copia senza clear che li contiene tutti (lo scambio). Se
//     no quella mossa non si fa (il piano si rifa' senza): alla data del
//     wiki ne nasce una nuova se c'e' posto, la finestra che la chiuderebbe
//     e' un conflitto, e a ogni giro una riga "  tengo la run ...". I clear
//     gia' fuori dalla loro corsa (un clear scritto oggi su una run vecchia,
//     scelta nel builder) non la fermano, e la loro run non si scambia;
//   - una copia invece segue sempre la sua finestra Global (inizio, fine,
//     fine nota), come load-windows aggiorna una run Global del gioco anche
//     con dei clear sopra: i clear che cosi' restano fuori dalla loro run li
//     conta mirror-japan.mjs ("clear Japan scritti fuori dalla loro run"),
//     da rivedere a mano come su Global. Lo scambio resta per le copie che
//     il piano accorcia con la fine non nota (set-event-window --reg global
//     con il --dal dentro una finestra in corso): se una copia senza clear
//     li contiene tutti, la riga dei clear ci va. Prima una copia con dei
//     clear nel pezzo che la finestra nuova tagliava teneva le date Global
//     vecchie, la finestra era un conflitto, e Japan mostrava date sbagliate;
//   - una run del wiki chiusa (fine non nota) finisce dove comincia la
//     prossima run Japan: si riapre se li' non comincia piu' niente, si
//     accorcia se prima ne comincia un'altra; e se cosi' copre la data del
//     wiki ne parte, come la sposterebbe load-events la settimana dopo;
//   - quando un'altra run del wiki sta alla data del wiki (o e' quella che
//     la finestra della stessa uscita ha adottato), una run del wiki senza
//     clear che non e' lei si toglie, come load-events toglie le run che il
//     wiki non da' piu': e' la run lasciata ferma dalla regola dei clear
//     (alla data ne era nata una nuova), a cui poi i clear sono stati tolti
//     o spostati a mano. Restava aperta per sempre, e su Japan l'evento in
//     corso. Finche' ha dei clear resta, con la sua riga "  tengo".
// Ogni evento si ricontrolla alla fine: se le run che ne escono si
// sovrapporrebbero, o se l'ordine delle scritture passasse da una
// sovrapposizione (il vincolo run_no_overlap non e' differibile), il piano
// si rifa' prima con i divieti della regola dei clear (una run del wiki con
// i clear in due finestre vicine si incrociava con un'altra run del wiki),
// poi con le finestre delle due run che si sovrappongono in conflitto (una
// finestra bloccata lascia la sua copia dov'era, e la copia della finestra
// prima ci arrivava); se non basta l'evento non si tocca e il piano lo dice
// come conflitto.
import { TOL, japanDay } from './rules.mjs'

// Gli istanti sono millisecondi, con i microsecondi di Postgres nella
// parte decimale quando arrivano come testo ISO con sei cifre (cosi' li
// legge mirror-japan.mjs): una copia e' uguale alla sua run Global al
// microsecondo, e una Date di JS si ferma al millisecondo (le run a mano
// della fixture, scritte con now(), hanno i microsecondi). Quando ci sono,
// un istante torna testo ISO con sei cifre, se no una Date.
const ms = (d) => {
  if (d == null) return null
  if (typeof d !== 'string') return new Date(d).getTime()
  const us = d.match(/\.\d{3}(\d{1,3})/)
  return Date.parse(d) + (us ? Number(us[1].padEnd(3, '0')) / 1000 : 0)
}
const date = (t) => {
  if (t == null) return null
  const intero = Math.floor(t), us = Math.round((t - intero) * 1000)
  return us ? new Date(intero).toISOString().replace('Z', `${String(us).padStart(3, '0')}Z`) : new Date(intero)
}
const fine = (r) => (r.e == null ? Infinity : r.e)
const sovrapposte = (a, b) => a.s < fine(b) && b.s < fine(a)
const vicine = (a, b) => Math.abs(a.s - b.s) <= TOL
const tratto = (x) => ({ starts_at: date(x.s), ends_at: date(x.e), ends_at_known: x.known })

/**
 * @typedef {{ id: string | number, event_id: string | number, starts_at: Date | string,
 *             ends_at: Date | string | null, ends_at_known: boolean }} GlobalRun
 * @typedef {GlobalRun & { source: 'wiki' | 'manual' | 'mirror' | 'game' }} JapanRun
 * @typedef {{ starts_at: Date, ends_at: Date | null, ends_at_known: boolean }} Span
 *
 * @param {{ globalRuns: (GlobalRun & { source?: string })[], japanRuns: JapanRun[],
 *           wikiJapan?: Map<number, Date | string>, pinned?: Set<string>,
 *           clears?: Map<string, (Date | string)[]>,
 *           rules: import('./rules.mjs').Rules }} input
 *   globalRuns  le run Global con source 'game' o 'manual' (le altre si ignorano)
 *   japanRuns   tutte le run Japan
 *   wikiJapan   evento -> la data Japan del wiki (JPdate), per i conflitti e
 *               per riconoscere la run del wiki adottata
 *   pinned      gli id (stringa) delle run con dei clear o delle missioni:
 *               non si cancellano
 *   clears      run (id stringa) -> gli istanti dei suoi clear (created_at),
 *               per la regola dei clear: una run con dei clear e' anche pinned
 */
export function planJapanMirror({ globalRuns, japanRuns, wikiJapan = new Map(), pinned = new Set(), clears = new Map(), rules }) {
  const since = Date.parse(rules.since)
  const soloGlobal = new Map(rules.globalOnly.map((g) => [Number(g.event), g.why]))
  const salta = rules.skipWindows.map((x) => ({ event: Number(x.event), s: Date.parse(x.start), why: x.why }))
  const plan = nuovoPiano()
  const istanti = new Map([...clears].map(([id, xs]) => [String(id), xs.map(ms)]))
  const fermi = new Set([...pinned].map(String))
  for (const [id, xs] of istanti) if (xs.length) fermi.add(id)

  const finestre = new Map()
  for (const g of globalRuns) {
    if (g.source != null && g.source !== 'game' && g.source !== 'manual') continue
    const w = { event_id: Number(g.event_id), s: ms(g.starts_at), e: ms(g.ends_at), known: g.ends_at_known, global: String(g.id) }
    if (w.s < since) continue
    if (soloGlobal.has(w.event_id)) { plan.excluded.push({ event_id: w.event_id, window: tratto(w), rule: 'globalOnly', why: soloGlobal.get(w.event_id) }); continue }
    const x = salta.find((k) => k.event === w.event_id && Math.abs(k.s - w.s) <= TOL)
    if (x) { plan.excluded.push({ event_id: w.event_id, window: tratto(w), rule: 'skipWindows', why: x.why }); continue }
    if (!finestre.has(w.event_id)) finestre.set(w.event_id, [])
    finestre.get(w.event_id).push(w)
  }
  const japan = new Map()
  for (const r of japanRuns) {
    const x = { id: String(r.id), event_id: Number(r.event_id), source: r.source, s: ms(r.starts_at), e: ms(r.ends_at), known: r.ends_at_known }
    x.orig = { source: x.source, s: x.s, e: x.e, known: x.known }
    if (!japan.has(x.event_id)) japan.set(x.event_id, [])
    japan.get(x.event_id).push(x)
  }
  const eventi = [...new Set([...finestre.keys(), ...japan.keys()])].sort((a, b) => a - b)
  for (const ev of eventi) {
    const ws = (finestre.get(ev) ?? []).sort((a, b) => a.s - b.s)
    const runs = japan.get(ev) ?? []
    const x = wikiJapan.get(ev)
    evento(plan, { ev, ws, runs, wiki: x == null ? null : ms(x), since, pinned: fermi, clears: istanti })
  }
  return plan
}

// invariate: gli id delle copie che non cambiano (unchanged le conta), per
// i passi di mirror-japan.mjs: una copia invariata al primo passo e scritta
// in uno dopo non e' invariata. dropStray: le run del wiki in piu' tolte
// perche' un'altra e' alla data del wiki (at: quella).
const nuovoPiano = () => ({
  windows: 0, excluded: [], insert: [], update: [], adopt: [], fold: [], dropWiki: [], dropStray: [], close: [], reopen: [], restore: [],
  place: [], delete: [], keep: [], skip: [], conflict: [], unchanged: 0, invariate: [], firstJapan: [], steps: [], spinte: [], riprese: [],
})

// Un evento, con la regola dei clear: una run del wiki si sposta, si
// adotta, si accorcia o si chiude solo se i clear che stanno dentro la sua
// corsa restano dentro la corsa nuova (o se lo scambio di mirror-japan.mjs
// li porta con la sua riga in una copia senza clear). Le copie no: seguono
// la loro finestra Global. Il piano si fa con tutte le run libere; se una
// run del wiki la viola, si rifa' con quella mossa vietata a lei (fisse:
// id -> le mosse vietate), finche' nessuna la viola. Anche quando il piano
// non si puo' scrivere (controlla): i divieti possono togliere proprio la
// mossa che lo rompeva. Le mosse:
//   copia   prendere una finestra (adottata, riunita);
//   sposta  andare alla data del wiki;
//   chiude  chiudersi all'inizio di una finestra o della data, accorciarsi
//           (con la chiusura vietata blocca la finestra: un conflitto).
// Allungarsi resta sempre permesso (non lascia fuori nessun clear). I
// divieti crescono a ogni prova, tre al piu' per run, quindi finisce. Le
// run si rifanno da capo a ogni prova (il piano le cambia sul posto).
function evento(plan, input) {
  const fisse = new Map(), bloccate = new Map()
  for (let prova = 0; ;) {
    const p = nuovoPiano()
    const { ferme: fuori, blocca } = eventoProva(p, { ...input, runs: input.runs.map((r) => ({ ...r })), fisse, bloccate })
    // un piano che non si scrive, senza divieti nuovi: le finestre delle
    // copie che si sovrappongono diventano conflitti, e si rifa' (le
    // finestre bloccate crescono a ogni prova, quindi finisce)
    if (blocca.length) {
      for (const [s, r] of blocca) bloccate.set(s, r)
      continue
    }
    prova++
    const nuovi = fuori.filter(({ id, mossa }) => !fisse.get(id)?.has(mossa))
    if (!fuori.length || !nuovi.length || prova > 3 * input.runs.length + 1) {
      // (una run che il piano cambia comunque con la mossa vietata non
      // dovrebbe esserci: l'evento allora non si tocca, e il giro lo dice)
      if (fuori.length) {
        const q = nuovoPiano()
        q.conflict.push({ event_id: input.ev, why: 'plan', detail: `la regola dei clear non si puo' rispettare (run ${fuori.map((x) => x.id).join(', ')})` })
        for (const r of input.runs) if (r.source === 'mirror') q.keep.push({ id: r.id, event_id: input.ev, ...tratto(r), why: 'conflict' })
        unisci(plan, q)
      } else unisci(plan, p)
      return
    }
    for (const { id, mossa } of nuovi) fisse.set(id, new Set([...(fisse.get(id) ?? []), mossa]))
  }
}

function unisci(plan, p) {
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v)) plan[k].push(...v)
    else plan[k] += v
  }
}

function eventoProva(plan, { ev, ws, runs, wiki, since, pinned, clears, fisse, bloccate }) {
  const conflitti = [], salti = [], tenute = new Map()   // id -> perche'
  const vieta = (r, mossa) => r.id != null && !!fisse.get(r.id)?.has(mossa)
  // i clear di una run (istanti), e quelli dentro la sua corsa di prima
  const suoi = (r) => (r.id == null ? [] : clears.get(r.id) ?? [])
  const dentro = (t, x) => t >= x.s && t < fine(x)
  const nellaCorsa = (r) => (r.orig ? suoi(r).filter((t) => dentro(t, r.orig)) : [])
  // La run del wiki della data Japan del wiki, in due sensi.
  // dellUscita: quella la cui uscita e' la data, anche quando load-events
  // non ce l'ha potuta mettere (una copia si sovrapponeva, o ha dei clear e
  // la sposta solo lo specchio): la finestra della stessa uscita la adotta,
  // o la toglie se e' una in piu' (3b). La piu' vicina alla data fra quelle
  // senza clear (com'era), se no fra quelle con dei clear che possono
  // prendere una finestra.
  // delWiki: quella che va alla data (passi 4, 6 e 7b): la piu' vicina alla
  // data fra quelle che si possono spostare, anche con dei clear (la regola
  // dei clear la ferma se li lascerebbe fuori).
  const vicinaAllaData = (xs) => xs.sort((a, b) => Math.abs(a.s - wiki) - Math.abs(b.s - wiki))[0] ?? null
  const delWiki = wiki == null ? null : vicinaAllaData(runs.filter((r) => r.source === 'wiki' && !vieta(r, 'sposta')))
  const dellUscita = wiki == null ? null : vicinaAllaData(runs.filter((r) => r.source === 'wiki' && !pinned.has(r.id)))
    ?? vicinaAllaData(runs.filter((r) => r.source === 'wiki' && !vieta(r, 'copia')))
  const uscita = (r) => (r === dellUscita ? wiki : r.s)
  // 1. la data Japan del wiki da D in poi vince: le finestre prima non si copiano
  let vive = ws
  if (wiki != null && wiki >= since) {
    for (const w of ws.filter((w) => w.s < wiki - TOL)) {
      conflitti.push({ event_id: ev, why: 'wiki', window: tratto(w), wiki: date(wiki) })
    }
    vive = ws.filter((w) => w.s >= wiki - TOL)
  }
  // 2. una run a mano vince: la finestra che la tocca si salta, e la copia
  // che la finestra aveva resta com'e' (set-event-window la chiude o la prende)
  const daCopiare = []
  for (const w of vive) {
    const tocca = runs.filter((r) => sovrapposte(r, w) || vicine(r, w))
    const mano = tocca.find((r) => r.source === 'manual')
    if (!mano) { daCopiare.push(w); continue }
    salti.push({ event_id: ev, window: tratto(w), manual: mano.id })
    for (const r of tocca) if (r.source === 'mirror') tenute.set(r.id, 'manual')
  }
  // 3. chi e' la copia di chi: prima le copie entro due giorni, poi quelle
  // sovrapposte, poi la run del wiki della stessa uscita
  const bersaglio = new Map(), presa = new Set()
  const libera = (r) => !presa.has(r.id) && !tenute.has(r.id) && !vieta(r, 'copia')
  const scegli = (w, ok) => runs.filter((r) => libera(r) && ok(r))
    .sort((a, b) => Math.abs(a.s - w.s) - Math.abs(b.s - w.s) || a.s - b.s)[0]
  const passo = (ok) => {
    for (const w of daCopiare) {
      if (bersaglio.has(w)) continue
      const r = scegli(w, (r) => ok(r, w))
      if (r) { bersaglio.set(w, r); presa.add(r.id) }
    }
  }
  // Le copie entro due giorni, tutte insieme e nello stesso ordine delle
  // finestre: il maggior numero di coppie, e fra quelle le piu' vicine.
  // Finestra per finestra, la copia piu' vicina incrociava due copie (due
  // finestre Global a poche ore, dopo un set-event-window --reg global: una
  // doveva andare avanti sopra l'altra che tornava indietro, e nessun ordine
  // di scritture lo fa), o prendeva a una finestra la sua copia esatta
  // (quella dopo, a meno di due giorni). Due copie incrociate non servono
  // mai: scambiate restano entro due giorni, e piu' vicine in tutto.
  {
    const cs = runs.filter((r) => r.source === 'mirror' && libera(r)).sort((a, b) => a.s - b.s)
    const n = daCopiare.length, m = cs.length
    // meglio[i][k]: le coppie fra le prime i finestre e le prime k copie, [quante, distanza]
    const meglio = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => [0, 0]))
    const prima = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] < b[1])
    for (let i = 1; i <= n; i++) {
      for (let k = 1; k <= m; k++) {
        let x = prima(meglio[i - 1][k], meglio[i][k - 1]) ? meglio[i - 1][k] : meglio[i][k - 1]
        const d = Math.abs(cs[k - 1].s - daCopiare[i - 1].s)
        if (d <= TOL) {
          const y = [meglio[i - 1][k - 1][0] + 1, meglio[i - 1][k - 1][1] + d]
          if (prima(y, x)) x = y
        }
        meglio[i][k] = x
      }
    }
    for (let i = n, k = m; i > 0 && k > 0;) {
      const d = Math.abs(cs[k - 1].s - daCopiare[i - 1].s)
      const qui = meglio[i][k], coppia = meglio[i - 1][k - 1]
      if (d <= TOL && qui[0] === coppia[0] + 1 && qui[1] === coppia[1] + d) {
        bersaglio.set(daCopiare[i - 1], cs[k - 1]); presa.add(cs[k - 1].id); i--; k--
      } else if (qui[0] === meglio[i - 1][k][0] && qui[1] === meglio[i - 1][k][1]) i--
      else k--
    }
  }
  passo((r, w) => r.source === 'mirror' && sovrapposte(r, w))
  // Le run del wiki della stessa uscita, anche loro nell'ordine delle
  // finestre: con due run del wiki (una ferma per i clear, e quella nata
  // alla data) e due finestre a poche ore, la prima finestra prendeva la
  // run dopo e la seconda quella prima. Due run incrociate non si possono
  // scrivere (ognuna va dove sta l'altra), e l'evento restava fermo ogni
  // settimana ("piano non applicabile").
  {
    let dopo = -Infinity
    for (const w of daCopiare) {
      if (bersaglio.has(w)) continue
      const r = scegli(w, (r) => r.source === 'wiki' && Math.abs(uscita(r) - w.s) <= TOL && r.s > dopo)
      if (r) { bersaglio.set(w, r); presa.add(r.id); dopo = r.s }
    }
  }

  // 3b. La finestra ha gia' la sua copia, e c'e' anche la run del wiki
  // della stessa uscita (dalla data del wiki, o senza data dal suo inizio):
  // un import da zero avrebbe una run sola, la run del wiki adottata. Succede
  // quando la data del wiki arriva al giorno di una copia che c'e' gia'
  // (88853, da 1 Apr 2017 a 16 Oct 2025): load-events sposta la run del
  // wiki alla data e la chiude dove comincia la copia, e restava li' per
  // sempre, un pezzetto di cinque ore. Allora si riuniscono come vuole la
  // regola dell'adozione: la run del wiki prende la finestra con il suo id,
  // e la copia si toglie. La copia con dei clear non si puo' togliere:
  // allora resta lei, con la finestra, e la run del wiki (senza clear) si
  // toglie, come in un import da zero, dove la run del wiki e' una sola e
  // l'ha presa la finestra. Con dei clear sulla run del wiki prende la
  // finestra lei solo se la regola dei clear lo permette (se no il piano si
  // rifa' con lei ferma, e restano tutte e due com'erano); e non si toglie.
  const tolte = new Set(), copiate = new Set()
  const riunite = new Map(), scartate = new Map()   // finestra -> la copia che lascia il posto, o la run del wiki che si toglie
  for (const w of daCopiare) {
    const t = bersaglio.get(w)
    if (!t || (t.source !== 'mirror' && wiki == null)) continue
    const r = runs.find((o) => o !== t && o.source === 'wiki' && libera(o) && !tolte.has(o.id)
                               && (wiki == null || o === dellUscita) && Math.abs(uscita(o) - w.s) <= TOL)
    if (!r) continue
    // la finestra e' andata a un'altra run del wiki (una con dei clear,
    // vicina alla finestra): la run della data e' una in piu', e si toglie
    if (t.source !== 'mirror' || pinned.has(t.id)) {
      if (!pinned.has(r.id)) { tolte.add(r.id); scartate.set(w, r) }
      continue
    }
    bersaglio.set(w, r); presa.add(r.id); presa.delete(t.id); tolte.add(t.id); riunite.set(w, t)
  }

  // 4. le finestre in ordine: chi resta in mezzo si chiude o si toglie.
  // La run del wiki della data del wiki che inizia dentro la finestra e la
  // data e' prima (load-events non l'ha potuta spostare: una copia con dei
  // clear o una run a mano fra le due date) non blocca: va alla data, chiusa
  // all'inizio della finestra (il passo 7 la accorcia se prima comincia
  // un'altra run), come la metterebbe il passo 6. Bloccava la finestra per
  // un giro, e Japan per una settimana non aveva la sua copia. Solo se la
  // data e' libera: nessun'altra run o finestra ci comincia (entro due
  // giorni) o la copre.
  const allaDataLibera = (w, t) => wiki != null
    && !runs.some((o) => o !== delWiki && o !== t && !tolte.has(o.id) && (Math.abs(o.s - wiki) <= TOL || (o.s < wiki && wiki < fine(o))))
    && !daCopiare.some((x) => x !== w && (Math.abs(x.s - wiki) <= TOL || (x.s < wiki && wiki < fine(x))))
  // Una copia con dei clear che inizia dentro la finestra (e la bloccava)
  // prende lei la finestra: la copia senza clear che la finestra aveva
  // scelto (la piu' vicina) si toglie. Succede quando una set-event-window
  // --reg global con il --dal dentro la finestra si annulla: la copia dei
  // clear era andata, con lo scambio, alla finestra della run a mano, e la
  // finestra rimessa intera prendeva il pezzetto senza clear prima di lei.
  // Restava un conflitto per sempre, con due copie dove un import da zero
  // ne ha una. Anche se cosi' un suo clear resta fuori: una copia segue la
  // finestra (mirror-japan.mjs conta i clear fuori). Solo al posto di una
  // copia senza clear (o di nessuna): la run del wiki adottata, o riunita,
  // resta la sua.
  const riprese = []
  const esamina = (w, t) => {
    const altre = runs.filter((r) => r !== t && !tolte.has(r.id) && !presa.has(r.id) && sovrapposte(r, w))
    const x = { chiudi: [], togli: [], allaData: [], blocco: null }
    for (const r of altre) {
      // la run del wiki che non si puo' chiudere (i clear) ma va alla data,
      // dopo la finestra (il passo 7b): li' non la tocca, e non la blocca
      if (r === delWiki && vieta(r, 'chiude') && r.s < wiki && wiki < fine(r) && fine(w) <= wiki) continue
      if (tenute.has(r.id)) x.blocco = r
      else if (r === delWiki && r.s >= w.s && wiki < w.s && allaDataLibera(w, t)) x.allaData.push(r)
      // piu' vecchia: finisce dove comincia la finestra (una run del wiki
      // ferma per i clear no: blocca). Una copia senza clear invece si
      // toglie, tanto nessuna finestra la vuole
      else if (r.s < w.s && !vieta(r, 'chiude') && (r.source === 'wiki' || (r.source === 'mirror' && pinned.has(r.id)))) x.chiudi.push(r)
      else if (r.source === 'mirror' && !pinned.has(r.id)) x.togli.push(r)
      else x.blocco = r
      if (x.blocco) break
    }
    return x
  }
  for (const w of daCopiare) {
    let t = bersaglio.get(w)
    let { chiudi, togli, allaData, blocco } = esamina(w, t)
    const b = blocco
    if (b && !bloccate.has(w.s) && b.source === 'mirror' && b.orig?.source === 'mirror' && pinned.has(b.id) && !tenute.has(b.id)
        && !riunite.has(w) && !scartate.has(w) && (!t || (t.source === 'mirror' && t.orig?.source === 'mirror' && !pinned.has(t.id)))) {
      // la prova con lei: se nient'altro blocca, prende la finestra
      if (t) { presa.delete(t.id); tolte.add(t.id) }
      presa.add(b.id)
      const y = esamina(w, b)
      if (y.blocco) {
        presa.delete(b.id)
        if (t) { tolte.delete(t.id); presa.add(t.id) }
      } else {
        riprese.push({ id: b.id, copy: t?.id ?? null, event_id: ev })
        t = b; bersaglio.set(w, t)
        chiudi = y.chiudi; togli = y.togli; allaData = y.allaData; blocco = null
      }
    }
    // una finestra bloccata da una prova di prima (il piano non si scriveva)
    if (!blocco && bloccate.has(w.s)) blocco = bloccate.get(w.s)
    if (blocco) {
      // come load-windows: una run del wiki (o una copia con clear) che
      // inizia dentro la finestra; si lascia tutto com'e', anche la copia
      // che si riuniva alla run del wiki (3b)
      conflitti.push({ event_id: ev, why: 'run', window: tratto(w), run: blocco.id, source: blocco.source })
      if (t) { presa.delete(t.id); tenute.set(t.id, 'conflict') }
      if (riunite.has(w)) { tolte.delete(riunite.get(w).id); riunite.delete(w) }
      if (scartate.has(w)) { tolte.delete(scartate.get(w).id); scartate.delete(w) }
      for (const r of runs) {
        if (r.source === 'mirror' && !presa.has(r.id) && (sovrapposte(r, w) || vicine(r, w))) tenute.set(r.id, 'conflict')
      }
      continue
    }
    for (const r of togli) tolte.add(r.id)
    for (const r of allaData) Object.assign(r, { s: wiki, e: w.s, known: false, op: 'place' })
    for (const r of chiudi) Object.assign(r, { e: w.s, known: false, op: r.op ?? 'close' })
    if (t) {
      Object.assign(t, { source: 'mirror', s: w.s, e: w.e, known: w.known, op: t.orig.source === 'wiki' ? 'adopt' : 'update' })
      copiate.add(t.id)
    } else {
      runs.push({ id: null, event_id: ev, source: 'mirror', s: w.s, e: w.e, known: w.known, orig: null, op: 'insert' })
    }
  }
  plan.windows += daCopiare.length

  // 5. le copie che nessuna finestra vuole piu'
  const viva = (r) => !tolte.has(r.id)
  const daRivedere = runs.filter((r) => r.orig?.source === 'mirror' && !copiate.has(r.id) && viva(r))
  const tieni = []
  for (const r of daRivedere) if (tenute.has(r.id)) tieni.push({ r, why: tenute.get(r.id) })
  const libere = daRivedere.filter((r) => !tenute.has(r.id))
  // Era la run del wiki adottata (la stessa uscita della data del wiki)?
  // Una sola: la piu' vicina alla data, fra le copie che nessuno vuole piu'
  // entro due giorni. E solo se non c'e' gia' un'altra run del wiki viva
  // (anche altrove: la sposta il passo 6), o un'altra run della stessa
  // uscita che resta (la copia adottata vera, quando le finestre vicine
  // alla data erano due): allora e' solo una copia in piu'. Tornata run del
  // wiki davanti alla copia vera, il giro dopo la riunione (3b) toglieva la
  // copia vera; e con dei clear sulla copia vera restava li' per sempre.
  const adottata = wiki == null ? null : libere.filter((r) => Math.abs(r.s - wiki) <= TOL)
    .sort((a, b) => Math.abs(a.s - wiki) - Math.abs(b.s - wiki) || a.s - b.s)[0] ?? null
  const torna = adottata != null
    && !runs.some((o) => viva(o) && !libere.includes(o) && (o.source === 'wiki' || Math.abs(o.s - wiki) <= TOL))
  for (const r of libere) {
    if (r === adottata && torna) continue
    if (pinned.has(r.id)) tieni.push({ r, why: 'clear' })
    else tolte.add(r.id)
  }
  if (adottata && torna) {
    const resto = runs.filter((o) => o !== adottata && viva(o))
    if (!resto.some((o) => o.s <= wiki && wiki < fine(o))) {
      const dopo = resto.filter((o) => o.s > wiki).map((o) => o.s)
      Object.assign(adottata, { source: 'wiki', s: wiki, e: dopo.length ? Math.min(...dopo) : null, known: false, op: 'restore' })
    } else if (pinned.has(adottata.id)) tieni.push({ r: adottata, why: 'clear' })
    else tolte.add(adottata.id)
  }

  // 6. La run del wiki va alla data Japan del wiki in questo giro, qualunque
  // sia la data. load-events gira prima e non sempre ce la puo' mettere da
  // solo: una copia si sovrappone a [data, infinito), e una run del wiki
  // chiusa da una copia non si sposta oltre la sua fine. Da D in poi la
  // data vince sulle copie (passo 1). Prima di D (la data che torna
  // indietro: un errore corretto, una modifica annullata) le copie restano,
  // e la run del wiki torna alla data chiusa all'inizio della prima, come
  // dopo un import da zero: senza, restava aperta alla data di prima (e
  // l'evento in corso per sempre), o dopo un'adozione non tornava piu'.
  // Senza questo passo servirebbero due giri, e per una settimana Japan
  // direbbe altro dal wiki (o non avrebbe nessuna run). Niente da fare se una run
  // comincia gia' li' (entro due giorni: la run del wiki, o la copia della
  // stessa uscita). Una copia tenuta per i clear che copre la data si
  // chiude li', con la fine non nota, come una run piu' vecchia all'inizio
  // di una finestra (mirror-japan.mjs scambia poi le righe se i clear stanno
  // tutti dopo); qualunque altra run che la copre (a mano, una copia
  // lasciata per una run a mano o per un conflitto) vince, e non si mette
  // niente. Poi la run del wiki: la piu' vicina che c'e' si sposta, se no
  // una copia appena tolta la diventa (con il suo id, come 'restore'), se
  // no ne nasce una. Fine non nota, fino alla prossima run: com'e' dopo
  // load-events, che al giro dopo non ha piu' niente da fare. Una run del
  // wiki con dei clear si sposta solo se restano tutti dentro (la regola
  // dei clear; la data tornata al 2021 portava indietro di anni una run
  // aperta con un clear del 2026, poi chiusa nel 2025). Se no resta dov'e'
  // (ferma), e alla data ne nasce una nuova; se copre la data non si mette
  // niente. Lo dice la riga "tengo" piu' sotto, a ogni giro.
  if (wiki != null && !runs.some((r) => viva(r) && Math.abs(r.s - wiki) <= TOL)) {
    const prossima = (x) => {
      const dopo = runs.filter((o) => o !== x && viva(o) && o.s > wiki).map((o) => o.s)
      return dopo.length ? Math.min(...dopo) : null
    }
    const vicina = (xs) => xs.sort((a, b) => Math.abs(a.s - wiki) - Math.abs(b.s - wiki))[0]
    let copre = runs.find((r) => viva(r) && r.s < wiki && wiki < fine(r))
    const tenuta = copre ? tieni.findIndex((t) => t.r === copre && t.why === 'clear') : -1
    if (tenuta >= 0) {
      Object.assign(copre, { e: wiki, known: false, op: 'close' })
      tieni.splice(tenuta, 1)
      copre = undefined
    }
    if (!copre || (copre.source === 'wiki' && !vieta(copre, 'sposta'))) {
      const r = copre ?? vicina(runs.filter((o) => viva(o) && o.source === 'wiki' && !vieta(o, 'sposta')))
        ?? vicina(runs.filter((o) => o.orig?.source === 'mirror' && tolte.has(o.id)))
      if (r) {
        tolte.delete(r.id)
        Object.assign(r, { source: 'wiki', s: wiki, e: prossima(r), known: false, op: 'place' })
      } else {
        runs.push({ id: null, event_id: ev, source: 'wiki', s: wiki, e: prossima(null), known: false, orig: null, op: 'place' })
      }
    }
  }

  // 7. una run del wiki chiusa (fine non nota) finisce dove comincia la
  // prossima run: si riapre dove non comincia piu' niente, si accorcia se
  // prima ne comincia un'altra (la run messa alla data al passo 4, chiusa
  // all'inizio della sua finestra, con una copia in mezzo)
  // (una run del wiki a cui i clear vietano di chiudersi si riapre, ma non si accorcia)
  const passo7 = () => {
    for (const r of runs) {
      if (!viva(r) || r.source !== 'wiki' || r.e == null || r.known) continue
      const dopo = runs.filter((o) => o !== r && viva(o) && o.s > r.s).map((o) => o.s)
      const e = dopo.length ? Math.min(...dopo) : null
      if (e === r.e || (vieta(r, 'chiude') && e != null && e < fine(r.orig ?? r))) continue
      const op = r.op === 'restore' || r.op === 'place' ? r.op : e != null && e < r.e ? 'close' : 'reopen'
      Object.assign(r, { e, op })
    }
  }
  // 7b. ...e se ora copre la data del wiki (riaperta fino a una run a mano
  // o a una copia che comincia entro due giorni dalla data, e il passo 6 non
  // c'era) parte dalla data: e' quello che load-events farebbe la settimana
  // dopo, perche' niente si sovrappone a [data, fine). Con dei clear solo se
  // la regola lo permette, come al passo 6. Anche indietro, entro due
  // giorni, se fra la data e il suo inizio non c'e' niente: load-events non
  // sposta una run del wiki con dei clear (non sa dove la chiudera' lo
  // specchio), e il passo 6 non c'e' (comincia gia' lei, entro due giorni).
  // Allungarla non lascia fuori nessun clear.
  const passo7b = () => {
    if (delWiki && !tolte.has(delWiki.id) && delWiki.source === 'wiki'
        && ((delWiki.s < wiki && wiki < fine(delWiki))
            || (wiki < delWiki.s && delWiki.s - wiki <= TOL && !runs.some((o) => o !== delWiki && viva(o) && sovrapposte(o, { s: wiki, e: delWiki.s }))))) {
      Object.assign(delWiki, { s: wiki, op: delWiki.op === 'restore' ? 'restore' : 'place' })
    }
  }
  // 7c. La run della data del wiki: una run del wiki alla data (entro due
  // giorni, la piu' vicina), o quella della stessa uscita che una finestra
  // ha adottato. Quando c'e', le altre run del wiki senza clear si tolgono:
  // un import da zero ne ha una sola. Era la run lasciata ferma dalla regola
  // dei clear mentre alla data ne nasceva una nuova (707351), poi senza piu'
  // clear: load-events non la tocca (la run alla data gli basta), e restava
  // aperta per sempre, l'evento in corso su Japan. Con dei clear resta, e lo
  // dice la riga "tengo" qui sotto.
  let allaData = null
  const strays = []
  const passo7c = () => {
    if (wiki == null) return
    allaData = runs.filter((r) => viva(r) && r.source === 'wiki' && Math.abs(r.s - wiki) <= TOL)
      .sort((a, b) => Math.abs(a.s - wiki) - Math.abs(b.s - wiki) || a.s - b.s)[0]
      ?? (dellUscita && viva(dellUscita) && copiate.has(dellUscita.id) && dellUscita.orig?.source === 'wiki' ? dellUscita : null)
    if (!allaData) return
    for (const r of runs) {
      if (r === allaData || !viva(r) || r.source !== 'wiki' || r.orig?.source !== 'wiki' || pinned.has(r.id)) continue
      tolte.add(r.id)
      strays.push(r)
    }
  }
  // Le tre insieme finche' cambiano: 7b sposta l'inizio di una run, e chi
  // finiva li' (passo 7) va rifatto; 7c toglie una run, e chi finiva dove
  // lei cominciava si riapre, e 7b puo' trovare libero lo spazio fino alla
  // data. Con due run del wiki servivano due giri.
  const impronta = () => runs.map((r) => `${r.s} ${r.e} ${viva(r)}`).join()
  for (let giro = 0; giro < 5; giro++) {
    const prima = impronta()
    passo7()
    passo7b()
    passo7c()
    if (impronta() === prima) break
  }

  // le run del wiki con dei clear che non sono la run della data del wiki
  // (il passo 6 non le sposta, il 7c non le toglie): restano, e si dice a
  // ogni giro. Anche quando alla data non c'e' nessuna run del wiki, per
  // esempio perche' la finestra della data ha una copia con un clear (anche
  // uno scelto nel builder) e la riunione del passo 3b non si fa: senza la
  // riga la run restava aperta, l'evento in corso su Japan, e nessuno lo
  // vedeva. E le run del wiki che la regola dei clear lascia com'erano
  // (spostarle o chiuderle lascerebbe fuori dei clear): anche loro
  if (wiki != null) {
    for (const r of runs) {
      // senza una run alla data, quella che la regola dei clear ha fermato la
      // dice gia' la riga "fissa" qui sotto
      if (r !== allaData && viva(r) && r.source === 'wiki' && pinned.has(r.id)
          && (allaData || !(fisse.has(r.id) && !cambiata(r)))) tieni.push({ r, why: 'wiki' })
    }
  }
  for (const r of runs) {
    if (fisse.has(r.id) && viva(r) && !cambiata(r) && !tieni.some((k) => k.r === r)) tieni.push({ r, why: 'fissa' })
  }

  // 8. il controllo: nessuna sovrapposizione, ne' alla fine ne' in mezzo
  const passi = ordine(runs, tolte)
  const errore = controlla(runs, tolte, passi)
  // ...e la regola dei clear. Una run i cui clear (quelli dentro la sua
  // corsa di prima) finiscono fuori dalla corsa nuova e' "spinta": si
  // scambia (mirror-japan.mjs, solo lei: plan.spinte) se e' chiusa con la
  // fine non nota, non ha clear gia' fuori, e una copia senza clear li
  // contiene tutti (la prima libera nell'ordine degli id, come gli scambi),
  // o, se e' una copia, la run del wiki che comincia dove lei finisce (il
  // rovescio). Una run del wiki spinta che non si puo' scambiare ferma il
  // piano: si rifa' con la sua mossa vietata (evento, sopra). Una copia no:
  // segue la sua finestra, e i clear che restano fuori li conta lo specchio.
  // I divieti si cercano anche quando il piano non si puo' scrivere: una
  // run del wiki con i clear in due repliche vicine, adottata dalla
  // finestra sbagliata, rompeva l'ordine delle scritture, e senza il suo
  // divieto l'evento restava fermo per sempre.
  const finali = runs.filter(viva)
  const spinte = finali.filter((r) => nellaCorsa(r).some((x) => !dentro(x, r)))
    .sort((a, b) => (a.id.length - b.id.length) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const usate = new Set(), ferme = [], scambi = []
  for (const r of spinte) {
    // mai una riga con un clear gia' fuori dalla sua corsa (scelto nel
    // builder su una run chiusa): lo scambio porterebbe la corsa scelta
    // da un'altra parte
    const puo = r.e != null && !r.known && (r.source === 'wiki' || r.source === 'mirror') && suoi(r).every((x) => dentro(x, r.orig))
    const g = puo ? finali.find((o) => o !== r && o.source === 'mirror' && !pinned.has(o.id) && !usate.has(o) && suoi(r).every((x) => dentro(x, o))) : null
    // il rovescio: una copia chiusa dove comincia la run del wiki che contiene i suoi clear
    const v = puo && !g && r.source === 'mirror'
      ? finali.find((o) => o.source === 'wiki' && o.s === r.e && !pinned.has(o.id) && !usate.has(o) && suoi(r).every((x) => dentro(x, o))) : null
    if (g || v) { usate.add(g ?? v); scambi.push(r); continue }
    if (r.orig.source !== 'wiki') continue
    // ferma: le si vieta la mossa che la lasciava fuori
    ferme.push({ id: r.id, mossa: r.op === 'adopt' ? 'copia' : r.op === 'place' ? 'sposta' : 'chiude' })
  }
  if (ferme.length && (!errore || ferme.some(({ id, mossa }) => !fisse.get(id)?.has(mossa)))) return { ferme, blocca: [] }
  if (errore) {
    // Nessun divieto nuovo: le finestre delle due run che si sovrappongono
    // diventano conflitti (come in load-windows, dove la run del gioco che
    // non si sa sistemare ferma la finestra), e il piano si rifa'. Succede
    // quando una finestra e' bloccata (una run del wiki ferma per i clear ci
    // comincia dentro) e la sua copia resta dov'era, mentre la copia della
    // finestra prima si allunga fin li': l'evento restava fermo per sempre.
    const giaFerme = (w) => bloccate.has(w.s) || conflitti.some((c) => c.window && ms(c.window.starts_at) === w.s)
    const blocca = []
    for (const r of errore.coppia.filter(Boolean)) {
      const altra = errore.coppia.find((o) => o && o !== r)
      for (const w of daCopiare) {
        if (giaFerme(w) || blocca.some(([s]) => s === w.s)) continue
        const sua = (r.orig && bersaglio.get(w) === r && copiate.has(r.id)) || (!r.orig && r.op === 'insert' && r.s === w.s && r.e === w.e)
        if (sua) blocca.push([w.s, { id: altra?.id ?? 'nuova', source: altra?.source ?? 'mirror' }])
      }
    }
    if (blocca.length) return { ferme: [], blocca }
    plan.conflict.push(...conflitti, { event_id: ev, why: 'plan', detail: errore.detail })
    plan.skip.push(...salti)
    for (const r of runs) {
      if (r.orig?.source === 'mirror') plan.keep.push({ id: r.id, event_id: ev, ...tratto(r.orig), why: 'conflict' })
    }
    return { ferme: [], blocca: [] }
  }
  for (const r of scambi) plan.spinte.push({ id: r.id, event_id: ev, source: r.source })
  plan.conflict.push(...conflitti)
  plan.skip.push(...salti)
  for (const [w, c] of riunite) plan.fold.push({ id: bersaglio.get(w).id, copy: c.id, event_id: ev })
  for (const [w, r] of scartate) plan.dropWiki.push({ id: r.id, copy: bersaglio.get(w).id, event_id: ev })
  for (const r of strays) plan.dropStray.push({ id: r.id, at: allaData.id, event_id: ev })
  plan.riprese.push(...riprese)
  for (const { r, why } of tieni) plan.keep.push({ id: r.id, event_id: ev, ...tratto(r), why })
  const primaJapan = !runs.some((r) => r.orig)
  for (const p of passi) plan.steps.push(p)
  for (const r of runs) {
    if (r.orig == null) {
      // una copia nuova, o la run del wiki messa alla sua data (passo 6)
      plan[r.op === 'place' ? 'place' : 'insert'].push({ id: null, event_id: ev, source: r.source, ...tratto(r), was: null })
      continue
    }
    if (tolte.has(r.id)) { plan.delete.push({ id: r.id, event_id: ev, source: r.orig.source, ...tratto(r.orig) }); continue }
    if (!cambiata(r)) { if (copiate.has(r.id)) { plan.unchanged++; plan.invariate.push(r.id) } continue }
    plan[r.op].push({ id: r.id, event_id: ev, source: r.source, ...tratto(r), was: { source: r.orig.source, ...tratto(r.orig) } })
  }
  if (primaJapan && plan.insert.some((x) => x.event_id === ev)) plan.firstJapan.push(ev)
  return { ferme: [], blocca: [] }
}

const cambiata = (r) => r.source !== r.orig.source || r.s !== r.orig.s || r.e !== r.orig.e || r.known !== r.orig.known

// L'ordine delle scritture di un evento: prima si toglie, poi si stringe,
// poi si sposta (chi va avanti dall'ultimo, chi va indietro dal primo), poi
// si aggiunge, e per ultimo si allarga (le run del wiki riaperte o tornate).
// Ogni scrittura va quando il suo posto e' libero: se quella dell'ordine
// non ci sta ancora (una run del wiki che si allarga dove una copia tornata
// run del wiki non ha ancora lasciato il posto) va la prima che ci sta.
// Cosi' si trova un ordine ogni volta che c'e': una scrittura che ci sta
// prende il suo posto finale, e i posti finali non si sovrappongono, quindi
// non ferma mai le altre. Se nessuna ci sta, va la prima, e controlla() dice
// perche'. Esportata per japan-mirror-plan.test.mjs.
export function ordine(runs, tolte) {
  const passo = (r, kind) => ({ kind, id: r.id, event_id: r.event_id, source: r.source, ...tratto(r),
                                was: r.orig ? { source: r.orig.source, ...tratto(r.orig) } : null })
  const out = []
  for (const r of runs) if (r.orig && tolte.has(r.id)) out.push({ kind: 'delete', id: r.id, event_id: r.event_id, was: { source: r.orig.source, ...tratto(r.orig) } })
  const vive = runs.filter((r) => r.orig && !tolte.has(r.id) && cambiata(r))
  const dentro = (r) => r.s >= r.orig.s && fine(r) <= fine(r.orig)
  const ultime = (r) => r.op === 'reopen' || r.op === 'restore'
  const sposta = vive.filter((r) => !ultime(r) && !dentro(r))
  const voluto = [
    ...vive.filter((r) => !ultime(r) && dentro(r)).map((r) => [r, 'update']),
    ...sposta.filter((r) => r.s > r.orig.s).sort((a, b) => b.s - a.s).map((r) => [r, 'update']),
    ...sposta.filter((r) => r.s <= r.orig.s).sort((a, b) => a.s - b.s).map((r) => [r, 'update']),
    ...runs.filter((r) => !r.orig && !tolte.has(r.id)).sort((a, b) => a.s - b.s).map((r) => [r, 'insert']),
    ...vive.filter(ultime).sort((a, b) => a.s - b.s).map((r) => [r, 'update']),
  ]
  // dove sta ogni run mentre si scrive: all'inizio dov'era
  const posto = new Map(runs.filter((r) => r.orig && !tolte.has(r.id)).map((r) => [r, { s: r.orig.s, e: r.orig.e }]))
  const ciSta = (r) => ![...posto].some(([o, y]) => o !== r && sovrapposte(r, y))
  let resto = voluto
  while (resto.length) {
    const i = Math.max(0, resto.findIndex(([r]) => ciSta(r)))
    const [r, kind] = resto[i]
    out.push(passo(r, kind))
    posto.set(r, { s: r.s, e: r.e })
    resto = resto.filter((_, k) => k !== i)
  }
  return out
}

// Rifa' le scritture su una copia: torna il primo problema, o null. Il
// problema e' { detail, coppia }: le due run che si sovrappongono (quelle
// che si trovano), per bloccare le loro finestre e rifare il piano.
function controlla(runs, tolte, passi) {
  const valida = (r) => r.e == null || r.e > r.s
  const finali = runs.filter((r) => !tolte.has(r.id))
  for (const r of finali) if (!valida(r)) return { detail: `run ${r.id ?? 'nuova'}: fine non dopo l'inizio`, coppia: [r] }
  for (let i = 0; i < finali.length; i++) {
    for (let j = i + 1; j < finali.length; j++) {
      if (sovrapposte(finali[i], finali[j])) {
        return { detail: `run ${finali[i].id ?? 'nuova'} e ${finali[j].id ?? 'nuova'} si sovrappongono`, coppia: [finali[i], finali[j]] }
      }
    }
  }
  const stato = new Map(runs.filter((r) => r.orig).map((r) => [r.id, { s: r.orig.s, e: r.orig.e }]))
  const run = (k, p) => (p ? finali.find((r) => !r.orig && r.s === ms(p.starts_at) && r.e === ms(p.ends_at)) : runs.find((r) => r.id === k))
  const nuove = new Map()
  for (const p of passi) {
    if (p.kind === 'delete') { stato.delete(p.id); continue }
    const k = p.kind === 'insert' ? `nuova ${nuove.size + 1}` : p.id
    if (p.kind === 'insert') nuove.set(k, p)
    const x = { s: ms(p.starts_at), e: ms(p.ends_at) }
    for (const [id, y] of stato) {
      if (id !== k && sovrapposte(x, y)) {
        return { detail: `l'ordine delle scritture sovrappone ${k} a ${id}`, coppia: [run(k, nuove.get(k)), run(id, nuove.get(id))] }
      }
    }
    stato.set(k, x)
  }
  return null
}

/**
 * Le uscite Japan delle carte, per le carte uscite su Global da D senza una
 * data Japan: lo stesso giorno, sul calendario giapponese (D e' il
 * 2025-01-01 giapponese, le date sono giorni). Una data Japan del wiki (o a
 * mano) non si tocca mai; quelle dello specchio si ricalcolano, e si
 * tolgono quando la regola non le vuole piu'.
 *
 * Il giorno giapponese. Per una carta del wiki la data Global e' un giorno e
 * resta quello. Per una carta che solo il gioco conosce (source 'game')
 * load-game-cards scrive il giorno UTC di open_at, e un'uscita dalle 15:00
 * UTC in poi e' gia' il giorno dopo a Tokyo (il lotto del decimo
 * anniversario giapponese, 2025-01-28 alle 21:00 UTC: sul wiki JP 29 Jan
 * 2025). openAt da' l'istante del gioco: se e' di quel giorno UTC, il giorno
 * Japan e' il suo giorno giapponese; se no (il datamine e il database non
 * vanno insieme) resta il giorno Global.
 * Le date sono stringhe 'YYYY-MM-DD' (released_at::text).
 *
 * @param {{ globalReleases: { card_id: string | number, released_at: string | null, source?: string }[],
 *           japanReleases: { card_id: string | number, released_at: string | null, source: string }[],
 *           openAt?: Map<number, Date | string>,
 *           rules: import('./rules.mjs').Rules }} input
 *   openAt  carta -> open_at del datamine (UTC), per le carte del gioco
 */
export function planCardMirror({ globalReleases, japanReleases, openAt = new Map(), rules }) {
  const giorno = japanDay(rules.since)
  const solo = new Map(rules.globalOnlyCards.map((c) => [Number(c.card), c.why]))
  const jp = new Map(japanReleases.map((r) => [Number(r.card_id), r]))
  const out = { since: giorno, insert: [], update: [], delete: [], skip: [], excluded: [], shifted: [], unchanged: 0 }
  const volute = new Set()
  for (const g of globalReleases) {
    const id = Number(g.card_id)
    const t = g.source === 'game' ? openAt.get(id) : null
    const d = t != null && g.released_at != null && new Date(t).toISOString().slice(0, 10) === g.released_at
      ? japanDay(t) : g.released_at
    if (d == null || d < giorno) continue
    if (solo.has(id)) { out.excluded.push({ card_id: id, released_at: d, why: solo.get(id) }); continue }
    const j = jp.get(id)
    if (j && j.source !== 'mirror') { out.skip.push({ card_id: id, released_at: d, japan: j.released_at, source: j.source }); continue }
    volute.add(id)
    // il giorno giapponese e' quello dopo il giorno Global (dalle 15:00 UTC)
    if (d !== g.released_at) out.shifted.push({ card_id: id, global: g.released_at, japan: d })
    if (!j) out.insert.push({ card_id: id, released_at: d })
    else if (j.released_at !== d) out.update.push({ card_id: id, released_at: d, was: j.released_at })
    else out.unchanged++
  }
  for (const j of japanReleases) {
    if (j.source === 'mirror' && !volute.has(Number(j.card_id))) out.delete.push({ card_id: Number(j.card_id), released_at: j.released_at })
  }
  return out
}
