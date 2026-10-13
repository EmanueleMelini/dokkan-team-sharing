// I menu a scelta (lib/scelta.ts, components/scelta): il combobox di
// Headless UI che ha preso il posto di ogni <select> del sito.
//
//   - la ricerca: maiuscole, accenti, lettere a tutta larghezza, nomi con
//     un a capo, parole in qualsiasi ordine, anche nel dettaglio e fra le
//     parole nascoste e mai nella nota, prima chi comincia con la parola,
//     la lista stessa senza ricerca, "No results";
//   - i valori e i testi: per ogni menu (i sei dei filtri, routes, run,
//     lingua, prova, grado, il picker, i temi) testoNativo e' il testo
//     dell'<option> di prima, parola per parola; valoreScelto, la voce
//     mostrata, valori unici;
//   - scegliere e poi scrivere di nuovo (ricercaScritta): il primo tasto
//     sostituisce la voce mostrata anche senza selezione;
//   - Invio e Tab scelgono solo una voce raggiunta con le frecce o con
//     una ricerca (voceMossa, sceltaDaTasto): Backspace e poi Tab lasciano
//     il valore di prima, anche nella run del builder;
//   - la regione live e le soglie (niente tastiera, elenco virtuale);
//   - dove si apre l'elenco (posizionePannello): sotto, sopra, la tastiera
//     del telefono, il bordo destro, 320px, un dialog, almeno una riga,
//     l'invito a installare l'app fisso in fondo (sopraLeCoperture);
//   - i contrasti delle classi del menu in tutti gli 11 temi;
//   - la guardia: nessun <select> (ne' <option> fuori da un <datalist>)
//     in components/ e app/ fuori da components/scelta/scelta-nativa.tsx,
//     letto col parser di TypeScript, con la controprova;
//   - le guardie su dipendenze e struttura (Headless solo in un file e
//     solo con import(), la versione esatta, i name del form dei filtri,
//     le etichette, modal e anchor, il <select> per chi non ha JavaScript,
//     i bersagli col dito, i colori forzati, Invio a elenco chiuso);
//   - i campi accanto ai menu, alti uguali col dito (CAMPO_DITO);
//   - il segno del focus dei filtri col verso del Tab (fuoco-filtri.ts).
//
// Funzioni pure e file, niente database.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import type * as TS from 'typescript'
import {
  ALTEZZA_MAX, MARGINE, RIGA_MOUSE, RIGA_TOCCO, RIGHE_MIN, SOGLIA_TASTIERA, SOGLIA_VIRTUALE, STACCO,
  annuncioRisultati, filtraOpzioni, normalizza, posizionePannello, ricercaScritta, sceltaDaTasto, sceltaVisibile, sopraLeCoperture, testoCampo,
  testoNativo, valoreScelto, voceMossa,
  type Gesto, type Opzione, type Riquadro,
} from '@/lib/scelta'
import {
  CLASSI, OPZIONI_ORDINE, nomeCarta, opzioniCategoria, opzioniClasse, opzioniLeader, opzioniMono, opzioniTurni,
} from '@/lib/clears/filtri-opzioni'
import {
  OPZIONI_GRADO, OPZIONI_LINGUA, OPZIONI_PICKER_CLASSE, OPZIONI_PICKER_RARITA, OPZIONI_PICKER_TIPO, OPZIONI_PROVA,
  OPZIONI_ROUTES, opzioniPickerCategoria, opzioniRun,
} from '@/lib/clears/builder-opzioni'
import { ETICHETTA_ORDINE, ORDINI, SCELTE_TURNI, TIPI, parametriFiltri, VUOTI } from '@/lib/clears/filtri'
import { GRADI, nomeRoutes } from '@/lib/clears/build'
import { OPZIONI_TEMA, TEMI } from '@/lib/tema/temi'
import * as STILE from '@/components/scelta/stile'
import type { OpzioneCarta } from '@/components/clears/scegli-carta'
import { lasciaSegno, prendiSegno } from '@/components/clears/fuoco-filtri'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}
const mostra = (v: unknown) => JSON.stringify(v) ?? String(v)
function vale<T>(nome: string, got: T, atteso: T) {
  const ok = mostra(got) === mostra(atteso)
  check(nome, ok, `= ${mostra(got)}${ok ? '' : `, atteso ${mostra(atteso)}`}`)
}
const file = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const richiedi = createRequire(import.meta.url)
const ts = richiedi('typescript') as typeof TS

const o = (valore: string, testo: string, resto: Partial<Opzione> = {}): Opzione => ({ valore, testo, ...resto })
const testi = (l: readonly Opzione[]) => l.map((x) => x.testo)

// ---------------------------------------------------------------------
//  La ricerca
// ---------------------------------------------------------------------

function ricerca() {
  console.log('\n  -- la ricerca')
  vale('normalizza: accenti e maiuscole', normalizza('  Végéta  SUPER\tSaiyan '), 'vegeta super saiyan')
  vale('normalizza: lettere a tutta larghezza', normalizza('Ｇｏｋｕ'), 'goku')
  vale('normalizza: un nome con l\'a capo e spazi doppi', normalizza('Super Saiyan\nGoku  (Angel)'), 'super saiyan goku (angel)')

  const carte = [
    o('1', 'Végéta', { dettaglio: 'Prince of Saiyans', nota: '12' }),
    o('2', 'Super Saiyan\nGoku', { dettaglio: 'Ultra Instinct' }),
    o('3', 'Gohan', { dettaglio: 'Dragon of Hope', cerca: 'mystic' }),
    o('4', 'Nuova Shenron', { dettaglio: 'Shadow Dragon' }),
    o('5', 'Goku Black', { nota: '0 here' }),
    o('6', 'Ｖｅｇｅｔｏ'),
  ]
  vale('senza accenti e minuscole: "vegeta" trova Végéta', testi(filtraOpzioni(carte, 'VEGETA')), ['Végéta'])
  vale('con l\'accento scritto: "végéta" trova lo stesso', testi(filtraOpzioni(carte, 'végéta')), ['Végéta'])
  vale('le lettere a tutta larghezza: "vegeto" trova Ｖｅｇｅｔｏ', testi(filtraOpzioni(carte, 'vegeto')), ['Ｖｅｇｅｔｏ'])
  vale('un nome con l\'a capo: "saiyan goku" lo trova', testi(filtraOpzioni(carte, 'saiyan goku')), ['Super Saiyan\nGoku'])
  vale('le parole in qualsiasi ordine', testi(filtraOpzioni(carte, 'goku super')), ['Super Saiyan\nGoku'])
  vale('anche nel dettaglio', testi(filtraOpzioni(carte, 'instinct')), ['Super Saiyan\nGoku'])
  vale('anche fra le parole nascoste', testi(filtraOpzioni(carte, 'mystic')), ['Gohan'])
  vale('mai nella nota: "12" non trova chi e\' contato 12', testi(filtraOpzioni(carte, '12')), [])
  vale('mai nella nota: "here" non trova "0 here"', testi(filtraOpzioni(carte, 'here')), [])
  // "go": Goku e Gohan cominciano con "go", Dragon lo ha dentro. Le prime
  // nell'ordine della lista, poi le altre, anche loro in ordine.
  vale('prima chi comincia con la parola, poi gli altri, ognuno nel suo ordine',
    testi(filtraOpzioni(carte, 'go')), ['Super Saiyan\nGoku', 'Gohan', 'Goku Black', 'Nuova Shenron'])
  vale('l\'inizio di una parola anche dopo una parentesi', testi(filtraOpzioni([o('a', 'Xangel'), o('b', 'Goku (Angel)')], 'angel')),
    ['Goku (Angel)', 'Xangel'])
  check('senza ricerca: la lista stessa (lo stesso array)', filtraOpzioni(carte, '') === carte && filtraOpzioni(carte, '   ') === carte)
  vale('niente che corrisponde: lista vuota', filtraOpzioni(carte, 'zzz').length, 0)
  vale('"No results" quando non resta niente', annuncioRisultati(filtraOpzioni(carte, 'zzz').length, 'zzz'), 'No results')
}

// ---------------------------------------------------------------------
//  I valori e i testi, menu per menu
// ---------------------------------------------------------------------

// I testi dell'<option> di prima, come li scrivevano i componenti al commit
// 35438c0 (components/clears/filtri-clear.tsx, components/builder/*,
// components/tema/scelta-tema-footer.tsx).
const conta = (n: number) => (n > 0 ? ` (${n})` : ' (0 here)')
const primaLeader = (c: Pick<OpzioneCarta, 'id' | 'name' | 'epithet' | 'n'>) =>
  `${c.name ?? `Card ${c.id}`}${c.epithet ? `, ${c.epithet}` : ''}${conta(c.n)}`

const carta = (id: string, name: string | null, epithet: string | null, n: number): OpzioneCarta =>
  ({ id, name, epithet, type: 'AGL', class: 'Super', thumb: null, bare: false, n })

function valori() {
  console.log('\n  -- i testi dei menu dei filtri, come gli <option> di prima')
  const turni = opzioniTurni(null)
  vale('Max turns: Any e le scelte fisse', turni.map(testoNativo), ['Any', ...SCELTE_TURNI.map((n) => `${n} or fewer`)])
  vale('Max turns: i valori', turni.map((x) => x.valore), ['', ...SCELTE_TURNI.map(String)])
  vale('Max turns: un valore dell\'URL fuori dalle scelte entra in ordine', opzioniTurni(4).map((x) => x.valore),
    ['', '3', '4', '5', '7', '10', '15', '20'])
  vale('Max turns: uno gia\' fra le scelte non si ripete', opzioniTurni(5).length, SCELTE_TURNI.length + 1)

  const leaders = [carta('1031840', 'Goku', 'Ultra Instinct', 12), carta('1032000', 'Vegeta', null, 1),
    carta('1032001', null, null, 3), carta('1032002', 'Gohan', '', 0)]
  const vl = opzioniLeader(null, leaders, {})
  vale('Leader: con e senza epiteto, senza nome, con 0', vl.map(testoNativo), ['Any leader', ...leaders.map(primaLeader)])
  vale('Leader: i valori sono gli id', vl.map((x) => x.valore), ['', '1031840', '1032000', '1032001', '1032002'])
  vale('Leader: il campo mostra nome ed epiteto, senza il conteggio', testoCampo(vl[1]), 'Goku, Ultra Instinct')
  vale('Leader: il conteggio per i lettori di schermo', [vl[1].notaSr, vl[2].notaSr, vl[4].notaSr], ['12 clears', '1 clear', undefined])
  const fuori = opzioniLeader('1039999', leaders, { 1039999: 'Broly' })
  vale('Leader: quello dell\'URL che qui nessuno usa, subito dopo Any', [fuori[1].valore, testoNativo(fuori[1])], ['1039999', 'Broly (0 here)'])
  vale('Leader: senza nome, "Card <id>"', testoNativo(opzioniLeader('1039998', leaders, {})[1]), 'Card 1039998 (0 here)')
  vale('Leader: uno dell\'URL che c\'e\' non si ripete', opzioniLeader('1032000', leaders, {}).length, leaders.length + 1)
  vale('nomeCarta come prima', [nomeCarta({ id: '9', name: null }), nomeCarta({ id: '9', name: 'X' })], ['Card 9', 'X'])

  const tipi = [{ id: 'AGL' as const, n: 4 }, { id: 'PHY' as const, n: 1 }]
  const vm = opzioniMono('INT', tipi)
  vale('Type: Mono <tipo> e i conteggi, nell\'ordine dei tipi', vm.map(testoNativo),
    ['Any type', 'Mono AGL (4)', 'Mono INT (0 here)', 'Mono PHY (1)'])
  vale('Type: i valori e il quadratino del tipo', vm.map((x) => [x.valore, x.tipo ?? null]),
    [['', null], ['AGL', 'AGL'], ['INT', 'INT'], ['PHY', 'PHY']])

  const classi = [{ id: 'Extreme' as const, n: 2 }]
  const vc = opzioniClasse('Super', classi)
  vale('Class: il testo di prima', vc.map(testoNativo), ['Any class', 'All Super (0 here)', 'All Extreme (2)'])
  vale('Class: il valore e\' quello dell\'URL', vc.map((x) => x.valore), ['', 'super', 'extreme'])
  vale('Class: CLASSI come in lib/clears/filtri.ts', CLASSI.map((c) => [c.id, c.url]), [['Super', 'super'], ['Extreme', 'extreme']])

  const categorie = [{ id: 5, name: 'Pure Saiyans', n: 7 }, { id: 11, name: 'Fusion', n: 0 }]
  vale('Category: il testo di prima', opzioniCategoria(null, categorie).map(testoNativo),
    ['Any category', 'Pure Saiyans (7)', 'Fusion (0 here)'])
  vale('Category: quella dell\'URL che qui non c\'e\'', opzioniCategoria(42, categorie).slice(0, 2).map((x) => [x.valore, testoNativo(x)]),
    [['', 'Any category'], ['42', 'Category 42 (0 here)']])
  vale('Category: i valori sono gli id', opzioniCategoria(5, categorie).map((x) => x.valore), ['', '5', '11'])

  vale('Sort: Top, Newest, Fewest turns', OPZIONI_ORDINE.map((x) => [x.valore, testoNativo(x)]),
    ORDINI.map((k) => [k, ETICHETTA_ORDINE[k]]))

  // I name=value del form GET: per ogni menu il valore e' quello che
  // parametriFiltri scrive nell'URL per la stessa scelta.
  const f = { ...VUOTI, cards: [], turns: 7, leader: '1031840', mono: 'AGL' as const, cls: 'Extreme' as const, cat: 5, sort: 'new' as const }
  const url = new Map(parametriFiltri(f))
  vale('i valori dei menu sono quelli dell\'URL', [
    opzioniTurni(f.turns).find((x) => x.valore === url.get('turns'))?.valore,
    vl.find((x) => x.valore === url.get('leader'))?.valore,
    vm.find((x) => x.valore === url.get('mono'))?.valore,
    vc.find((x) => x.valore === url.get('class'))?.valore,
    opzioniCategoria(5, categorie).find((x) => x.valore === url.get('cat'))?.valore,
    OPZIONI_ORDINE.find((x) => x.valore === url.get('sort'))?.valore,
  ], ['7', '1031840', 'AGL', 'extreme', '5', 'new'])

  console.log('\n  -- i testi dei menu del builder e del footer')
  vale('Hidden Potential: Not set e i percorsi', OPZIONI_ROUTES.map((x) => [x.valore, testoNativo(x)]),
    [['', 'Not set'], ...[0, 1, 2, 3, 4].map((n) => [String(n), nomeRoutes(n)])])
  vale('Grade: Any, Gold, Silver, Bronze', OPZIONI_GRADO.map((x) => [x.valore, testoNativo(x)]),
    [['', 'Any'], ['3', GRADI[3]], ['2', GRADI[2]], ['1', GRADI[1]]])
  vale('Grade: i nomi di sempre', OPZIONI_GRADO.map(testoNativo), ['Any', 'Gold', 'Silver', 'Bronze'])
  vale('Kind: Video e Screenshot', OPZIONI_PROVA.map((x) => [x.valore, testoNativo(x)]), [['video', 'Video'], ['screenshot', 'Screenshot']])
  vale('Written in: English e Japanese', OPZIONI_LINGUA.map((x) => [x.valore, testoNativo(x)]), [['en', 'English'], ['ja', 'Japanese']])
  const runs = [{ id: '88', label: 'Oct 2026 (Global)' }, { id: '87', label: 'Jun 2025' }]
  vale('When you cleared it: id e testo delle run', opzioniRun(runs).map((x) => [x.valore, testoNativo(x)]), runs.map((r) => [r.id, r.label]))
  vale('picker: Type, Class, Rarity', [OPZIONI_PICKER_TIPO, OPZIONI_PICKER_CLASSE, OPZIONI_PICKER_RARITA].map((l) => l.map(testoNativo)), [
    ['Any type', 'AGL', 'TEQ', 'INT', 'STR', 'PHY'], ['Any class', 'Super', 'Extreme'], ['Any rarity', 'LR', 'UR', 'SSR', 'SR', 'R', 'N'],
  ])
  vale('picker: i tipi col quadratino', OPZIONI_PICKER_TIPO.slice(1).map((x) => x.tipo), [...TIPI])
  vale('picker: Category', opzioniPickerCategoria([{ id: 3, name: 'Kamehameha' }]).map((x) => [x.valore, testoNativo(x)]),
    [['', 'Any category'], ['3', 'Kamehameha']])
  vale('Theme: gli 11 temi, id e nome', OPZIONI_TEMA.map((x) => [x.valore, testoNativo(x)]), TEMI.map((t) => [t.id, t.label]))

  const tutte: [string, readonly Opzione[]][] = [
    ['turns', opzioniTurni(4)], ['leader', fuori], ['mono', vm], ['class', vc], ['cat', opzioniCategoria(42, categorie)],
    ['sort', OPZIONI_ORDINE], ['routes', OPZIONI_ROUTES], ['grade', OPZIONI_GRADO], ['kind', OPZIONI_PROVA], ['lang', OPZIONI_LINGUA],
    ['run', opzioniRun(runs)], ['picker', OPZIONI_PICKER_TIPO], ['theme', OPZIONI_TEMA],
  ]
  const doppi = tutte.filter(([, l]) => new Set(l.map((x) => x.valore)).size !== l.length).map(([n]) => n)
  check('ogni menu ha valori unici', doppi.length === 0, doppi.join())

  console.log('\n  -- la scelta')
  const l = [o('', 'Any'), o('a', 'A'), o('b', 'B')]
  vale('valoreScelto: null (il campo svuotato per scrivere) non arriva', valoreScelto(null, 'a', l), null)
  vale('valoreScelto: undefined nemmeno', valoreScelto(undefined, 'a', l), null)
  vale('valoreScelto: lo stesso valore non arriva', valoreScelto('a', 'a', l), null)
  vale('valoreScelto: un valore che non e\' fra le opzioni no', valoreScelto('zz', 'a', l), null)
  vale('valoreScelto: un\'altra voce si', valoreScelto('b', 'a', l), 'b')
  vale('valoreScelto: "" quando c\'e\' una voce vuota (Any)', valoreScelto('', 'a', l), '')
  vale('valoreScelto: "" senza una voce vuota no', valoreScelto('', 'en', OPZIONI_LINGUA), null)
  vale('sceltaVisibile: la voce del valore', sceltaVisibile(l, 'b')?.testo, 'B')
  vale('sceltaVisibile: un valore sconosciuto mostra la prima, come un <select>', sceltaVisibile(OPZIONI_LINGUA, '')?.testo, 'English')
  vale('sceltaVisibile: lista vuota', sceltaVisibile([], 'x'), undefined)
  vale('testoCampo: gli spazi come un <option>', testoCampo(o('1', 'Super Saiyan\n Goku', { dettaglio: ' Angel  ' })), 'Super Saiyan Goku, Angel')

  console.log('\n  -- scegliere, poi scrivere di nuovo (ricercaScritta)')
  // Il campo mostra la voce scelta; il primo tasto deve dare una ricerca
  // vera, con o senza la selezione del testo
  const vegeta = 'Vegeta, Pride of the Saiyan Prince'
  vale('scelto Vegeta, il testo selezionato: "f" lo sostituisce', ricercaScritta('f', vegeta, true, false), 'f')
  vale('scelto Vegeta, il cursore in fondo: "fri" non va in coda', ricercaScritta(`${vegeta}fri`, vegeta, true, false), 'fri')
  vale('dopo Esc su Any leader: "f" in coda conta da solo', ricercaScritta('Any leaderf', 'Any leader', true, false), 'f')
  vale('incollato in fondo', ricercaScritta('Not setRainbow', 'Not set', true, false), 'Rainbow')
  vale('il primo Backspace svuota (non "Any leade")', ricercaScritta('Any leade', 'Any leader', true, true), '')
  vale('anche col testo selezionato', ricercaScritta('', 'Any leader', true, true), '')
  vale('da quando si scrive, il testo e\' quello scritto', ricercaScritta('Any leaderfri', 'Any leader', false, false), 'Any leaderfri')
  vale('e Backspace toglie una lettera', ricercaScritta('fr', 'Any leader', false, true), 'fr')
  vale('un tasto in mezzo al testo resta com\'e\'', ricercaScritta('Any lxeader', 'Any leader', true, false), 'Any lxeader')
  vale('senza voce mostrata niente da togliere', ricercaScritta('abc', '', true, false), 'abc')
  // la catena intera: scegli, scrivi, scegli di nuovo, scrivi di nuovo
  const leader = [o('', 'Any leader'), o('1001', 'Vegeta', { dettaglio: 'Pride of the Saiyan Prince' }),
    o('1002', 'Frieza (Final Form)', { dettaglio: 'Supreme Ruler\'s Vicious Power' })]
  const primo = filtraOpzioni(leader, ricercaScritta('Any leaderveg', 'Any leader', true, false))
  const dopo = testoCampo(primo[0])
  const secondo = filtraOpzioni(leader, ricercaScritta(`${dopo}fri`, dopo, true, false))
  vale('scegli Vegeta, poi "fri" trova Frieza (non "No results")', [primo[0]?.valore, secondo.map((x) => x.valore)], ['1001', ['1002']])
}

// ---------------------------------------------------------------------
//  Invio e Tab: solo una scelta vera
// ---------------------------------------------------------------------

/**
 * Un giro nel menu come lo fa scelta-elenco.tsx: voceMossa a ogni tasto e
 * a ogni ricerca, poi Invio o Tab a elenco aperto, con la voce che Headless
 * UI ha attiva in quel momento (attiva). Torna cio' che arriva al
 * chiamante: null, il valore resta quello.
 */
function giro(opzioni: readonly Opzione[], valore: string, gesti: Gesto[], ricerca: string | null, attiva: string): string | null {
  const mossa = gesti.reduce((m, g) => voceMossa(m, g), false)
  return sceltaDaTasto(mossa, ricerca) ? valoreScelto(attiva, valore, opzioni) : null
}
const apri = (tasto = 'ArrowDown'): Gesto => ({ tasto, aperto: false })
const freccia = (tasto = 'ArrowDown'): Gesto => ({ tasto, aperto: true })
const cerca = (ricerca: string): Gesto => ({ ricerca })

function inviaETab() {
  console.log('\n  -- Invio e Tab scelgono solo una voce raggiunta (voceMossa, sceltaDaTasto)')
  vale('le frecce spostano, anche quella che apre l\'elenco', [voceMossa(false, apri()), voceMossa(false, apri('ArrowUp')),
    voceMossa(false, freccia('ArrowUp'))], [true, true, true])
  vale('Home, End, PagSu, PagGiu solo a elenco aperto (chiuso muovono il cursore)', [
    voceMossa(false, apri('Home')), voceMossa(false, apri('End')), voceMossa(false, apri('PageDown')),
    voceMossa(false, freccia('Home')), voceMossa(false, freccia('End')), voceMossa(false, freccia('PageUp')),
  ], [false, false, false, true, true, true])
  vale('Maiuscolo+Home e Maiuscolo+End selezionano il testo: niente', [voceMossa(false, { tasto: 'Home', aperto: true, shift: true }),
    voceMossa(false, { tasto: 'End', aperto: true, shift: true })], [false, false])
  vale('le lettere, Backspace, Tab, Invio non spostano niente', ['a', 'Backspace', 'Tab', 'Enter', 'Escape']
    .map((t) => [voceMossa(false, freccia(t)), voceMossa(true, freccia(t))]), Array(5).fill([false, true]))
  vale('svuotare il campo (anche solo spazi) e chiudere l\'elenco ricominciano', [voceMossa(true, cerca('')), voceMossa(true, cerca('  ')),
    voceMossa(true, { chiuso: true }), voceMossa(true, cerca('fri'))], [false, false, false, true])
  vale('sceltaDaTasto: le frecce, o una ricerca scritta', [sceltaDaTasto(false, null), sceltaDaTasto(false, ''), sceltaDaTasto(false, ' '),
    sceltaDaTasto(false, 'fri'), sceltaDaTasto(true, null), sceltaDaTasto(true, '')], [false, false, false, true, true, true])

  // La run del builder (When you cleared it), come nel caso trovato: la
  // prima voce e' la run in corso, scelta quella di marzo. Dopo un
  // Backspace che svuota il campo Headless evidenzia la prima.
  const runs = opzioniRun([{ id: '2', label: 'Running now, since October 10, 2026' }, { id: '1', label: 'March 27 to April 9, 2026' }])
  const marzo = testoCampo(runs[1])
  const svuota = cerca(ricercaScritta('', marzo, true, true))
  vale('run: Backspace sulla voce mostrata svuota il campo', svuota, { ricerca: '' })
  vale('run: freccia giu\' (apre), Backspace, Tab: resta marzo', giro(runs, '1', [apri(), svuota], '', '2'), null)
  vale('run: un clic apre, Backspace, Tab: resta marzo', giro(runs, '1', [svuota], '', '2'), null)
  vale('run: frecce, poi Backspace, poi Tab: resta marzo', giro(runs, '1', [apri(), freccia('ArrowUp'), svuota], '', '2'), null)
  vale('run: scritto "run", cancellato tutto, Tab: resta marzo', giro(runs, '1', [cerca('run'), cerca('')], '', '2'), null)
  vale('run: Tab da solo a elenco aperto (la voce attiva e\' quella scelta): resta marzo', giro(runs, '1', [], null, '1'), null)
  vale('run: freccia su a elenco aperto, Tab: la run in corso', giro(runs, '1', [apri(), freccia('ArrowUp')], null, '2'), '2')
  vale('run: dopo Backspace, freccia su e Tab: la run in corso', giro(runs, '1', [apri(), svuota, freccia('ArrowUp')], '', '2'), '2')
  vale('run: scritto "running" (la prima trovata), Tab: la run in corso', giro(runs, '1', [cerca('running')], 'running', '2'), '2')

  // Gli altri menu: il Leader dei filtri (cambiarlo porta a un altro URL), il tema del footer
  const leader = opzioniLeader('1001', [carta('1001', 'Vegeta', null, 3), carta('1002', 'Frieza', null, 1)], {})
  vale('Leader: Backspace e Tab non tornano ad Any leader',
    giro(leader, '1001', [svuota], '', ''), null)
  vale('Leader: freccia e Invio si', giro(leader, '1001', [apri(), freccia()], null, '1002'), '1002')
  const oled = OPZIONI_TEMA.find((x) => x.valore === 'oled')
  vale('tema: OLED, poi freccia giu\', Backspace, Tab: non torna System (la prima voce)',
    giro(OPZIONI_TEMA, 'oled', [apri(), cerca(ricercaScritta('', oled ? testoCampo(oled) : '', true, true))], '', OPZIONI_TEMA[0].valore), null)
}

// ---------------------------------------------------------------------
//  La regione live e le soglie
// ---------------------------------------------------------------------

function annunciEsoglie() {
  console.log('\n  -- la regione live e le soglie')
  vale('annuncioRisultati', [annuncioRisultati(5, ''), annuncioRisultati(0, ' '), annuncioRisultati(0, 'x'), annuncioRisultati(1, 'x'),
    annuncioRisultati(12, 'x')], ['', '', 'No results', '1 result', '12 results'])
  check('nessun trattino lungo nei testi', ![annuncioRisultati(0, 'x'), annuncioRisultati(1, 'x'), annuncioRisultati(2, 'x')]
    .some((t) => /[\u2013\u2014]/.test(t)))
  vale('le soglie: tastiera oltre 12, virtuale oltre 50', [SOGLIA_TASTIERA, SOGLIA_VIRTUALE], [12, 50])
  vale('le misure: 288px, 4 righe, 8px, righe da 44 e 32', [ALTEZZA_MAX, RIGHE_MIN, MARGINE, RIGA_TOCCO, RIGA_MOUSE], [288, 4, 8, 44, 32])
  const elenco = file('components/scelta/scelta-elenco.tsx')
  check('niente tastiera fino a SOGLIA_TASTIERA voci (inputMode none)',
    /const lunga = opzioni\.length > SOGLIA_TASTIERA/.test(elenco) && /inputMode=\{lunga \? undefined : 'none'\}/.test(elenco))
  check('l\'elenco e\' virtuale oltre SOGLIA_VIRTUALE voci', /const virtuale = opzioni\.length > SOGLIA_VIRTUALE/.test(elenco) &&
    /virtual=\{virtual\}/.test(elenco))
  vale('chi non ha la tastiera: temi, grado, routes, i filtri corti', [OPZIONI_TEMA, OPZIONI_GRADO, OPZIONI_ROUTES, OPZIONI_ORDINE, opzioniTurni(null)]
    .map((l) => l.length <= SOGLIA_TASTIERA), [true, true, true, true, true])
}

// ---------------------------------------------------------------------
//  Dove si apre l'elenco
// ---------------------------------------------------------------------

const vista = (w: number, h: number): Riquadro => ({ top: 0, left: 0, right: w, bottom: h })
const riquadro = (left: number, top: number, w: number, h: number): Riquadro => ({ left, top, right: left + w, bottom: top + h })
/** Dove sta davvero il pannello: largo quanto vuole, mai meno del campo, mai oltre larghezzaMax (vince il minimo, come nel CSS). */
function estensione(campo: Riquadro, larghezza: number, lato: 'sinistra' | 'destra', max: number): [number, number] {
  const w = Math.max(campo.right - campo.left, Math.min(larghezza, max))
  return lato === 'sinistra' ? [campo.left, campo.left + w] : [campo.right - w, campo.right]
}

function posizione() {
  console.log('\n  -- dove si apre l\'elenco')
  const telefono = vista(375, 667)
  const p1 = posizionePannello({ campo: riquadro(20, 120, 335, 44), limite: telefono, larghezza: 335 })
  vale('posto sotto: sotto, alto al massimo 288', [p1.verso, p1.altezzaMax, p1.scorri], ['giu', ALTEZZA_MAX, false])
  const p2 = posizionePannello({ campo: riquadro(20, 590, 335, 44), limite: telefono, larghezza: 335 })
  vale('in fondo alla pagina: sopra', [p2.verso, p2.scorri], ['su', false])
  vale('sopra: lo spazio che c\'e\', meno margine e stacco', p2.altezzaMax, Math.min(ALTEZZA_MAX, 590 - MARGINE - STACCO))
  // La tastiera di un telefono: il visualViewport e' alto 380 su 667
  const tastiera = vista(375, 380)
  const p3 = posizionePannello({ campo: riquadro(20, 168, 335, 44), limite: tastiera, larghezza: 335 })
  vale('la tastiera lascia meno di 4 righe sopra e sotto: il campo sale', [p3.scorri, p3.altezzaMax >= RIGA_TOCCO], [true, true])
  const p3b = posizionePannello({ campo: riquadro(20, 8, 335, 44), limite: tastiera, larghezza: 335 })
  vale('salito in cima: sotto, nello spazio sopra la tastiera', [p3b.verso, p3b.scorri, p3b.altezzaMax],
    ['giu', false, Math.min(ALTEZZA_MAX, 380 - 52 - MARGINE - STACCO)])
  const corto = posizionePannello({ campo: riquadro(20, 168, 335, 44), limite: tastiera, larghezza: 335, altezza: 90 })
  vale('un elenco corto che ci sta non fa salire niente', [corto.verso, corto.scorri], ['giu', false])

  const p4 = posizionePannello({ campo: riquadro(240, 100, 115, 44), limite: telefono, larghezza: 300 })
  vale('vicino al bordo destro (Sort): allineato a destra', [p4.lato, p4.larghezzaMax], ['destra', 355 - MARGINE])
  const p5 = posizionePannello({ campo: riquadro(20, 100, 140, 44), limite: telefono, larghezza: 300 })
  vale('a sinistra ci sta: allineato a sinistra', [p5.lato, p5.larghezzaMax], ['sinistra', 375 - MARGINE - 20])

  const stretto = vista(320, 568)
  const casi: [string, Riquadro, number][] = [
    ['a tutta riga, elenco largo 24rem', riquadro(20, 100, 280, 44), 384],
    ['a meta\' riga a destra, elenco virtuale (22rem)', riquadro(164, 100, 136, 44), 352],
    ['a meta\' riga a sinistra', riquadro(20, 100, 136, 44), 352],
    ['Sort in fondo a destra', riquadro(156, 100, 144, 44), 200],
  ]
  for (const [nome, campo, larghezza] of casi) {
    const p = posizionePannello({ campo, limite: stretto, larghezza })
    const [da, a] = estensione(campo, larghezza, p.lato, p.larghezzaMax)
    check(`320px, ${nome}: il pannello resta fra 8 e 312`, da >= MARGINE && a <= 320 - MARGINE, `${da}-${a}, ${p.lato}`)
  }

  // un dialog (o lo scroller dell'editor) taglia prima della finestra
  const dialogo: Riquadro = { top: 60, left: 16, right: 359, bottom: 420 }
  const p6 = posizionePannello({ campo: riquadro(32, 200, 300, 34), limite: dialogo, larghezza: 300, riga: RIGA_MOUSE })
  vale('dentro un dialog: l\'altezza e\' quella che resta nel dialog', [p6.verso, p6.altezzaMax], ['giu', 420 - 234 - MARGINE - STACCO])
  const p7 = posizionePannello({ campo: riquadro(0, 0, 300, 400), limite: vista(300, 410), larghezza: 300 })
  check('almeno una riga ci sta sempre', p7.altezzaMax >= RIGA_TOCCO, String(p7.altezzaMax))
  const p8 = posizionePannello({ campo: riquadro(20, 100, 300, 34), limite: vista(1280, 900), larghezza: 300, riga: RIGA_MOUSE })
  vale('col mouse: 4 righe da 32', [p8.verso, p8.altezzaMax], ['giu', ALTEZZA_MAX])

  // L'invito a installare l'app, fisso in fondo (z-40): 375x812, alto 94
  const schermo = vista(375, 812)
  const invito = riquadro(0, 718, 375, 94)
  vale('l\'invito in fondo: quello che si vede finisce sulla sua cima', sopraLeCoperture(schermo, [invito]), { ...schermo, bottom: 718 })
  // Max turns a y=560: prima l'elenco andava sotto fino a 803, sotto l'invito
  const turni = riquadro(16, 560, 166, 44)
  const prima = posizionePannello({ campo: turni, limite: schermo, larghezza: 200, altezza: 8 * RIGA_TOCCO })
  const ora = posizionePannello({ campo: turni, limite: sopraLeCoperture(schermo, [invito]), larghezza: 200, altezza: 8 * RIGA_TOCCO })
  check('senza contarlo l\'elenco finiva sotto l\'invito', prima.verso === 'giu' && 560 + 44 + STACCO + prima.altezzaMax > 718,
    `${prima.verso} ${prima.altezzaMax}`)
  vale('contandolo si apre sopra, tutto sopra l\'invito', [ora.verso, ora.altezzaMax], ['su', ALTEZZA_MAX])
  const alto = posizionePannello({ campo: riquadro(16, 300, 166, 44), limite: sopraLeCoperture(schermo, [invito]), larghezza: 200 })
  check('piu\' in alto: sotto, e l\'ultima riga resta sopra l\'invito', alto.verso === 'giu' &&
    300 + 44 + STACCO + alto.altezzaMax <= 718 - MARGINE, `${alto.verso} ${alto.altezzaMax}`)
  vale('dietro la tastiera (sotto quello che si vede) non conta', sopraLeCoperture(vista(375, 400), [invito]).bottom, 400)
  vale('alto 0, o fuori di lato, non conta', [sopraLeCoperture(schermo, [riquadro(0, 718, 375, 0)]).bottom,
    sopraLeCoperture(schermo, [riquadro(400, 718, 300, 94)]).bottom], [812, 812])
  vale('che copre tutto (sopra la cima) non azzera niente', sopraLeCoperture(schermo, [riquadro(0, 0, 375, 812)]).bottom, 812)
  vale('senza coperture lo stesso riquadro', sopraLeCoperture(schermo, []), schermo)
}

// ---------------------------------------------------------------------
//  I contrasti, in tutti i temi
// ---------------------------------------------------------------------

const canali = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
const lineare = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminanza = (h: string) => {
  const [r, g, b] = canali(h).map(lineare)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrasto = (a: string, b: string) => {
  const x = luminanza(a), y = luminanza(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
type Blocco = { selettori: string[]; props: Map<string, string> }
const css = file('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
const blocchi: Blocco[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selettori: (m[1].split(';').pop() ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  props: new Map(m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return [d.slice(0, i).trim(), d.slice(i + 1).trim().toLowerCase()] as [string, string]
  })),
}))

function contrasti() {
  console.log('\n  -- i colori del menu, in tutti gli 11 temi (System chiaro e scuro)')
  const temi: [string, Blocco | undefined][] = [
    ...TEMI.filter((t) => t.id !== 'system').map((t) => [t.id, blocchi.find((b) => b.selettori.includes(`[data-theme="${t.id}"]`))] as
      [string, Blocco | undefined]),
    ['system (scuro)', blocchi.find((b) => b.selettori.includes(':root:not([data-theme])'))],
  ]
  check('11 temi letti da app/globals.css', temi.length === 11 && temi.every(([, b]) => !!b), temi.filter(([, b]) => !b).map(([i]) => i).join())
  // [primo piano, fondo, dove]
  const testo: [string, string, string][] = [
    ['inchiostro', 'superficie', 'il valore e la voce scelta'], ['testo', 'superficie', 'le voci'],
    ['tenue', 'superficie', 'Any..., l\'epiteto, il conteggio, "No results"'],
    ['inchiostro', 'superficie-2', 'la voce attiva'], ['testo', 'superficie-2', 'le voci sul fondo attivo'],
    ['tenue', 'superficie-2', 'epiteto e conteggio della voce attiva'],
  ]
  const segni: [string, string, string][] = [
    ['campo', 'superficie', 'il bordo del campo nel footer e nei dialog'], ['campo', 'sfondo', 'il bordo del campo nella pagina'],
    ['tenue', 'superficie', 'il bordo al passaggio e aperto, nel footer e nei dialog'],
    ['tenue', 'sfondo', 'il bordo al passaggio e aperto, nella pagina'],
    ['oro', 'superficie', 'l\'anello del focus e la spunta'], ['oro', 'superficie-2', 'la barra della voce attiva'],
    ['oro', 'sfondo', 'l\'anello del focus sulla pagina'],
    ...TIPI.flatMap((x): [string, string, string][] => [[x.toLowerCase(), 'superficie', `il quadratino ${x}`],
      [x.toLowerCase(), 'superficie-2', `il quadratino ${x} sulla voce attiva`]]),
  ]
  for (const [id, b] of temi) {
    if (!b) continue
    const t = (k: string) => b.props.get(`--${k}`) ?? ''
    const sotto = (coppie: [string, string, string][], min: number) => coppie
      .map(([a, f, dove]) => [dove, contrasto(t(a), t(f))] as const).filter(([, r]) => !(r >= min))
      .map(([dove, r]) => `${dove} ${r.toFixed(2)}`)
    const s1 = sotto(testo, 4.5)
    check(`${id}: i testi almeno 4.5:1`, s1.length === 0, s1.join('; '))
    const s2 = sotto(segni, 3)
    check(`${id}: bordo, anello, barra e quadratini almeno 3:1`, s2.length === 0, s2.join('; '))
    // il bordo al passaggio e aperto non scende mai sotto quello a riposo
    const giu = ['sfondo', 'superficie'].filter((f) => contrasto(t('tenue'), t(f)) < contrasto(t('campo'), t(f)) - 1e-9)
    check(`${id}: al passaggio e aperto il bordo non perde contrasto`, giu.length === 0, giu.join())
  }
  const colori = (c: string) => [...c.matchAll(/(?:^|\s)(?:hover:|data-open:)border-([a-z-]+)/g)].map((m) => m[1])
  vale('il bordo al passaggio e aperto e\' tenue (mai linea-forte, piu\' chiaro di campo)', colori(STILE.SCATOLA_BASE), ['tenue', 'tenue'])
}

// ---------------------------------------------------------------------
//  La guardia: nessun <select> fuori dalla forma nativa
// ---------------------------------------------------------------------

const albero = (testo: string, nome = 'x.tsx') =>
  ts.createSourceFile(nome, testo, ts.ScriptTarget.Latest, true, /\.(t|j)sx$/.test(nome) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** I <select> e gli <option> di un sorgente: JSX e createElement('select'), mai stringhe o commenti. */
function elementiNativi(testo: string, nome = 'x.tsx'): { select: number; option: number } {
  const sf = albero(testo, nome)
  let select = 0
  let option = 0
  const tag = (n: TS.JsxTagNameExpression) => (ts.isIdentifier(n) ? n.text : '')
  const visita = (n: TS.Node, inDatalist: boolean) => {
    let dentro = inDatalist
    if (ts.isJsxElement(n) && tag(n.openingElement.tagName) === 'datalist') dentro = true
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const t = tag(n.tagName)
      if (t === 'select') select++
      if (t === 'option' && !inDatalist) option++
    }
    if (ts.isCallExpression(n)) {
      const f = n.expression
      const nomeF = ts.isIdentifier(f) ? f.text : ts.isPropertyAccessExpression(f) ? f.name.text : ''
      const a = n.arguments[0]
      if (nomeF === 'createElement' && a && ts.isStringLiteralLike(a)) {
        if (a.text === 'select') select++
        if (a.text === 'option') option++
      }
    }
    n.forEachChild((c) => visita(c, dentro))
  }
  visita(sf, false)
  return { select, option }
}

function fileDi(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(new URL(`../../${dir}`, import.meta.url))) {
    const rel = `${dir}/${n}`
    if (statSync(new URL(`../../${rel}`, import.meta.url)).isDirectory()) fileDi(rel, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n)) out.push(rel)
  }
  return out
}

/**
 * Chi puo' avere un <select> vero, e quanti. Uno solo: la forma del
 * server e senza JavaScript dei menu a scelta, che il combobox sostituisce
 * dopo l'idratazione (README, "Menu a scelta"). Un <select> nuovo va
 * fatto con <Scelta>; se proprio deve restare nativo, va aggiunto qui col
 * suo perche'.
 */
const AMMESSI: Record<string, { select: number; option: number; perche: string }> = {
  'components/scelta/scelta-nativa.tsx': { select: 1, option: 1, perche: 'l\'HTML del server e senza JavaScript, sostituito dopo l\'idratazione' },
}

function guardia() {
  console.log('\n  -- la controprova della guardia')
  const S = '<' + 'select'
  const O = '<' + 'option'
  vale('un ' + S + '> in JSX', elementiNativi(`const a = ${S} value="x" onChange={f}>${O} value="x">X</option></select>`),
    { select: 1, option: 1 })
  vale('su piu\' righe', elementiNativi(`const a = (\n  ${S}\n    id="x"\n    value={v}\n  >\n  </select>\n)`), { select: 1, option: 0 })
  vale('con le props sparse', elementiNativi(`const a = ${S} {...p} />`), { select: 1, option: 0 })
  vale('createElement e React.createElement', elementiNativi(
    `createElement('select', null); React.createElement("select", {}); createElement('option')`), { select: 2, option: 1 })
  vale('<Scelta>, un commento, una stringa, un template: niente', elementiNativi(
    `// ${S}>\n/* ${S} id="x"> */\nconst s = '${S}>'\nconst t = \`${S}>\`\nconst a = <Scelta id="x" />\nconst b = <Selector />`),
    { select: 0, option: 0 })
  vale('gli <option> di un <datalist> non contano', elementiNativi(`const a = <datalist id="d">{l.map((x) => ${O} key={x} value={x} />)}</datalist>`),
    { select: 0, option: 0 })

  console.log('\n  -- nessun <select> in components/ e app/')
  const sorgenti = [...fileDi('components'), ...fileDi('app')]
  check('i sorgenti ci sono', sorgenti.length > 50 && sorgenti.includes('components/scelta/scelta-nativa.tsx'), String(sorgenti.length))
  const fuori: string[] = []
  for (const f of sorgenti) {
    const n = elementiNativi(file(f), f)
    const a = AMMESSI[f]
    if (a ? n.select !== a.select || n.option !== a.option : n.select > 0 || n.option > 0) {
      fuori.push(`${f}: ${n.select} select, ${n.option} option`)
    }
  }
  check('solo components/scelta/scelta-nativa.tsx, con un <select> e un <option>', fuori.length === 0, fuori.join('; '))
  check('ogni voce ammessa ha il suo perche\'', Object.values(AMMESSI).every((a) => a.perche.length > 20))
}

// ---------------------------------------------------------------------
//  Dipendenze e struttura
// ---------------------------------------------------------------------

/** Gli import (statici e import()) di un sorgente. */
function importDi(testo: string, nome: string): { statici: string[]; dinamici: string[]; soloTipi: string[] } {
  const sf = albero(testo, nome)
  const statici: string[] = []
  const dinamici: string[] = []
  const soloTipi: string[] = []
  const visita = (n: TS.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      ;(n.importClause?.isTypeOnly ? soloTipi : statici).push(n.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) statici.push(n.moduleSpecifier.text)
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      dinamici.push(n.arguments[0].text)
    }
    n.forEachChild(visita)
  }
  visita(sf)
  return { statici, dinamici, soloTipi }
}

/** Le props JSX di ogni <Nome> di un sorgente: nome -> testo dell'espressione. */
function propsDi(testo: string, nome: string, tagCercato: string): Map<string, string>[] {
  const sf = albero(testo, nome)
  const out: Map<string, string>[] = []
  const visita = (n: TS.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ts.isIdentifier(n.tagName) && n.tagName.text === tagCercato) {
      const m = new Map<string, string>()
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a)) { m.set('...', a.getText(sf)); continue }
        const v = a.initializer
        m.set(a.name.getText(sf), !v ? 'true' : ts.isStringLiteral(v) ? JSON.stringify(v.text)
          : ts.isJsxExpression(v) && v.expression ? v.expression.getText(sf) : v.getText(sf))
      }
      out.push(m)
    }
    n.forEachChild(visita)
  }
  visita(sf)
  return out
}

/** Il testo di cio' che si assegna alla prima const <nome> di un sorgente (una funzione, una stringa). */
function costante(testo: string, nome: string, cercato: string): string {
  const sf = albero(testo, nome)
  let out = ''
  const visita = (n: TS.Node) => {
    if (out) return
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === cercato && n.initializer) out = n.initializer.getText(sf)
    n.forEachChild(visita)
  }
  visita(sf)
  return out
}

function struttura() {
  console.log('\n  -- Headless UI: un file solo, e solo con import()')
  const sorgenti = [...fileDi('components'), ...fileDi('app'), ...fileDi('lib')]
  const conHeadless = sorgenti.filter((f) => {
    const i = importDi(file(f), f)
    return [...i.statici, ...i.dinamici, ...i.soloTipi].some((m) => m.startsWith('@headlessui/'))
  })
  vale('@headlessui/react lo importa solo components/scelta/scelta-elenco.tsx', conHeadless, ['components/scelta/scelta-elenco.tsx'])
  const statico = sorgenti.filter((f) => importDi(file(f), f).statici.some((m) => /scelta-elenco$/.test(m)))
  vale('scelta-elenco non ha import statici (non entra nel primo caricamento)', statico, [])
  const sceltaTsx = importDi(file('components/scelta/scelta.tsx'), 'scelta.tsx')
  vale('scelta.tsx lo carica con import()', sceltaTsx.dinamici, ['@/components/scelta/scelta-elenco'])
  check('scelta-elenco.tsx e\' un modulo client con l\'export default', /^'use client'/.test(file('components/scelta/scelta-elenco.tsx')) &&
    /export default function SceltaElenco/.test(file('components/scelta/scelta-elenco.tsx')))
  check('il caricamento parte quando il browser e\' libero', /requestIdleCallback\(\(\) => void carica\(\), \{ timeout: 2000 \}\)/.test(file('components/scelta/scelta.tsx')))
  check('sul server e all\'idratazione il <select> nativo (useSyncExternalStore, false sul server)',
    /useSyncExternalStore\(iscrivi, elencoPronto, sulServer\)/.test(file('components/scelta/scelta.tsx')) &&
    /const sulServer = \(\) => false/.test(file('components/scelta/scelta.tsx')))
  check('un <select> che ha il focus non si cambia (inUso)', /if \(pronto && !inUso && Elenco\)/.test(file('components/scelta/scelta.tsx')))

  console.log('\n  -- package.json')
  const pkg = JSON.parse(file('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> }
  const lock = JSON.parse(file('package-lock.json')) as { packages: Record<string, { version?: string }> }
  const versione = pkg.dependencies['@headlessui/react']
  check('@headlessui/react a una versione 2.x esatta', /^2\.\d+\.\d+$/.test(versione ?? ''), versione)
  vale('il lockfile ha la stessa versione', lock.packages['node_modules/@headlessui/react']?.version, versione)
  vale('le dipendenze: quelle di prima piu\' @headlessui/react', Object.keys(pkg.dependencies).sort(), [
    '@headlessui/react', '@phosphor-icons/react', 'better-auth', 'next', 'pg', 'react', 'react-dom', 'resend', 'server-only', 'web-push',
  ])
  vale('le dipendenze di sviluppo non cambiano', Object.keys(pkg.devDependencies).sort(), [
    '@tailwindcss/postcss', '@types/node', '@types/pg', '@types/react', '@types/react-dom', '@types/web-push', 'eslint',
    'eslint-config-next', 'tailwindcss', 'typescript',
  ])

  console.log('\n  -- i chiamanti')
  const conScelta = sorgenti.filter((f) => /\.tsx$/.test(f) && propsDi(file(f), f, 'Scelta').length > 0)
  vale('chi usa <Scelta>', conScelta.sort(), [
    'components/builder/build-editor.tsx', 'components/builder/dettagli.tsx', 'components/builder/picker-filtri.tsx',
    'components/builder/prove.tsx', 'components/builder/sfera-picker.tsx', 'components/clears/filtri-clear.tsx',
    'components/tema/scelta-tema-footer.tsx',
  ])
  for (const f of conScelta) {
    const etichette = propsDi(file(f), f, 'label').map((p) => p.get('htmlFor')).filter(Boolean)
    const senza = propsDi(file(f), f, 'Scelta').filter((p) => !p.get('id') || !etichette.includes(p.get('id')) || !p.get('etichetta'))
    check(`${f}: ogni <Scelta> ha un <label htmlFor> col suo id, e l'etichetta`, senza.length === 0,
      senza.map((p) => p.get('id')).join())
  }
  const builder = conScelta.filter((f) => f.startsWith('components/builder/'))
  const conName = builder.filter((f) => propsDi(file(f), f, 'Scelta').some((p) => p.has('name') || p.has('...')))
  vale('nel builder nessun menu ha name (lo stato va nel payload, la run nel campo nascosto)', conName, [])
  check('builder.tsx manda ancora la run col suo campo nascosto', /type="hidden" name="run"/.test(file('components/builder/builder.tsx')))

  const filtri = file('components/clears/filtri-clear.tsx')
  const campi = propsDi(filtri, 'filtri-clear.tsx', 'CampoFiltro').map((p) => JSON.parse(p.get('id') ?? '""') as string)
  const tutti = { ...VUOTI, proof: true, noItems: true, noKo: true, turns: 5, cards: ['1'], leader: '2', mono: 'AGL' as const,
    cls: 'Super' as const, cat: 3, sort: 'new' as const }
  // dall'URL: le tre caselle e card (le caselle di "Uses card") non sono menu
  const nomiUrl = parametriFiltri(tutti).map(([k]) => k).filter((k) => !['proof', 'noitems', 'noko', 'card'].includes(k))
  vale('i name dei menu dei filtri sono i parametri di parametriFiltri', campi.sort(), [...nomiUrl].sort())
  const dentro = propsDi(filtri, 'filtri-clear.tsx', 'Scelta')[0]
  check('nella barra ogni menu prende name e data-fuoco dal suo id', dentro?.get('name') === 'id' && dentro?.get('data-fuoco') === 'id' &&
    dentro?.get('id') === '`${idBase}-${id}`', mostra(dentro && Object.fromEntries(dentro)))
  check('niente piu\' il taglio dei nomi lunghi (max-w-' + '[16rem])', !filtri.includes('max-w-' + '[16rem]'))
  check('il <noscript> della barra ha la regola per i browser senza "scripting"',
    /\[data-scelta-nativa\]>select\{position:static;opacity:1/.test(filtri) && /\[data-scelta-nativa\]>\[data-scelta-valore\]\{display:none\}/.test(filtri))

  console.log('\n  -- il combobox (components/scelta/scelta-elenco.tsx)')
  const elenco = file('components/scelta/scelta-elenco.tsx')
  const opzioni = propsDi(elenco, 'scelta-elenco.tsx', 'ComboboxOptions')
  check('ComboboxOptions con modal={false}, senza anchor ne\' portal', opzioni.length === 1 && opzioni[0].get('modal') === 'false' &&
    !opzioni[0].has('anchor') && !opzioni[0].has('portal'), mostra(opzioni.map((p) => Object.fromEntries(p))))
  const combobox = propsDi(elenco, 'scelta-elenco.tsx', 'Combobox')
  check('Combobox senza immediate (il focus da programma non apre)', combobox.length === 1 && !combobox[0].has('immediate') &&
    !/\bimmediate\b/.test(elenco.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')))
  check('Combobox con name, value e onChange che passa da valoreScelto', combobox[0]?.get('name') === 'name' &&
    /valoreScelto\(v, valore, opzioni\)/.test(combobox[0]?.get('onChange') ?? ''))
  const input = propsDi(elenco, 'scelta-elenco.tsx', 'ComboboxInput')[0]
  const tasto = costante(elenco, 'scelta-elenco.tsx', 'tasto')
  check('Invio a elenco chiuso: preventDefault (niente invio del form)', input?.get('onKeyDown') === 'tasto' &&
    /if \(e\.key === 'Enter' && !componendo && !aperto\) \{\s*e\.preventDefault\(\)/.test(tasto) &&
    /const aperto = c\.getAttribute\('aria-expanded'\) === 'true'/.test(tasto) && /const componendo = e\.nativeEvent\.isComposing/.test(tasto))
  check('il campo ha l\'id del chiamante e il data-fuoco', input?.get('id') === 'id' && input?.get('data-fuoco') === 'fuoco')
  check('il bottone ha il nome dell\'etichetta (e quindi l\'elenco)', /<ComboboxButton[\s\S]*?<span className="sr-only">\{etichetta\}<\/span>/.test(elenco))
  check('la regione live c\'e\' sempre, fuori dal pannello', /<span role="status" className="sr-only">\{detto\}<\/span>\s*<\/div>\s*\)\s*\}/.test(elenco))
  check('"No results" quando non resta niente', /filtrate\.length === 0 && <p className=\{VUOTO\}>No results<\/p>/.test(elenco))
  check('l\'elenco virtuale ha un\'altezza prima delle righe (il virtualizer non disegna in uno scroller alto 0)',
    /--scelta-n': filtrate\.length/.test(elenco) && /virtuale \? `\$\{ELENCO\} \$\{ELENCO_VIRTUALE\}`/.test(elenco) &&
    /min-h-\[min\(var\(--scelta-max-h,18rem\),calc\(var\(--scelta-n\)\*2rem\)\)\]/.test(STILE.ELENCO_VIRTUALE) &&
    /pointer-coarse:min-h-\[min\(var\(--scelta-max-h,18rem\),calc\(var\(--scelta-n\)\*2\.75rem\)\)\]/.test(STILE.ELENCO_VIRTUALE))

  console.log('\n  -- la forma nativa e le classi')
  const nativa = file('components/scelta/scelta-nativa.tsx')
  const sel = propsDi(nativa, 'scelta-nativa.tsx', 'select')[0]
  check('il <select> e\' trasparente sopra il valore, e visibile senza JavaScript (noscript:)',
    /opacity-0/.test(sel?.get('className') ?? '') && /SENZA_SCRIPT\[misura\]/.test(sel?.get('className') ?? '') &&
    /noscript:static noscript:py-1\.5 noscript:opacity-100/.test(nativa) && /noscript:hidden/.test(nativa))
  check('il <select> ha lo stesso id, name, value, data-fuoco e aria-describedby', !!sel && ['id', 'name', 'value', 'data-fuoco', 'aria-describedby']
    .every((k) => sel.has(k)))
  check('le due forme hanno le stesse classi di scatola, valore e freccia', ['SCATOLA_BASE', 'VALORE_BASE', 'FRECCIA_BASE', 'CAMPO_BASE']
    .every((k) => nativa.includes(k) && elenco.includes(k)))
  check('il campo: 44px e 16px col dito (niente zoom di iOS al focus)', /pointer-coarse:min-h-11/.test(STILE.SCATOLA_BASE) &&
    /pointer-coarse:text-base/.test(STILE.SCATOLA_BASE))
  check('le voci: 44px e 15px col dito', /pointer-coarse:min-h-11/.test(STILE.RIGA) && /pointer-coarse:text-\[15px\]/.test(STILE.RIGA))
  check('la voce attiva: barra d\'oro e, coi colori forzati, il pieno di sistema (anche per epiteto, conteggio e spunta)',
    /data-focus:shadow-\[inset_2px_0_0_var\(--oro\)\]/.test(STILE.RIGA) && /forced-colors:data-focus:bg-\[color:Highlight\]/.test(STILE.RIGA) &&
    /forced-colors:data-focus:text-\[color:HighlightText\]/.test(STILE.RIGA) && /forced-colors:data-focus:forced-color-adjust-none/.test(STILE.RIGA) &&
    [STILE.RIGA_DETTAGLIO, STILE.RIGA_NOTA, STILE.RIGA_SPUNTA].every((c) => c.includes('forced-colors:group-data-focus/riga:text-[color:HighlightText]')))
  check('l\'anello sulla scatola, e il campo vero senza il suo (.scelta-campo)', /has-\[:focus-visible\]:outline-oro/.test(STILE.SCATOLA_BASE) &&
    /scelta-campo/.test(STILE.CAMPO_BASE) && /\.scelta-campo:focus-visible\s*\{\s*outline:\s*none;?\s*\}/.test(css))
  check('i nomi lunghi vanno a capo (campo e voci)', /overflow-wrap:anywhere/.test(STILE.VALORE_BASE) && /overflow-wrap:anywhere/.test(STILE.RIGA_TESTO))
  // coi colori forzati il testo trasparente del campo tornerebbe visibile, in una riga tagliata
  const campoClassi = propsDi(elenco, 'scelta-elenco.tsx', 'ComboboxInput')[0]?.get('className') ?? ''
  check('coi colori forzati il valore che va a capo resta, e il campo resta trasparente finche\' non si scrive',
    !/forced-colors:invisible/.test(elenco) && /forced-colors:not-data-scritto:forced-color-adjust-none/.test(campoClassi) &&
    /forced-colors:caret-\[color:CanvasText\]/.test(campoClassi) && /text-transparent/.test(campoClassi) &&
    /data-scritto:text-inchiostro/.test(campoClassi))

  console.log('\n  -- scrivere di nuovo, il nome lungo col focus, l\'invito in fondo')
  const campoIn = propsDi(elenco, 'scelta-elenco.tsx', 'ComboboxInput')[0]
  check('il primo tasto passa da ricercaScritta (con la voce mostrata, fuori da una composizione IME)',
    /ricercaScritta\(e\.target\.value, mostrato, intatto, ev\.inputType\?\.startsWith\('delete'\) === true\)/.test(campoIn?.get('onChange') ?? '') &&
    /!ev\.isComposing/.test(campoIn?.get('onChange') ?? '') && /onScrivi\(e\.target\.value\)/.test(campoIn?.get('onChange') ?? ''))
  check('al focus il testo si seleziona (Tab, etichetta, focus da programma)', /selezionaTutto\(e\.currentTarget\)/.test(campoIn?.get('onFocus') ?? '') &&
    /intatto/.test(campoIn?.get('onFocus') ?? ''))
  check('e di nuovo quando si apre, si chiude o cambia il valore col focus ancora li\'',
    /\}, \[intatto, open, mostrato, lunga\]\)/.test(elenco) && /requestAnimationFrame\(\(\) => \{\s*if \(document\.activeElement === c\) selezionaTutto\(c\)/.test(elenco))
  const chiusura = combobox[0]?.get('onClose') ?? ''
  check('a ogni chiusura si torna intatti (q null), e le frecce ricominciano', /setQ\(null\)/.test(chiusura) &&
    /mossaRef\.current = voceMossa\(mossaRef\.current, \{ chiuso: true \}\)/.test(chiusura) && /const intatto = q === null/.test(elenco))

  console.log('\n  -- Invio e Tab: solo una scelta vera (scelta-elenco.tsx)')
  const cambio = combobox[0]?.get('onChange') ?? ''
  check('onChange: fermo prima di tutto, poi valoreScelto', /^\(v: string \| null\) => \{\s*if \(fermoRef\.current\) return\s*const x = valoreScelto/.test(cambio))
  check('Invio o Tab a elenco aperto senza sceltaDaTasto: fermo per questo evento soltanto',
    /\(\(e\.key === 'Enter' && !componendo\) \|\| e\.key === 'Tab'\) && aperto && !sceltaDaTasto\(mossaRef\.current, q\)/.test(tasto) &&
    /fermoRef\.current = true\s*queueMicrotask\(\(\) => \{ fermoRef\.current = false \}\)/.test(tasto) &&
    // nessun preventDefault li': il Tab porta avanti il focus come sempre
    !/sceltaDaTasto[^}]*preventDefault/.test(tasto))
  check('ogni altro tasto passa da voceMossa, e anche ogni ricerca scritta',
    /mossaRef\.current = voceMossa\(mossaRef\.current, \{ tasto: e\.key, aperto, shift: e\.shiftKey \}\)/.test(tasto) &&
    /mossaRef\.current = voceMossa\(mossaRef\.current, \{ ricerca: e\.target\.value \}\)/.test(propsDi(elenco, 'scelta-elenco.tsx', 'ComboboxInput')[0]?.get('onChange') ?? ''))
  check('Backspace o Canc sulla voce mostrata, a elenco aperto: si svuota senza Headless (la voce attiva resta)',
    /\(e\.key === 'Backspace' \|\| e\.key === 'Delete'\) && !componendo && aperto && intatto && mostrato !== ''/.test(tasto) &&
    /e\.preventDefault\(\)\s*c\.value = ''\s*mossaRef\.current = voceMossa\(mossaRef\.current, \{ ricerca: '' \}\)\s*onScrivi\(''\)/.test(tasto))
  check('le righe si registrano di nuovo quando il campo si svuota (la voce scelta torna attiva)',
    /const scritta = q === null \? '' : '\\u0001'/.test(elenco) && /key=\{virtuale \? o\.valore : `\$\{scritta\}\$\{cercata\}\\u0000\$\{o\.valore\}`\}/.test(elenco))
  check('il valore che va a capo resta col focus e aperto, finche\' non si scrive', campoIn?.get('data-scritto') === 'intatto ? undefined : \'\'' &&
    /peer-data-scritto:invisible/.test(elenco) && !/peer-data-(?:focus|open):invisible/.test(elenco) &&
    /data-scritto:text-inchiostro/.test(elenco) && /not-data-scritto:selection:bg-transparent/.test(elenco) && /caret-inchiostro/.test(elenco))
  const invito = file('components/pwa/invito-installa.tsx')
  check('l\'invito a installare l\'app e\' segnato data-copre-fondo, ed e\' fisso in fondo',
    /aria-label="Install the app"\s+data-copre-fondo=""\s+className="fixed inset-x-0 bottom-0 z-40/.test(invito))
  check('limiteVisibile lo toglie (fuori da un dialog aperto)', /if \(da\.closest\('dialog\[open\]'\)\) return r/.test(elenco) &&
    /querySelectorAll<HTMLElement>\('\[data-copre-fondo\]'\)/.test(elenco) && /return sopraLeCoperture\(r, coperture\)/.test(elenco))
  check('e il pannello sta sopra l\'invito, se compare a elenco aperto (z-50 > z-40)', /\bz-50\b/.test(STILE.PANNELLO))

  console.log('\n  -- la riga dei filtri col dito: un\'altezza sola')
  const filtriBarra = file('components/clears/filtri-clear.tsx')
  check('le pillole e Filters: 44px e 15px col dito', /const COL_DITO = 'pointer-coarse:min-h-11 pointer-coarse:text-\[15px\]'/.test(filtriBarra) &&
    /const PILLOLA =\s*`[^`]*\$\{COL_DITO\}/.test(filtriBarra) && /md:hidden inline-flex[^`]*\$\{COL_DITO\}/.test(filtriBarra))
  check('"Uses card": 44px e 15px col dito', /data-fuoco="carte"[^>]*pointer-coarse:min-h-11 pointer-coarse:text-\[15px\]/.test(file('components/clears/scegli-carta.tsx')))
  check('al passaggio il bordo della barra non scende sotto campo', !/border-campo hover:border-linea-forte/.test(filtriBarra) &&
    !/border-campo text-inchiostro hover:border-linea-forte/.test(file('components/clears/scegli-carta.tsx')))

  console.log('\n  -- i campi accanto ai menu, col dito: alti quanto i menu (CAMPO_DITO)')
  vale('CAMPO_DITO: 44px e 16px (sotto, iOS ingrandisce la pagina al focus)', STILE.CAMPO_DITO,
    'pointer-coarse:min-h-11 pointer-coarse:text-base pointer-coarse:leading-6')
  check('i menu hanno le stesse misure', STILE.SCATOLA_BASE.includes(STILE.CAMPO_DITO))
  vale('BOTTONE_DITO: 44px e i 15px delle pillole dei filtri', STILE.BOTTONE_DITO, 'pointer-coarse:min-h-11 pointer-coarse:text-[15px]')
  // Ogni campo di testo dei form che hanno menu, e la ricerca di /events,
  // il modello dei menu: col dito tutti alti uguali, niente righe sfalsate
  const vicini = [...conScelta, 'components/builder/picker.tsx', 'components/builder/squadra-editor.tsx', 'components/builder/builder.tsx',
    'components/clears/scegli-carta.tsx', 'components/eventi/lista.tsx']
  const senzaDito: string[] = []
  let visti = 0
  for (const f of vicini) {
    const t = file(f)
    const campoConDito = costante(t, f, 'campo').includes('${CAMPO_DITO}')
    const campi = [...propsDi(t, f, 'input'), ...propsDi(t, f, 'textarea')]
      .filter((x) => !['"checkbox"', '"radio"', '"hidden"'].includes(x.get('type') ?? ''))
    for (const x of campi) {
      visti++
      const cls = x.get('className') ?? ''
      const ok = cls.includes('${CAMPO_DITO}') || ((cls === 'campo' || cls.includes('${campo}')) && campoConDito)
      if (!ok) senzaDito.push(`${f}: ${x.get('id') ?? cls.slice(0, 40)}`)
    }
  }
  check('ogni campo di testo accanto ai menu ha CAMPO_DITO', visti >= 12 && senzaDito.length === 0, `${visti} campi; ${senzaDito.join(', ')}`)
  check('il bottone Remove della prova, nella riga del menu Kind: BOTTONE_DITO',
    /\$\{BOTTONE_DITO\}[^`]*hover:text-str[^`]*`\}\s*>\s*Remove/.test(file('components/builder/prove.tsx')))

  console.log('\n  -- il focus dopo una scelta col Tab sulla pagina statica (fuoco-filtri.ts)')
  check('la barra si segna il Tab che si sta premendo (1, -1 con Maiuscolo), solo per quell\'evento',
    /onKeyDownCapture=\{\(e\) => \{\s*if \(e\.key !== 'Tab'\) return\s*tabRef\.current = e\.shiftKey \? -1 : 1[\s\S]{0,200}?setTimeout\(\(\) => \{ tabRef\.current = 0 \}, 0\)/.test(filtriBarra))
  check('vai() lo scrive nel segno, e all\'arrivo rimettiFuoco va oltre il controllo',
    /lasciaSegno\(url, \{ campo, aperta, \.\.\.\(tab \? \{ tab \} : \{\}\) \}\)/.test(filtriBarra) &&
    (filtriBarra.match(/rimettiFuoco\(barra\.current, s\.campo, s\.tab\)/g) ?? []).length === 2)
  const fuoco = file('components/clears/fuoco-filtri.ts')
  check('rimettiFuoco con tab: il controllo che il Tab raggiunge (accanto), se no il controllo stesso',
    /const dove = \(tab && accanto\(el, tab\)\) \|\| el/.test(fuoco) && /DOCUMENT_POSITION_FOLLOWING : Node\.DOCUMENT_POSITION_PRECEDING/.test(fuoco))
  // Il segno fra le due pagine, con una sessionStorage e una location finte
  const mem = new Map<string, string>()
  const g = globalThis as unknown as { window?: unknown; sessionStorage?: unknown }
  const dove = { href: 'http://localhost/events/5001/t/3', pathname: '/events/5001/t/3', search: '' }
  g.window = { location: dove }
  g.sessionStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) } }
  const arriva = (url: string) => { const u = new URL(url, dove.href); dove.href = u.href; dove.pathname = u.pathname; dove.search = u.search }
  lasciaSegno('/events/5001/clears?tier=3&turns=5', { campo: 'turns', aperta: false, tab: 1 })
  arriva('/events/5001/clears?tier=3&turns=5')
  vale('Tab: il segno porta il verso alla pagina d\'arrivo', prendiSegno(), { campo: 'turns', aperta: false, tab: 1 })
  vale('e vale una volta sola', prendiSegno(), null)
  arriva('/events/5001/t/3')
  lasciaSegno('/events/5001/clears?tier=3&sort=new', { campo: 'sort', aperta: true, tab: -1 })
  arriva('/events/5001/clears?tier=3&sort=new')
  vale('Maiuscolo+Tab: -1, col pannello aperto', prendiSegno(), { campo: 'sort', aperta: true, tab: -1 })
  lasciaSegno('/events/5001/t/3', { campo: 'leader', aperta: false })
  arriva('/events/5001/t/3')
  vale('una scelta col clic o con Invio: niente verso, il focus torna sul controllo', prendiSegno(), { campo: 'leader', aperta: false })
  lasciaSegno('/events/5001/t/3', { campo: 'leader', aperta: false })
  mem.set('dokkan:fuoco-filtri', JSON.stringify({ ...JSON.parse(mem.get('dokkan:fuoco-filtri') ?? '{}'), tab: 2 }))
  vale('un verso che non e\' 1 o -1 non passa', prendiSegno(), { campo: 'leader', aperta: false })
  delete g.window
  delete g.sessionStorage

  // solo i token dei temi, cosi' valgono in tutti e 11
  const TOKEN = new Set(['sfondo', 'superficie', 'superficie-2', 'inchiostro', 'testo', 'tenue', 'linea', 'linea-forte', 'campo', 'oro',
    'oro-linea', 'oro-tenue', 'agl', 'teq', 'int', 'str', 'phy', 'transparent', 'current'])
  const colori = (t: string) => [...t.matchAll(/(?:^|[\s'"`:])(?:bg|text|border|outline|caret|ring)-([a-z][a-z0-9-]*)(?:\/\d+)?(?=[\s'"`])/g)]
    .map((m) => m[1]).filter((n) => !/^(?:\[|\d|offset-|xs$|sm$|base$|lg$|xl$|left$|center$|right$|none$|b$|b-0$|t$|r$|l$|x$|y$)/.test(n) && !TOKEN.has(n))
  // (nomi che Tailwind non conosce: anche questo file finisce nella sua scansione)
  vale('la guardia dei colori li vede', colori(`'px-2 text-rosso outline-offset-2 bg-cielo/50 border-b caret-inchiostro'`), ['rosso', 'cielo'])
  const fuori = ['components/scelta/stile.ts', 'components/scelta/scelta-nativa.tsx', 'components/scelta/scelta-elenco.tsx']
    .flatMap((f) => colori(file(f)).map((c) => `${f}: ${c}`))
  check('le classi del menu usano solo i token dei temi', fuori.length === 0, fuori.join(', '))
  check('nessun colore scritto nei file del menu', !['components/scelta/stile.ts', 'components/scelta/scelta-nativa.tsx',
    'components/scelta/scelta-elenco.tsx'].some((f) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(file(f))))
  check('i quadratini dei tipi sono i cinque token', mostra(STILE.PUNTO) === mostra({ AGL: 'bg-agl', TEQ: 'bg-teq', INT: 'bg-int', STR: 'bg-str', PHY: 'bg-phy' }))
}

ricerca()
valori()
inviaETab()
annunciEsoglie()
posizione()
contrasti()
guardia()
struttura()

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
if (fails) process.exit(1)
