// Il piano dello specchio Japan (db/import/japan-mirror/plan.mjs) e le sue
// regole (rules.mjs), su run finte scritte qui: ogni caso brutto c'e' di
// sicuro. Funzioni pure, niente database. Le scritture del piano si rifanno
// su un modello in memoria con lo stesso vincolo di event_run
// (run_no_overlap, run_window): ogni passo deve reggere, non solo la fine.
//
//   node db/test/japan-mirror-plan.test.mjs
import { ordine, planCardMirror, planJapanMirror } from '../import/japan-mirror/plan.mjs'
import { RULES, checkRules, japanDay } from '../import/japan-mirror/rules.mjs'

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

const R = { ...RULES, since: '2024-12-31T15:00:00Z' }
const ora = (iso) => new Date(iso)
// una run Global del gioco, e una Japan
let prossimo = 1
const g = (ev, da, a, nota = true) => ({ id: `g${prossimo++}`, event_id: ev, starts_at: ora(da), ends_at: a ? ora(a) : null, ends_at_known: nota })
const j = (id, ev, source, da, a, nota = a != null) =>
  ({ id: String(id), event_id: ev, source, starts_at: ora(da), ends_at: a ? ora(a) : null, ends_at_known: nota })
const iso = (d) => (d == null ? null : new Date(d).toISOString())
const vista = (r) => `${r.source} ${iso(r.starts_at)?.slice(0, 16)} → ${iso(r.ends_at)?.slice(0, 16) ?? 'aperta'}${r.ends_at_known ? '' : ' ?'}`

// Rifa' le scritture su una copia delle run Japan, col vincolo del database
// controllato dopo ogni passo. Torna le run finali, o { errore }. Gli id
// delle run nuove non si ripetono mai, nemmeno fra un giro e l'altro. Si
// cancella solo una copia o una run del wiki, mai una run con dei clear
// (pinned: la chiave esterna lo fermerebbe, e mirror-japan.mjs lo rifiuta).
let nuove = 0
function applica(japan, steps, pinned = new Set()) {
  const runs = new Map(japan.map((r) => [String(r.id), { ...r }]))
  const fine = (r) => (r.ends_at == null ? Infinity : new Date(r.ends_at).getTime())
  const inizio = (r) => new Date(r.starts_at).getTime()
  for (const p of steps) {
    if (p.kind === 'delete') {
      const r = runs.get(p.id)
      if (!r || !['wiki', 'mirror'].includes(r.source) || r.source !== p.was.source) return { errore: `cancella ${p.id}, che non e' una copia o una run del wiki` }
      if (pinned.has(p.id)) return { errore: `cancella ${p.id}, che ha dei clear` }
      runs.delete(p.id)
      continue
    }
    let r
    if (p.kind === 'insert') {
      r = { id: `n${++nuove}`, event_id: p.event_id, source: 'mirror' }
    } else {
      r = runs.get(p.id)
      if (!r || !['wiki', 'mirror'].includes(r.source) || r.source !== p.was.source) return { errore: `aggiorna ${p.id}, che non e' del wiki o una copia` }
    }
    Object.assign(r, { source: p.source ?? 'mirror', starts_at: p.starts_at, ends_at: p.ends_at, ends_at_known: p.ends_at_known })
    if (r.ends_at != null && fine(r) <= inizio(r)) return { errore: `run_window su ${r.id}` }
    for (const o of runs.values()) {
      if (o.id !== r.id && o.event_id === r.event_id && inizio(o) < fine(r) && inizio(r) < fine(o)) {
        return { errore: `run_no_overlap: ${r.id} contro ${o.id} al passo ${steps.indexOf(p) + 1}` }
      }
    }
    runs.set(r.id, r)
  }
  return { runs: [...runs.values()] }
}
// I clear di una prova: run -> istanti (created_at). Le run con dei clear
// sono anche pinned (non si cancellano).
const clearDi = (o) => new Map(Object.entries(o).map(([id, xs]) => [id, xs.map(ora)]))
const conClear = (input) => (input.clears ? { ...input, pinned: new Set([...(input.pinned ?? []), ...input.clears.keys()]) } : input)
// il piano, applicato; poi lo stesso piano rifatto sul risultato non deve
// scrivere piu' niente
function giro(nome, dati) {
  const input = conClear(dati)
  const plan = planJapanMirror({ rules: R, ...input })
  const out = applica(input.japanRuns, plan.steps, input.pinned)
  check(`${nome}: le scritture reggono il vincolo a ogni passo`, !out.errore, out.errore)
  const dopo = out.runs ?? []
  const secondo = planJapanMirror({ rules: R, ...input, japanRuns: dopo })
  check(`${nome}: un secondo giro non scrive niente`, secondo.steps.length === 0, secondo.steps.map((p) => `${p.kind} ${p.id}`).join(', '))
  return { plan, dopo, perEvento: (ev) => dopo.filter((r) => r.event_id === ev).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)) }
}

console.log('le regole (rules.mjs)')
{
  vale('D e\' il 2025-01-01 00:00 JST', R.since === RULES.since && japanDay(RULES.since) === '2025-01-01'
    && new Date(RULES.since).toISOString() === '2024-12-31T15:00:00.000Z', true)
  vale('le regole di oggi sono valide', checkRules(RULES), [])
  vale('giorno giapponese: le 14:59 UTC sono ancora lo stesso giorno', japanDay('2025-01-28T14:59:00Z'), '2025-01-28')
  vale('giorno giapponese: le 21:00 UTC sono gia\' il giorno dopo (1030560)', japanDay('2025-01-28T21:00:00Z'), '2025-01-29')
  const male = checkRules({
    since: '2025-01-01', globalOnly: [{ event: 12, why: 'corta' }, { event: 12, why: 'una collaborazione solo Global' }],
    skipWindows: [{ event: 0, start: 'ieri', why: '' }, { event: 12, start: '2025-02-01T00:00Z', why: 'replica in un altro momento' }],
    globalOnlyCards: [{ card: 'x', why: 'carta collaborazione solo Global' }],
  })
  const ha = (re) => male.some((p) => re.test(p))
  check('una data senza fuso si rifiuta', ha(/^since/), male.join(' | '))
  check('un motivo troppo corto, un id che c\'e\' due volte, un id sbagliato si rifiutano',
    ha(/globalOnly\[0\]: manca il motivo/) && ha(/globalOnly\[1\]: l'evento 12 c'e' due volte/) && ha(/globalOnlyCards\[0\]: card non e' un id/))
  check('una finestra saltata senza istante, e una di un evento gia\' solo Global, si rifiutano',
    ha(/skipWindows\[0\]: start/) && ha(/skipWindows\[1\]: l'evento 12 e' gia' tutto in globalOnly/))
  check('senza elenchi: regole assenti', checkRules({ since: R.since }).some((p) => /deve essere un elenco/.test(p)))
}

console.log('\nle finestre da copiare')
{
  const ev = 100
  const glob = [
    g(ev, '2024-12-27T02:00Z', null),                    // prima di D: no
    g(ev, '2024-12-31T14:59Z', '2025-01-10T15:00Z'),     // un minuto prima di D: no
    g(ev, '2025-03-01T05:00Z', '2025-03-15T15:00Z'),
    g(ev, '2026-05-01T05:00Z', null, false),              // aperta, fine non nota
    g(200, '2025-06-24T05:00Z', null, true),              // permanente
  ]
  const { plan, perEvento } = giro('copia', { globalRuns: glob, japanRuns: [] })
  vale('si copiano solo le finestre da D in poi', plan.insert.map((x) => `${x.event_id} ${iso(x.starts_at)}`),
    [`${ev} 2025-03-01T05:00:00.000Z`, `${ev} 2026-05-01T05:00:00.000Z`, '200 2025-06-24T05:00:00.000Z'])
  const a = perEvento(ev)
  check('stesso inizio, stessa fine, stessa fine nota (anche aperta e non nota, e permanente)',
    a.length === 2 && iso(a[0].ends_at) === '2025-03-15T15:00:00.000Z' && a[0].ends_at_known
      && a[1].ends_at === null && a[1].ends_at_known === false
      && perEvento(200)[0].ends_at === null && perEvento(200)[0].ends_at_known === true, a.map(vista).join('; '))
  vale('tutte prima run Japan', plan.firstJapan, [ev, 200])
  tutte('ogni copia e\' source mirror', plan.steps, (p) => p.kind === 'insert' && p.source === 'mirror')
  const solo = planJapanMirror({ globalRuns: [...glob, { ...g(300, '2025-02-01T05:00Z', null), source: 'wiki' }], japanRuns: [], rules: R })
  check('una run Global che non e\' del gioco non si copia', !solo.insert.some((x) => x.event_id === 300))
}

console.log('\nle eccezioni (globalOnly, skipWindows)')
{
  const glob = [g(1, '2025-02-01T05:00Z', '2025-02-10T15:00Z'), g(2, '2025-02-01T05:00Z', '2025-02-10T15:00Z'),
                g(2, '2025-08-01T05:00Z', '2025-08-10T15:00Z')]
  const rules = { ...R, globalOnly: [{ event: 1, why: 'collaborazione solo Global' }],
                  skipWindows: [{ event: 2, start: '2025-08-02T00:00:00Z', why: 'Japan l\'ha avuta in un altro momento' }] }
  const plan = planJapanMirror({ globalRuns: glob, japanRuns: [], rules })
  vale('l\'evento solo Global non ha copie; la finestra saltata (entro due giorni) neanche',
    plan.insert.map((x) => `${x.event_id} ${iso(x.starts_at).slice(0, 10)}`), ['2 2025-02-01'])
  vale('le escluse col loro motivo', plan.excluded.map((x) => `${x.event_id} ${x.rule}: ${x.why}`),
    ['1 globalOnly: collaborazione solo Global', '2 skipWindows: Japan l\'ha avuta in un altro momento'])
  // la regola cambia: le copie che c'erano si tolgono
  const prima = [j(10, 1, 'mirror', '2025-02-01T05:00Z', '2025-02-10T15:00Z'), j(11, 2, 'mirror', '2025-08-01T05:00Z', '2025-08-10T15:00Z'),
                 j(12, 2, 'mirror', '2025-02-01T05:00Z', '2025-02-10T15:00Z')]
  const { plan: p2 } = giro('eccezioni nuove', { globalRuns: glob, japanRuns: prima, rules })
  vale('le copie che la regola non vuole piu\' si tolgono, l\'altra resta', p2.delete.map((x) => x.id), ['10', '11'])
  vale('...e quella che resta e\' invariata', p2.unchanged, 1)
}

console.log('\nla run a mano vince')
{
  const glob = [g(5, '2025-04-01T05:00Z', '2025-04-15T15:00Z'), g(5, '2025-09-01T05:00Z', '2025-09-15T15:00Z'),
                g(6, '2025-04-01T05:00Z', '2025-04-15T15:00Z')]
  const japan = [
    j(20, 5, 'manual', '2025-04-01T08:00Z', '2025-04-15T15:00Z'),          // si sovrappone
    j(21, 6, 'manual', '2025-03-30T08:00Z', '2025-03-31T08:00Z'),          // non si sovrappone, ma inizia entro due giorni
    j(22, 5, 'mirror', '2025-09-01T05:00Z', '2025-09-10T00:00Z', false),   // chiusa da set-event-window al --dal
    j(23, 5, 'manual', '2025-09-10T00:00Z', '2025-09-20T00:00Z'),
  ]
  const { plan, dopo } = giro('a mano', { globalRuns: glob, japanRuns: japan })
  vale('tre finestre saltate, con la run a mano che le tocca', plan.skip.map((s) => `${s.event_id} ${s.manual}`), ['5 20', '5 23', '6 21'])
  check('nessuna copia nuova', plan.insert.length === 0, plan.insert.map((x) => x.event_id).join())
  check('le run a mano non sono in nessun passo', !plan.steps.some((p) => ['20', '21', '23'].includes(p.id)))
  const c = dopo.find((r) => r.id === '22')
  check('la copia chiusa da set-event-window resta com\'e\': ne\' tolta ne\' girata in run del wiki',
    !!c && c.source === 'mirror' && iso(c.ends_at) === '2025-09-10T00:00:00.000Z' && !plan.steps.some((p) => p.id === '22'),
    c ? vista(c) : 'sparita')
  vale('...e il piano la tiene per la run a mano', plan.keep.map((k) => `${k.id} ${k.why}`), ['22 manual'])
}

console.log('\nla run del wiki della stessa uscita, e quella piu\' vecchia')
{
  const glob = [g(7, '2025-03-01T05:00Z', '2025-03-15T15:00Z'),
                g(8, '2025-05-10T05:00Z', '2025-05-20T15:00Z'), g(8, '2025-07-01T05:00Z', null, false),
                g(9, '2025-06-24T05:00Z', null)]
  const japan = [
    j(30, 7, 'wiki', '2025-03-01T00:00Z', null, false),   // stessa uscita: entro due giorni
    j(31, 8, 'wiki', '2019-07-30T00:00Z', null, false),   // piu' vecchia, aperta: si chiude alla prima finestra
    j(32, 9, 'wiki', '2025-01-07T00:00Z', null, false),   // gennaio 2025, e la rimessa in lista di giugno
  ]
  const { plan, perEvento } = giro('wiki', { globalRuns: glob, japanRuns: japan })
  const a = perEvento(7)
  check('adottata: stesso id, ora copia, con la finestra Global', a.length === 1 && a[0].id === '30' && a[0].source === 'mirror'
    && iso(a[0].starts_at) === '2025-03-01T05:00:00.000Z' && iso(a[0].ends_at) === '2025-03-15T15:00:00.000Z' && a[0].ends_at_known,
    a.map(vista).join('; '))
  vale('il piano la chiama adozione', plan.adopt.map((x) => `${x.id} ${x.was.source}`), ['30 wiki'])
  const b = perEvento(8)
  check('la piu\' vecchia si chiude all\'inizio della prima finestra, con la fine non nota',
    b.length === 3 && b[0].id === '31' && b[0].source === 'wiki' && iso(b[0].ends_at) === '2025-05-10T05:00:00.000Z' && !b[0].ends_at_known
      && b[1].source === 'mirror' && b[2].source === 'mirror', b.map(vista).join('; '))
  const c = perEvento(9)
  check('gennaio 2025 e una finestra di giugno: prima uscita del wiki chiusa, poi la copia',
    c.length === 2 && c[0].id === '32' && iso(c[0].ends_at) === '2025-06-24T05:00:00.000Z' && c[1].ends_at === null && c[1].ends_at_known,
    c.map(vista).join('; '))
  vale('chiuse: due, del wiki', plan.close.map((x) => `${x.id} ${x.source}`), ['31 wiki', '32 wiki'])
}

console.log('\nle copie si riconoscono da evento e inizio, mai dall\'id Global')
{
  const japan = [j(40, 11, 'mirror', '2025-03-01T05:00Z', '2025-03-15T15:00Z'),
                 j(41, 11, 'mirror', '2025-06-01T05:00Z', null, false)]
  // stesse finestre, id Global diversi (load-windows scambia le righe)
  const stesse = planJapanMirror({ rules: R, japanRuns: japan,
    globalRuns: [{ ...g(11, '2025-03-01T05:00Z', '2025-03-15T15:00Z'), id: 'scambiata' }, g(11, '2025-06-01T05:00Z', null, false)] })
  check('id Global cambiati: niente da scrivere', stesse.steps.length === 0 && stesse.unchanged === 2, `${stesse.steps.length} passi`)
  // l'inizio si sposta di qualche ora, la fine diventa nota, e la seconda
  // finestra si apre 20 giorni prima (sovrapposta): si aggiornano sul posto
  const { plan, perEvento } = giro('spostate', { japanRuns: japan,
    globalRuns: [g(11, '2025-03-01T08:00Z', '2025-03-16T15:00Z'), g(11, '2025-05-12T05:00Z', '2025-07-01T15:00Z')] })
  const a = perEvento(11)
  vale('aggiornate sul posto, stessi id', a.map((r) => `${r.id} ${iso(r.starts_at).slice(0, 13)} ${r.ends_at_known}`),
    ['40 2025-03-01T08 true', '41 2025-05-12T05 true'])
  check('nessuna tolta, nessuna nuova', plan.delete.length === 0 && plan.insert.length === 0 && plan.update.length === 2)
  // due copie che vanno avanti insieme: la seconda si sposta prima
  const avanti = giro('avanti insieme', {
    japanRuns: [j(42, 12, 'mirror', '2025-03-01T05:00Z', '2025-03-10T05:00Z'), j(43, 12, 'mirror', '2025-03-10T05:00Z', '2025-03-20T05:00Z')],
    globalRuns: [g(12, '2025-03-02T05:00Z', '2025-03-11T05:00Z'), g(12, '2025-03-11T05:00Z', '2025-03-21T05:00Z')],
  })
  vale('avanti insieme: stessi id, nell\'ordine giusto', avanti.perEvento(12).map((r) => `${r.id} ${iso(r.starts_at).slice(0, 10)}`),
    ['42 2025-03-02', '43 2025-03-11'])
  const indietro = giro('indietro insieme', {
    japanRuns: [j(44, 13, 'mirror', '2025-03-02T05:00Z', '2025-03-11T05:00Z'), j(45, 13, 'mirror', '2025-03-11T05:00Z', '2025-03-21T05:00Z')],
    globalRuns: [g(13, '2025-03-01T05:00Z', '2025-03-10T05:00Z'), g(13, '2025-03-10T05:00Z', '2025-03-20T05:00Z')],
  })
  vale('indietro insieme: stessi id', indietro.perEvento(13).map((r) => r.id), ['44', '45'])
}

console.log('\nuna copia che nessuna finestra vuole piu\'')
{
  const japan = [
    j(50, 14, 'mirror', '2025-04-01T05:00Z', '2025-04-10T15:00Z'),      // sparita da Global, nessun clear: si toglie
    j(51, 15, 'mirror', '2025-04-01T05:00Z', '2025-04-10T15:00Z'),      // sparita, con clear: resta
    j(52, 16, 'wiki', '2019-01-01T00:00Z', '2025-05-01T05:00Z', false), // chiusa dalla copia 53
    j(53, 16, 'mirror', '2025-05-01T05:00Z', null, true),               // sparita: la 52 si riapre
    j(54, 17, 'mirror', '2025-03-01T05:00Z', '2025-03-15T15:00Z'),      // era la run del wiki adottata (JPdate 2025-03-01)
    j(55, 17, 'mirror', '2025-09-01T05:00Z', null, false),              // resta: la run del wiki tornata finisce qui
    j(56, 18, 'mirror', '2025-03-01T05:00Z', '2025-03-15T15:00Z'),      // adottata, sparita, nessun'altra run: torna aperta
  ]
  const glob = [g(17, '2025-09-01T05:00Z', null, false)]
  const wikiJapan = new Map([[17, ora('2025-03-01T00:00Z')], [18, ora('2025-03-02T00:00Z')]])
  const { plan, perEvento, dopo } = giro('non piu\' volute', { globalRuns: glob, japanRuns: japan, wikiJapan, pinned: new Set(['51']) })
  vale('tolta quella senza clear', plan.delete.map((x) => x.id).sort(), ['50', '53'])
  vale('tenuta quella con i clear (mirror-japan stampa "  tengo la run")', plan.keep.map((k) => `${k.id} ${k.why}`), ['51 clear'])
  check('la 51 e\' intatta', dopo.some((r) => r.id === '51' && r.source === 'mirror'))
  const w = perEvento(16)
  check('la run del wiki chiusa dove non comincia piu\' niente si riapre, stesso id', w.length === 1 && w[0].id === '52'
    && w[0].ends_at === null && !w[0].ends_at_known, w.map(vista).join('; '))
  vale('riaperta', plan.reopen.map((x) => x.id), ['52'])
  const t = perEvento(17)
  check('l\'adottata torna run del wiki: stesso id, inizio JPdate, fine non nota alla prossima run',
    t.length === 2 && t[0].id === '54' && t[0].source === 'wiki' && iso(t[0].starts_at) === '2025-03-01T00:00:00.000Z'
      && iso(t[0].ends_at) === '2025-09-01T05:00:00.000Z' && !t[0].ends_at_known && t[1].id === '55', t.map(vista).join('; '))
  const u = perEvento(18)
  check('senza altre run torna aperta', u.length === 1 && u[0].id === '56' && u[0].source === 'wiki' && u[0].ends_at === null
    && iso(u[0].starts_at) === '2025-03-02T00:00:00.000Z', u.map(vista).join('; '))
  vale('tornate del wiki', plan.restore.map((x) => x.id), ['54', '56'])
}

console.log('\nla data Japan del wiki da D in poi vince')
{
  const glob = [g(19, '2025-02-01T05:00Z', '2025-02-10T15:00Z'), g(19, '2025-04-01T05:00Z', '2025-04-10T15:00Z'),
                g(19, '2025-09-01T05:00Z', null, false), g(20, '2025-02-01T05:00Z', '2025-02-10T15:00Z')]
  const japan = [j(60, 19, 'wiki', '2025-04-02T00:00Z', null, false),
                 j(61, 20, 'mirror', '2025-02-01T05:00Z', '2025-02-10T15:00Z'),
                 j(62, 20, 'wiki', '2025-06-01T00:00Z', null, false)]
  const wikiJapan = new Map([[19, ora('2025-04-02T00:00Z')], [20, ora('2025-06-01T00:00Z')],
                             [21, ora('2024-06-01T00:00Z')]])
  const { plan, perEvento } = giro('conflitto col wiki', { globalRuns: [...glob, g(21, '2025-02-01T05:00Z', null)], japanRuns: japan, wikiJapan })
  vale('le finestre prima della data del wiki: conflitto, e non si copiano',
    plan.conflict.map((c) => `${c.event_id} ${c.why} ${iso(c.window.starts_at).slice(0, 10)}`), ['19 wiki 2025-02-01', '20 wiki 2025-02-01'])
  const a = perEvento(19)
  check('la stessa uscita (entro due giorni) si adotta, la replica dopo si copia',
    a.length === 2 && a[0].id === '60' && a[0].source === 'mirror' && iso(a[0].starts_at) === '2025-04-01T05:00:00.000Z' && a[1].source === 'mirror',
    a.map(vista).join('; '))
  const b = perEvento(20)
  check('la copia di prima della data del wiki si toglie, la run del wiki resta aperta',
    b.length === 1 && b[0].id === '62' && b[0].source === 'wiki' && b[0].ends_at === null, b.map(vista).join('; '))
  check('una data del wiki prima di D non e\' un conflitto', !plan.conflict.some((c) => c.event_id === 21) && plan.insert.some((x) => x.event_id === 21))
}

// load-events sulle run Japan di un evento, con la data del wiki W, con le
// stesse clausole di load-events.mjs: la run del wiki si sposta a W se non
// e' chiusa prima di W, niente si sovrappone a [W, la sua fine) e non ha
// clear (quella la sposta lo specchio, se la regola dei clear lo permette);
// se non c'e' si crea aperta, a meno che una copia
// entro due giorni o una run sovrapposta a [W, infinito) la blocchi.
// Senza data (W null) la run del wiki se ne va, a meno che non abbia dei
// clear (pinned).
let daLoadEvents = 0
function loadEvents(japan, ev, W, pinned = new Set(), clears = new Map()) {
  const fine = (r) => (r.ends_at == null ? Infinity : new Date(r.ends_at).getTime())
  const inizio = (r) => new Date(r.starts_at).getTime()
  if (W == null) return japan.filter((r) => r.event_id !== ev || r.source !== 'wiki' || pinned.has(String(r.id))).map((r) => ({ ...r }))
  const w = new Date(W).getTime()
  const out = japan.map((r) => ({ ...r }))
  const mie = out.filter((r) => r.event_id === ev)
  const wiki = mie.filter((r) => r.source === 'wiki')
  for (const r of wiki) {
    if (inizio(r) === w || fine(r) <= w || pinned.has(String(r.id)) || clears.has(String(r.id))) continue
    if (!mie.some((o) => o.id !== r.id && inizio(o) < fine(r) && w < fine(o))) r.starts_at = new Date(w)
  }
  const blocca = mie.some((o) => o.source === 'game' || (o.source === 'mirror' && Math.abs(inizio(o) - w) <= 2 * 86_400_000) || w < fine(o))
  if (!wiki.length && !blocca) {
    out.push({ id: `w${++daLoadEvents}`, event_id: ev, source: 'wiki', starts_at: new Date(w), ends_at: null, ends_at_known: false })
  }
  return out
}
// Il giro settimanale per un evento: load-events, poi lo specchio. Poi un
// secondo giro intero non deve cambiare niente: ne' load-events ne' lo
// specchio (prima servivano due giri, e Japan per una settimana diceva altro).
function settimana(nome, ev, W, dati) {
  const input = conClear(dati)
  const wikiJapan = new Map([[ev, ora(W)]])
  const prima = loadEvents(input.japanRuns, ev, W, input.pinned, input.clears)
  const plan = planJapanMirror({ rules: R, wikiJapan, ...input, japanRuns: prima })
  const out = applica(prima, plan.steps, input.pinned)
  check(`${nome}: le scritture reggono il vincolo a ogni passo`, !out.errore, out.errore)
  const dopo = out.runs ?? []
  const ancora = loadEvents(dopo, ev, W, input.pinned, input.clears)
  const secondo = planJapanMirror({ rules: R, wikiJapan, ...input, japanRuns: ancora })
  check(`${nome}: al giro dopo load-events e lo specchio non cambiano niente`,
    JSON.stringify(ancora) === JSON.stringify(dopo) && secondo.steps.length === 0,
    `${ancora.filter((r) => r.event_id === ev).map(vista).join('; ')}; passi ${secondo.steps.map((p) => `${p.kind} ${p.id}`).join(', ')}`)
  const runs = dopo.filter((r) => r.event_id === ev).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
  return { plan, secondo, runs }
}

console.log('\nla data Japan del wiki da D in poi vince: la run del wiki ci va in un giro solo')
{
  // 728100: il wiki passa da 7 Jan 2025 a 1 Jul 2025. La run del wiki era
  // chiusa dalla copia della rimessa in lista del 2025-06-24.
  const a = settimana('la run del wiki chiusa da una copia', 24, '2025-07-01T00:00Z', {
    globalRuns: [g(24, '2025-06-24T05:00Z', null, true)],
    japanRuns: [j(80, 24, 'wiki', '2025-01-07T00:00Z', '2025-06-24T05:00Z', false), j(81, 24, 'mirror', '2025-06-24T05:00Z', null, true)],
  })
  check('la copia si toglie, la run del wiki (stesso id) va alla data del wiki, aperta, fine non nota',
    a.runs.length === 1 && a.runs[0].id === '80' && a.runs[0].source === 'wiki' && iso(a.runs[0].starts_at) === '2025-07-01T00:00:00.000Z'
      && a.runs[0].ends_at === null && !a.runs[0].ends_at_known, a.runs.map(vista).join('; '))
  vale('...detto: conflitto, tolta, messa alla data', [a.plan.conflict.map((c) => c.why), a.plan.delete.map((x) => x.id),
    a.plan.place.map((x) => x.id), a.plan.reopen.length], [['wiki'], ['81'], ['80'], 0])
  vale('...e al giro dopo il conflitto si dice ancora (finche\' qualcuno non decide)', a.secondo.conflict.map((c) => c.why), ['wiki'])

  // 729065: la sola run Japan e' una copia permanente; il wiki aggiunge
  // JPdate 10 Jan 2026. load-events non la puo' creare (la copia si
  // sovrappone): la copia diventa la run del wiki, con il suo id.
  const b = settimana('solo una copia aperta', 25, '2026-01-10T00:00Z', {
    globalRuns: [g(25, '2025-12-29T01:00Z', null, true)],
    japanRuns: [j(82, 25, 'mirror', '2025-12-29T01:00Z', null, true)],
  })
  check('nessun giro senza run Japan: la copia diventa la run del wiki alla sua data, stesso id',
    b.runs.length === 1 && b.runs[0].id === '82' && b.runs[0].source === 'wiki' && iso(b.runs[0].starts_at) === '2026-01-10T00:00:00.000Z'
      && b.runs[0].ends_at === null && !b.runs[0].ends_at_known, b.runs.map(vista).join('; '))
  vale('...detto come run messa alla data, non come copia tolta', [b.plan.place.map((x) => `${x.id} ${x.was.source}`), b.plan.delete.length], [['82 mirror'], 0])

  // la stessa, con dei clear: si chiude alla data del wiki (fine non nota),
  // e la run del wiki nasce dopo. Al giro dopo la copia resta per i clear.
  const c = settimana('una copia con clear che copre la data', 26, '2026-01-10T00:00Z', {
    globalRuns: [g(26, '2025-12-29T01:00Z', null, true)],
    japanRuns: [j(83, 26, 'mirror', '2025-12-29T01:00Z', null, true)],
    pinned: new Set(['83']),
  })
  check('la copia con clear si chiude alla data del wiki, e la run del wiki parte li\', aperta',
    c.runs.length === 2 && c.runs[0].id === '83' && c.runs[0].source === 'mirror' && iso(c.runs[0].ends_at) === '2026-01-10T00:00:00.000Z'
      && !c.runs[0].ends_at_known && c.runs[1].source === 'wiki' && iso(c.runs[1].starts_at) === '2026-01-10T00:00:00.000Z'
      && c.runs[1].ends_at === null, c.runs.map(vista).join('; '))
  vale('...chiusa e una run nuova del wiki; al giro dopo tenuta per i clear', [c.plan.close.map((x) => x.id), c.plan.place.map((x) => x.id),
    c.secondo.keep.map((k) => `${k.id} ${k.why}`)], [['83'], [null], ['83 clear']])

  // una data del wiki fra due finestre: la copia di prima si toglie, la run
  // del wiki (del 2019, chiusa da quella copia) va alla data e si chiude
  // all'inizio della copia dopo, che resta com'e'
  const d = settimana('fra due finestre', 27, '2025-05-01T00:00Z', {
    globalRuns: [g(27, '2025-03-01T05:00Z', '2025-03-15T15:00Z'), g(27, '2025-09-01T05:00Z', null, false)],
    japanRuns: [j(84, 27, 'wiki', '2019-07-30T00:00Z', '2025-03-01T05:00Z', false), j(85, 27, 'mirror', '2025-03-01T05:00Z', '2025-03-15T15:00Z'),
                j(86, 27, 'mirror', '2025-09-01T05:00Z', null, false)],
  })
  check('la run del wiki va alla data e si chiude alla copia dopo; quella resta',
    d.runs.length === 2 && d.runs[0].id === '84' && iso(d.runs[0].starts_at) === '2025-05-01T00:00:00.000Z'
      && iso(d.runs[0].ends_at) === '2025-09-01T05:00:00.000Z' && !d.runs[0].ends_at_known && d.runs[1].id === '86'
      && d.plan.unchanged === 1, d.runs.map(vista).join('; '))

  // una run a mano che copre la data del wiki vince anche su di lui: la
  // run del wiki non si mette (e load-events non la crea)
  const e = settimana('una run a mano sulla data', 28, '2025-05-01T00:00Z', {
    globalRuns: [g(28, '2025-03-01T05:00Z', '2025-03-15T15:00Z')],
    japanRuns: [j(87, 28, 'mirror', '2025-03-01T05:00Z', '2025-03-15T15:00Z'), j(88, 28, 'manual', '2025-04-28T00:00Z', '2025-05-20T00:00Z')],
  })
  check('la copia in conflitto si toglie, la run a mano resta sola', e.runs.length === 1 && e.runs[0].id === '88'
    && e.plan.place.length === 0, e.runs.map(vista).join('; '))
}

console.log('\nquello che non si puo\' fare si lascia com\'e\'')
{
  // una run del wiki che inizia dentro la finestra, piu' di due giorni dopo,
  // senza una data del wiki da D (una run messa a mano col source sbagliato)
  const japan = [j(70, 22, 'wiki', '2025-03-10T00:00Z', null, false)]
  const plan = planJapanMirror({ globalRuns: [g(22, '2025-03-01T05:00Z', '2025-03-20T15:00Z')], japanRuns: japan, rules: R })
  vale('conflitto con la run, niente da scrivere', [plan.conflict.map((c) => `${c.why} ${c.run}`), plan.steps.length], [['run 70'], 0])
  // una copia con dei clear che inizia dentro la finestra e finisce dopo, con
  // un clear dopo la fine della finestra, e un'altra copia piu' vicina: la
  // copia dei clear prende la finestra (una copia segue la finestra anche se
  // un suo clear resta fuori, e lo specchio lo conta), la vicina senza
  // clear si toglie. Prima la finestra era un conflitto per sempre, con due
  // copie e le date sbagliate su Japan.
  const doppie = [j(71, 23, 'mirror', '2025-03-01T05:00Z', '2025-03-05T05:00Z'), j(72, 23, 'mirror', '2025-03-05T05:00Z', '2025-03-25T15:00Z')]
  const p2 = giro('copia doppia con un clear fuori dalla finestra', { globalRuns: [g(23, '2025-03-01T05:00Z', '2025-03-20T15:00Z')], japanRuns: doppie,
    clears: clearDi({ 72: ['2025-03-22T00:00Z'] }) })
  vale('la copia dei clear (stesso id) prende la finestra, la vicina si toglie; nessun conflitto, nessun tengo',
    [p2.perEvento(23).map((r) => `${r.id} ${vista(r)}`), p2.plan.delete.map((x) => x.id), p2.plan.conflict.length, p2.plan.keep.length],
    [['72 mirror 2025-03-01T05:00 → 2025-03-20T15:00'], ['71'], 0, 0])
  // senza clear la copia di troppo si toglie, e la vicina prende la finestra
  const p3 = giro('copia doppia', { globalRuns: [g(23, '2025-03-01T05:00Z', '2025-03-20T15:00Z')], japanRuns: doppie })
  vale('senza clear: la copia di troppo si toglie, l\'altra prende la finestra', [p3.plan.delete.map((x) => x.id), p3.perEvento(23).map((r) => r.id)], [['72'], ['71']])
}

console.log('\nuna copia con dei clear che inizia dentro la finestra, con i clear tutti dentro: prende lei la finestra')
{
  // set-event-window --reg global con il --dal un'ora dopo l'inizio del
  // gioco (la run del gioco chiusa al --dal, poi la run a mano), con un
  // clear Japan scritto dopo il --dal: lo scambio porta la riga del clear
  // alla copia della run a mano, e resta il pezzetto chiuso al --dal. Poi la
  // correzione si annulla (il --dal di nuovo all'inizio: una finestra sola).
  // La finestra prendeva il pezzetto senza clear (il piu' vicino), la copia
  // del clear la bloccava, e restavano tutte e due per sempre (un
  // conflitto), dove un import da zero ha una copia sola.
  const ev = 24
  const glob = [{ ...g(ev, '2025-10-16T05:00Z', '2025-10-30T05:00Z'), source: 'manual' }]
  const japan = [j(73, ev, 'mirror', '2025-10-16T05:00Z', '2025-10-16T06:00Z', false), j(74, ev, 'mirror', '2025-10-16T06:00Z', '2025-10-30T05:00Z')]
  const { plan, perEvento } = giro('finestra rimessa intera', { globalRuns: glob, japanRuns: japan, clears: clearDi({ 74: ['2025-10-16T08:00Z'] }) })
  vale('la copia del clear (stesso id) prende la finestra, il pezzetto senza clear si toglie; nessun conflitto',
    [perEvento(ev).map((r) => `${r.id} ${vista(r)}`), plan.delete.map((x) => x.id), plan.riprese, plan.conflict.length],
    [['74 mirror 2025-10-16T05:00 → 2025-10-30T05:00'], ['73'], [{ id: '74', copy: '73', event_id: ev }], 0])
  // senza nessuna copia della finestra (la copia del clear e' l'unica): la
  // prende lei, invece di una copia nuova
  const p4 = giro('una sola copia, dentro la finestra', { globalRuns: glob, japanRuns: [japan[1]], clears: clearDi({ 74: ['2025-10-16T08:00Z'] }) })
  vale('...anche quando la finestra non aveva una copia sua', [p4.perEvento(ev).map((r) => `${r.id} ${vista(r)}`), p4.plan.insert.length],
    [['74 mirror 2025-10-16T05:00 → 2025-10-30T05:00'], 0])
}

// La settimana dopo, da uno stato qualunque: load-events con la data W (null:
// la pagina non la da' piu'), poi lo specchio. Torna le run, il piano, e se il
// giro dopo (load-events e lo specchio) non cambia piu' niente. fermi: le run
// con dei clear, un Set (senza istanti) o una Map run -> istanti dei clear.
function dopoUnaSettimana(prima, ev, W, globalRuns, fermi = new Set()) {
  const clears = fermi instanceof Map ? fermi : new Map()
  const pinned = new Set([...fermi.keys()])
  const wikiJapan = W == null ? new Map() : new Map([[ev, ora(W)]])
  const le = loadEvents(prima, ev, W, pinned, clears)
  const plan = planJapanMirror({ rules: R, globalRuns, japanRuns: le, wikiJapan, pinned, clears })
  const out = applica(le, plan.steps, pinned)
  if (out.errore) return { plan, errore: out.errore, runs: [], fermo: false }
  const ancora = loadEvents(out.runs, ev, W, pinned, clears)
  const secondo = planJapanMirror({ rules: R, globalRuns, japanRuns: ancora, wikiJapan, pinned, clears })
  return { plan, runs: out.runs, fermo: JSON.stringify(ancora) === JSON.stringify(out.runs) && secondo.steps.length === 0 }
}
// Un import da zero: load-events mette la run del wiki alla data, aperta, poi lo specchio.
const daZero = (ev, W, globalRuns) => dopoUnaSettimana([], ev, W, globalRuns).runs
const forma = (rs, ev) => rs.filter((r) => r.event_id === ev)
  .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).map(vista).join('; ')
const diEvento = (x, ev) => x.runs.filter((r) => r.event_id === ev).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

console.log('\nla run del wiki della stessa uscita e la copia che c\'e\' gia\': una run sola')
{
  // 88853: il wiki passa da 1 Apr 2017 a 16 Oct 2025, il giorno della
  // finestra Global delle 05:00. load-events sposta la run del wiki (chiusa
  // dalla copia) alla data, e restava un pezzetto di cinque ore prima della
  // copia, per sempre. Da zero la run del wiki diventa la copia.
  const ev = 30
  const glob = [g(ev, '2025-10-16T05:00Z', '2025-10-30T15:00Z')]
  const japan = [j(90, ev, 'wiki', '2017-04-01T00:00Z', '2025-10-16T05:00Z', false), j(91, ev, 'mirror', '2025-10-16T05:00Z', '2025-10-30T15:00Z')]
  const unaSola = (x) => {
    const r = diEvento(x, ev)
    return !x.errore && r.length === 1 && r[0].id === '90' && r[0].source === 'mirror' && iso(r[0].starts_at) === '2025-10-16T05:00:00.000Z'
      && iso(r[0].ends_at) === '2025-10-30T15:00:00.000Z' && r[0].ends_at_known
  }
  const a = dopoUnaSettimana(japan, ev, '2025-10-16T00:00Z', glob)
  check('una run sola: la run del wiki (stesso id) diventa la copia, la copia di prima se ne va', unaSola(a), a.errore ?? forma(a.runs, ev))
  vale('...detto come riunita; il giro dopo non cambia niente; come da zero',
    [a.plan.fold?.map((f) => `${f.id} ${f.copy}`), a.fermo, forma(a.runs, ev) === forma(daZero(ev, '2025-10-16T00:00Z', glob), ev)],
    [['90 91'], true, true])
  // la stessa uscita per la data del wiki anche se load-events non ha potuto
  // spostare la run (la data cade dentro la copia, 19 ore dopo l'inizio)
  const b = dopoUnaSettimana(japan, ev, '2025-10-17T00:00Z', glob)
  check('anche con la data dentro la copia: la run del wiki (stesso id, ancora al 2017) diventa la copia',
    unaSola(b) && b.fermo, b.errore ?? forma(b.runs, ev))
  // con dei clear sulla copia la copia non si puo' togliere: resta lei, e
  // se ne va la run del wiki (senza clear). Restava il pezzetto di cinque
  // ore per sempre accanto alla copia, dove un import da zero ha una run sola
  for (const W of ['2025-10-16T00:00Z', '2025-10-17T00:00Z']) {
    const c = dopoUnaSettimana(japan, ev, W, glob, new Set(['91']))
    const r = diEvento(c, ev)
    check(`con dei clear sulla copia (data ${W.slice(0, 10)}): resta solo la copia (stesso id, con la finestra), la run del wiki se ne va`,
      !c.errore && c.fermo && r.length === 1 && r[0].id === '91' && r[0].source === 'mirror'
        && iso(r[0].starts_at) === '2025-10-16T05:00:00.000Z' && r[0].ends_at_known
        && forma(c.runs, ev) === forma(daZero(ev, W, glob), ev), c.errore ?? forma(c.runs, ev))
    vale('...detto come run del wiki tolta accanto alla copia, non come riunita', [c.plan.dropWiki?.map((f) => `${f.id} ${f.copy}`),
      c.plan.fold.length, c.plan.delete.map((x) => `${x.id} ${x.source}`)], [['90 91'], 0, ['90 wiki']])
  }
  // con dei clear sulla run del wiki (dentro la sua corsa, prima della
  // finestra) niente: finirebbero fuori dalla loro run. load-events non la
  // sposta, e lo specchio non la riunisce: tutte e due restano, e a ogni
  // giro una riga "tengo"
  const c = dopoUnaSettimana(japan, ev, '2025-10-16T00:00Z', glob, clearDi({ 90: ['2020-01-01T00:00Z'] }))
  const r = diEvento(c, ev)
  check('con dei clear sulla run del wiki: le due run restano com\'erano',
    !c.errore && c.fermo && r.length === 2 && r[0].id === '90' && r[0].source === 'wiki' && iso(r[0].starts_at) === '2017-04-01T00:00:00.000Z'
      && iso(r[0].ends_at) === '2025-10-16T05:00:00.000Z' && r[1].id === '91' && r[1].source === 'mirror'
      && c.plan.fold.length === 0 && c.plan.dropWiki.length === 0, c.errore ?? forma(c.runs, ev))
  vale('...detta: tengo la run (ferma per i clear)', c.plan.keep.map((k) => `${k.id} ${k.why}`), ['90 fissa'])
  // un clear fuori dalla sua corsa (scritto durante la copia, o scelto nel
  // builder) non la ferma: la run del wiki prende la finestra, come senza
  // clear, e il clear ci sta dentro
  const d = dopoUnaSettimana(japan, ev, '2025-10-16T00:00Z', glob, clearDi({ 90: ['2025-10-20T00:00Z'] }))
  check('con un clear della run del wiki fuori dalla sua corsa: una run sola, la run del wiki (stesso id) con la finestra',
    unaSola(d) && d.fermo && d.plan.fold.length === 1 && d.plan.keep.length === 0, d.errore ?? forma(d.runs, ev))
}

console.log('\nla data Japan del wiki che torna prima di D')
{
  // 707351: un conflitto "vince il wiki" ha messo la run del wiki al 20 Dec
  // 2025; la copia di prima resta (ha dei clear, o lo specchio ha girato
  // prima di load-events). Il wiki torna a 31 May 2021: load-events non la
  // puo' spostare, la copia si sovrappone a [data, infinito).
  const ev = 31
  const glob = [g(ev, '2025-11-18T05:00Z', '2025-12-02T15:00Z')]
  const japan = [j(92, ev, 'mirror', '2025-11-18T05:00Z', '2025-12-02T15:00Z'), j(93, ev, 'wiki', '2025-12-20T00:00Z', null, false)]
  for (const [nome, pinned] of [['la copia con dei clear', new Set(['92'])], ['la copia senza clear', new Set()]]) {
    const a = dopoUnaSettimana(japan, ev, '2021-05-31T00:00Z', glob, pinned)
    const r = diEvento(a, ev)
    check(`${nome}: la run del wiki (stesso id) torna alla data, chiusa all'inizio della copia, fine non nota; la copia resta`,
      !a.errore && a.fermo && r.length === 2 && r[0].id === '93' && r[0].source === 'wiki' && iso(r[0].starts_at) === '2021-05-31T00:00:00.000Z'
        && iso(r[0].ends_at) === '2025-11-18T05:00:00.000Z' && !r[0].ends_at_known && r[1].id === '92' && r[1].source === 'mirror'
        && forma(a.runs, ev) === forma(daZero(ev, '2021-05-31T00:00Z', glob), ev), a.errore ?? forma(a.runs, ev))
  }
  // 88853 dopo l'adozione: la sola run Japan e' la copia (era la run del
  // wiki); il wiki torna a 1 Apr 2017. La copia resta (stesso id, con i
  // clear della sua corsa, se ce ne sono), e la run del wiki rinasce.
  const ev2 = 32
  const glob2 = [g(ev2, '2025-10-16T05:00Z', '2025-10-30T15:00Z')]
  const b = dopoUnaSettimana([j(94, ev2, 'mirror', '2025-10-16T05:00Z', '2025-10-30T15:00Z')], ev2, '2017-04-01T00:00Z', glob2)
  const r = diEvento(b, ev2)
  check('dopo un\'adozione: la run del wiki rinasce alla data, chiusa all\'inizio della copia (che resta, stesso id)',
    !b.errore && b.fermo && r.length === 2 && r[0].source === 'wiki' && iso(r[0].starts_at) === '2017-04-01T00:00:00.000Z'
      && iso(r[0].ends_at) === '2025-10-16T05:00:00.000Z' && !r[0].ends_at_known && r[1].id === '94'
      && forma(b.runs, ev2) === forma(daZero(ev2, '2017-04-01T00:00Z', glob2), ev2), b.errore ?? forma(b.runs, ev2))
}

console.log('\nla run Japan del wiki segue la data del wiki, qualunque sia: come un import da zero')
{
  // Da ogni data del wiki a ogni altra: molto prima di D, il giorno prima
  // di D (la stessa uscita della finestra che parte a D), dentro quella
  // finestra, fra lei e la seconda, il giorno della seconda (prima e dopo
  // le 05:00), dentro, dopo, fra due finestre, nella terza (aperta), e
  // senza data. La settimana prima e' gia' a posto (come da zero); dopo
  // load-events e lo specchio le run Japan devono essere quelle di un
  // import da zero, e il giro dopo non deve cambiare niente.
  const ev = 36
  const glob = [g(ev, '2024-12-31T15:00Z', '2025-01-10T15:00Z'), g(ev, '2025-10-16T05:00Z', '2025-10-30T15:00Z'),
                g(ev, '2026-03-01T05:00Z', null, false)]
  const date = [null, '2017-04-01T00:00Z', '2024-12-30T00:00Z', '2025-01-05T00:00Z', '2025-06-01T00:00Z', '2025-10-16T00:00Z',
                '2025-10-17T00:00Z', '2025-10-20T00:00Z', '2025-11-05T00:00Z', '2026-03-01T00:00Z', '2026-05-01T00:00Z']
  const esiti = date.flatMap((a) => date.map((b) => {
    const x = dopoUnaSettimana(daZero(ev, a, glob), ev, b, glob)
    return { da: a, a: b, errore: x.errore, fermo: x.fermo, got: forma(x.runs, ev), atteso: forma(daZero(ev, b, glob), ev) }
  }))
  tutte('da ogni data a ogni altra: lo stesso risultato di un import da zero', esiti, (x) => !x.errore && x.got === x.atteso)
  tutte('...e il giro dopo non cambia niente', esiti, (x) => x.fermo)
}

console.log('\nle finestre Global a mano si copiano come quelle del gioco')
{
  // set-event-window --reg global: la run del gioco chiusa al --dal (fine
  // non nota) e la run a mano dopo (33); la run del gioco diventata a mano
  // sul posto (34, con la run del wiki chiusa dalla copia); una a mano
  // prima di D (35)
  const glob = [{ ...g(33, '2025-04-01T05:00Z', '2025-04-03T05:00Z', false), source: 'game' },
                { ...g(33, '2025-04-03T05:00Z', '2025-04-20T08:00Z'), source: 'manual' },
                { ...g(34, '2025-05-01T05:00Z', '2025-05-15T08:00Z'), source: 'manual' },
                { ...g(35, '2024-12-01T05:00Z', '2024-12-15T08:00Z'), source: 'manual' }]
  const japan = [j(95, 33, 'mirror', '2025-04-01T05:00Z', '2025-04-15T15:00Z'),
                 j(97, 34, 'wiki', '2019-01-01T00:00Z', '2025-05-01T05:00Z', false), j(96, 34, 'mirror', '2025-05-01T05:00Z', '2025-05-14T15:00Z')]
  const { plan, perEvento } = giro('a mano su Global', { globalRuns: glob, japanRuns: japan })
  vale('chiusa al --dal e a mano dopo: la copia (stesso id) si chiude al --dal, e la finestra a mano ha la sua copia',
    perEvento(33).map((r) => `${r.id.startsWith('n') ? 'nuova' : r.id} ${vista(r)}`),
    ['95 mirror 2025-04-01T05:00 → 2025-04-03T05:00 ?', 'nuova mirror 2025-04-03T05:00 → 2025-04-20T08:00'])
  vale('a mano sul posto: la copia (stesso id) prende le date a mano; la run del wiki resta chiusa',
    perEvento(34).map((r) => `${r.id} ${vista(r)}`),
    ['97 wiki 2019-01-01T00:00 → 2025-05-01T05:00 ?', '96 mirror 2025-05-01T05:00 → 2025-05-15T08:00'])
  check('prima di D: nessuna copia', perEvento(35).length === 0)
  vale('nessuna copia tolta, nessuna run del wiki riaperta', [plan.delete.length, plan.reopen.length, plan.restore.length], [0, 0, 0])
  const wiki = planJapanMirror({ globalRuns: [{ ...g(37, '2025-02-01T05:00Z', null), source: 'wiki' }], japanRuns: [], rules: R })
  check('una run Global del wiki non si copia', wiki.insert.length === 0)
  // Le run a mano scritte con now() (la fixture) hanno i microsecondi, che
  // una Date di JS perde: mirror-japan legge gli istanti come testo ISO con
  // sei cifre, e la copia deve essere uguale al microsecondo.
  const us = { id: 'gus', event_id: 38, source: 'manual', starts_at: '2026-04-30T01:23:12.313917Z', ends_at: '2026-05-10T01:23:12.313917Z', ends_at_known: true }
  const nuova = planJapanMirror({ globalRuns: [us], japanRuns: [], rules: R })
  vale('i microsecondi della finestra restano nella copia', nuova.insert.map((x) => [x.starts_at, x.ends_at]),
    [['2026-04-30T01:23:12.313917Z', '2026-05-10T01:23:12.313917Z']])
  const uguale = planJapanMirror({ globalRuns: [us], japanRuns: [{ ...us, id: '98', source: 'mirror' }], rules: R })
  const troncata = planJapanMirror({ globalRuns: [us], rules: R,
    japanRuns: [{ ...us, id: '98', source: 'mirror', starts_at: '2026-04-30T01:23:12.313000Z', ends_at: '2026-05-10T01:23:12.313000Z' }] })
  vale('...la copia uguale al microsecondo e\' invariata, quella troncata al millisecondo si aggiorna',
    [uguale.steps.length, uguale.unchanged, troncata.update.map((x) => `${x.id} ${x.starts_at}`)], [0, 1, ['98 2026-04-30T01:23:12.313917Z']])
}

console.log('\nuna copia che nessuna finestra vuole piu\': torna run del wiki solo se era lei la run adottata')
{
  // Due finestre Global entro due giorni dalla data del wiki (1 Mar 2025):
  // la run del wiki adottata dalla prima, una copia della seconda. La
  // seconda finestra sparisce: la sua copia non e' la run del wiki adottata
  // (c'e' quella vera, della stessa uscita) e si toglie. Tornava run del
  // wiki, un pezzetto di cinque ore davanti alla copia vera, e il giro dopo
  // la riunione (3b) toglieva la copia vera; con un clear sulla copia vera
  // il pezzetto restava per sempre.
  const ev = 40, W = '2025-03-01T00:00Z'
  const A = g(ev, '2025-03-01T05:00Z', '2025-03-02T05:00Z'), B = g(ev, '2025-03-02T05:00Z', '2025-03-16T15:00Z')
  const prima = daZero(ev, W, [A, B])
  const vera = diEvento({ runs: prima }, ev)
  check('prima: la run del wiki adottata dalla prima finestra, la copia della seconda', vera.length === 2
    && vera.every((r) => r.source === 'mirror') && vera[0].id.startsWith('w'), forma(prima, ev))
  for (const [nome, pinned] of [['senza clear', new Set()], ['con un clear sulla copia vera', new Set([vera[0].id])]]) {
    const x = dopoUnaSettimana(prima, ev, W, [A], pinned)
    const r = diEvento(x, ev)
    check(`${nome}: la copia della finestra sparita si toglie e resta la copia vera (stesso id), come da zero; il giro dopo non cambia niente`,
      !x.errore && x.fermo && r.length === 1 && r[0].id === vera[0].id && x.plan.restore.length === 0
        && forma(x.runs, ev) === forma(daZero(ev, W, [A]), ev), x.errore ?? `${forma(x.runs, ev)}; fermo ${x.fermo}`)
  }
  // Con una run del wiki viva altrove la copia non e' la run adottata: si
  // toglie, e la run del wiki va alla data (passo 6). Tornava run del wiki
  // anche lei, e il riaprirsi della vecchia (scritto prima) le passava sopra:
  // il piano non si poteva scrivere, e l'evento restava fermo ogni settimana.
  const ev2 = 41, W2 = '2025-01-11T00:00Z'
  const glob2 = [g(ev2, '2025-01-13T15:00Z', '2025-01-14T15:00Z')]
  const x2 = dopoUnaSettimana([j(90, ev2, 'wiki', '2017-04-01T00:00Z', '2025-01-10T15:00Z', false),
                               j(91, ev2, 'mirror', '2025-01-10T15:00Z', '2025-01-11T15:00Z')], ev2, W2, glob2)
  check('con la run del wiki chiusa dalla copia: niente conflitti, la run del wiki (stesso id) alla data, come da zero',
    !x2.errore && x2.fermo && !x2.plan.conflict.length && diEvento(x2, ev2)[0]?.id === '90'
      && forma(x2.runs, ev2) === forma(daZero(ev2, W2, glob2), ev2), x2.errore ?? `${forma(x2.runs, ev2)}; ${JSON.stringify(x2.plan.conflict)}`)
  // Una copia tenuta per i clear entro due giorni dalla data non ferma la
  // run adottata vera: torna run del wiki lei (la piu' vicina alla data), e
  // la copia coi clear resta. Toglierla lasciava Japan senza run del wiki, e
  // il giro dopo tornava run del wiki la copia coi clear.
  const ev3 = 42
  const x3 = dopoUnaSettimana([j(92, ev3, 'mirror', '2025-01-01T18:00Z', '2025-01-01T23:00Z'), j(93, ev3, 'mirror', '2025-01-03T02:00Z', '2025-01-03T21:00Z')],
    ev3, '2025-01-03T00:00Z', [], new Set(['92']))
  vale('la copia coi clear resta (tengo), la copia adottata torna run del wiki alla data; il giro dopo non cambia niente',
    [diEvento(x3, ev3).map((r) => `${r.id} ${vista(r)}`), x3.plan.keep.map((k) => `${k.id} ${k.why}`), x3.fermo],
    [['92 mirror 2025-01-01T18:00 → 2025-01-01T23:00', '93 wiki 2025-01-03T00:00 → aperta ?'], ['92 clear'], true])
}

console.log('\nl\'ordine delle scritture: ognuna quando il suo posto e\' libero')
{
  // La run del wiki che si riapre (fino alla data) passa dove la copia che
  // torna run del wiki non ha ancora lasciato il posto: scritta per prima,
  // si sovrapponeva, e il piano non si poteva scrivere.
  const t = (x) => Date.parse(x)
  const orig = (source, s, e, known) => ({ source, s: t(s), e: e ? t(e) : null, known })
  const runs = [
    { id: '90', event_id: 43, source: 'wiki', s: t('2017-04-01T00:00Z'), e: t('2025-01-11T00:00Z'), known: false, op: 'reopen',
      orig: orig('wiki', '2017-04-01T00:00Z', '2025-01-10T15:00Z', false) },
    { id: '91', event_id: 43, source: 'wiki', s: t('2025-01-11T00:00Z'), e: t('2025-01-13T15:00Z'), known: false, op: 'restore',
      orig: orig('mirror', '2025-01-10T15:00Z', '2025-01-11T15:00Z', true) },
    { id: null, event_id: 43, source: 'mirror', s: t('2025-01-13T15:00Z'), e: t('2025-01-14T15:00Z'), known: true, op: 'insert', orig: null },
  ]
  const passi = ordine(runs, new Set())
  const out = applica([j(90, 43, 'wiki', '2017-04-01T00:00Z', '2025-01-10T15:00Z', false), j(91, 43, 'mirror', '2025-01-10T15:00Z', '2025-01-11T15:00Z')], passi)
  check('la copia lascia il posto prima che la run del wiki ci si allarghi', !out.errore
    && passi.findIndex((p) => p.id === '91') < passi.findIndex((p) => p.id === '90'), out.errore ?? passi.map((p) => p.id).join(', '))
}

console.log('\nla data del wiki torna indietro con una copia coi clear nel mezzo: la finestra si copia nello stesso giro')
{
  // 728100: il wiki passa a 1 Jul 2025 (vince: la run del wiki alla data, la
  // copia permanente del 2025-06-24 chiusa li' e tenuta per i clear), poi la
  // modifica si annulla (7 Jan 2025). load-events non puo' spostare la run
  // del wiki (la copia si sovrappone a [data, infinito)), e lo specchio la
  // prendeva per una run che blocca la finestra: un conflitto, e per una
  // settimana l'evento permanente risultava concluso su Japan.
  const ev = 44
  const glob = [g(ev, '2025-06-24T05:00Z', null, true)]
  const japan = [j(81, ev, 'mirror', '2025-06-24T05:00Z', '2025-07-01T00:00Z', false), j(80, ev, 'wiki', '2025-07-01T00:00Z', null, false)]
  const x = dopoUnaSettimana(japan, ev, '2025-01-07T00:00Z', glob, new Set(['81']))
  vale('nessun conflitto: la run del wiki (stesso id) alla data, chiusa alla copia; la copia coi clear di nuovo permanente; il giro dopo non cambia niente',
    [x.plan.conflict.map((c) => c.why), diEvento(x, ev).map((r) => `${r.id} ${vista(r)}`), x.fermo,
      forma(x.runs, ev) === forma(daZero(ev, '2025-01-07T00:00Z', glob), ev)],
    [[], ['80 wiki 2025-01-07T00:00 → 2025-06-24T05:00 ?', '81 mirror 2025-06-24T05:00 → aperta'], true, true])
  // la stessa con una run Japan a mano fra le due date: la run del wiki va
  // alla data e si chiude dove comincia la run a mano
  const ev2 = 45
  const glob2 = [g(ev2, '2025-04-30T05:00Z', '2025-05-14T05:00Z')]
  const x2 = dopoUnaSettimana([j(82, ev2, 'manual', '2025-01-10T00:00Z', '2025-01-20T00:00Z'), j(83, ev2, 'wiki', '2025-05-03T00:00Z', null, false)],
    ev2, '2024-11-28T00:00Z', glob2)
  vale('...con una run a mano nel mezzo: la run del wiki alla data, chiusa alla run a mano, e la finestra copiata subito',
    [x2.plan.conflict.map((c) => c.why), diEvento(x2, ev2).map((r) => `${r.id.startsWith('n') ? 'nuova' : r.id} ${vista(r)}`), x2.fermo],
    [[], ['83 wiki 2024-11-28T00:00 → 2025-01-10T00:00 ?', '82 manual 2025-01-10T00:00 → 2025-01-20T00:00',
      'nuova mirror 2025-04-30T05:00 → 2025-05-14T05:00'], true])
}

console.log('\nuna run del wiki con dei clear non si sposta')
{
  // 707351 con un clear sulla run del wiki rimasta aperta al 20 Dec 2025
  // (scritto il 10 Jan 2026): il wiki torna a 31 May 2021. Spostarla
  // lasciava il clear fuori dalla sua corsa. Resta dov'e', alla data ne
  // nasce una nuova, e lo specchio lo dice a ogni giro.
  const ev = 46
  const glob = [g(ev, '2025-11-18T05:00Z', '2025-12-02T15:00Z')]
  const japan = [j(92, ev, 'mirror', '2025-11-18T05:00Z', '2025-12-02T15:00Z'), j(93, ev, 'wiki', '2025-12-20T00:00Z', null, false)]
  const pinned = clearDi({ 93: ['2026-01-10T00:00Z'] })
  const x = dopoUnaSettimana(japan, ev, '2021-05-31T00:00Z', glob, pinned)
  vale('la run coi clear resta com\'era; alla data una run del wiki nuova, chiusa all\'inizio della copia; il giro dopo non cambia niente',
    [diEvento(x, ev).map((r) => `${r.id.startsWith('w') || r.id.startsWith('n') ? 'nuova' : r.id} ${vista(r)}`), x.plan.place.map((p) => p.id), x.fermo],
    [['nuova wiki 2021-05-31T00:00 → 2025-11-18T05:00 ?', '92 mirror 2025-11-18T05:00 → 2025-12-02T15:00', '93 wiki 2025-12-20T00:00 → aperta ?'], [null], true])
  const dopo = planJapanMirror({ rules: R, globalRuns: glob, japanRuns: x.runs, wikiJapan: new Map([[ev, ora('2021-05-31T00:00Z')]]),
    pinned: new Set(pinned.keys()), clears: pinned })
  vale('...detta (tengo) in questo giro e in quello dopo', [x.plan.keep.map((k) => `${k.id} ${k.why}`), dopo.keep.map((k) => `${k.id} ${k.why}`)],
    [['93 wiki'], ['93 wiki']])
  // la run coi clear che copre la data, con un clear prima della data: non
  // si sposta e non se ne mette un'altra (si sovrapporrebbe)
  const p = planJapanMirror({ rules: R, globalRuns: [], japanRuns: [j(94, 47, 'wiki', '2019-01-01T00:00Z', null, false)],
    wikiJapan: new Map([[47, ora('2021-05-31T00:00Z')]]), pinned: new Set(['94']), clears: clearDi({ 94: ['2020-06-01T00:00Z'] }) })
  vale('...anche quando copre la data: niente da scrivere, e lo dice', [p.steps.length, p.keep.map((k) => `${k.id} ${k.why}`)], [0, ['94 fissa']])
  // con i clear tutti dopo la data si sposta: restano dentro la sua corsa
  const q = dopoUnaSettimana([j(95, 47, 'wiki', '2019-01-01T00:00Z', null, false)], 47, '2021-05-31T00:00Z', [],
    clearDi({ 95: ['2022-06-01T00:00Z'] }))
  vale('...con i clear tutti dopo la data: lo specchio la sposta alla data (load-events no), stesso id',
    [diEvento(q, 47).map((r) => `${r.id} ${vista(r)}`), q.plan.place.map((x) => x.id), q.plan.keep.length, q.fermo],
    [['95 wiki 2021-05-31T00:00 → aperta ?'], ['95'], 0, true])
}

console.log('\nla run del wiki ferma per i clear, quando i clear non ci sono piu\': si toglie')
{
  // 707351 dopo la sezione sopra: la run del wiki coi clear rimasta al 20
  // Dec 2025, aperta, e quella nata alla data (31 May 2021). Poi i clear si
  // tolgono (o si spostano a mano, come dice il README). load-events non la
  // tocca (la run alla data gli basta), e lo specchio nemmeno: restava
  // aperta per sempre, l'evento in corso su Japan, e nessuna riga lo diceva.
  // Ora si toglie, come una run che il wiki non da' piu': come da zero.
  const ev = 58, W = '2021-05-31T00:00Z'
  const glob = [g(ev, '2025-11-18T05:00Z', '2025-12-02T15:00Z')]
  const ferma = [j(201, ev, 'wiki', W, '2025-11-18T05:00Z', false), j(202, ev, 'mirror', '2025-11-18T05:00Z', '2025-12-02T15:00Z'),
                 j(203, ev, 'wiki', '2025-12-20T00:00Z', null, false)]
  const conClear = dopoUnaSettimana(ferma, ev, W, glob, clearDi({ 203: ['2026-01-10T00:00Z'] }))
  vale('con il clear resta, e lo dice (tengo); niente da scrivere',
    [conClear.plan.steps.length, conClear.plan.keep.map((k) => `${k.id} ${k.why}`), conClear.fermo], [0, ['203 wiki'], true])
  const senza = dopoUnaSettimana(ferma, ev, W, glob)
  vale('senza clear si toglie nello stesso giro: come da zero, e il giro dopo non cambia niente',
    [diEvento(senza, ev).map((r) => `${r.id} ${vista(r)}`), (senza.plan.dropStray ?? []).map((x) => `${x.id} ${x.at}`), senza.plan.keep.length, senza.fermo,
      forma(senza.runs, ev) === forma(daZero(ev, W, glob), ev)],
    [['201 wiki 2021-05-31T00:00 → 2025-11-18T05:00 ?', '202 mirror 2025-11-18T05:00 → 2025-12-02T15:00'], ['203 201'], 0, true, true])
  // la run della data adottata dalla finestra della stessa uscita (non e'
  // piu' una run del wiki): l'altra run del wiki senza clear si toglie lo
  // stesso. Restava chiusa davanti alla copia, dove da zero non c'e' niente.
  const ev2 = 59, W2 = '2025-03-01T00:00Z'
  const glob2 = [g(ev2, '2025-03-01T05:00Z', '2025-03-15T15:00Z')]
  const due = dopoUnaSettimana([j(204, ev2, 'wiki', '2019-01-01T00:00Z', W2, false), j(205, ev2, 'wiki', W2, null, false)], ev2, W2, glob2)
  vale('...anche quando la run della data diventa la copia (adottata)',
    [diEvento(due, ev2).map((r) => `${r.id} ${vista(r)}`), due.plan.adopt.map((x) => x.id), (due.plan.dropStray ?? []).map((x) => `${x.id} ${x.at}`), due.fermo,
      forma(due.runs, ev2) === forma(daZero(ev2, W2, glob2), ev2)],
    [['205 mirror 2025-03-01T05:00 → 2025-03-15T15:00'], ['205'], ['204 205'], true, true])
}

console.log('\ndue run del wiki e due finestre a poche ore: nessun incrocio, l\'evento non resta fermo')
{
  // dbg2859 (simulazione del verificatore): la run del wiki ferma per i
  // clear al 2023, quella alla data (14 Jan 2025) con due clear del
  // 2025-2026, e due finestre Global a mano a cavallo della data. La prima
  // finestra prendeva la run alla data, la seconda quella del 2023: le due
  // run si incrociavano, nessun ordine di scritture lo fa, e l'evento
  // restava fermo ogni settimana ("piano non applicabile"), anche per la
  // finestra di giugno.
  const ev = 61, W = '2025-01-14T00:00Z'
  const glob = [{ ...g(ev, '2025-01-13T06:30Z', '2025-01-14T16:30Z'), source: 'manual' }, { ...g(ev, '2025-01-14T16:30Z', '2025-01-27T09:30Z'), source: 'manual' },
                g(ev, '2025-06-26T15:00Z', '2025-07-18T01:00Z')]
  const japan = [j(102, ev, 'manual', '2023-05-07T05:00Z', '2023-05-17T05:00Z'), j(104, ev, 'wiki', '2023-06-06T00:00Z', W, false),
                 j(101, ev, 'wiki', W, null, false)]
  const x = dopoUnaSettimana(japan, ev, W, glob, clearDi({ 101: ['2026-03-13T08:49:51Z', '2025-12-16T03:36:35Z'], 102: ['2026-11-12T13:54:50Z'] }))
  vale('nessun piano fermo: la run coi clear resta (le finestre sono conflitti contro di lei, tengo), quella del 2023 senza clear si toglie',
    [x.errore ?? null, x.plan.conflict.map((c) => `${c.why} ${c.run ?? c.detail}`), diEvento(x, ev).map((r) => `${r.id} ${vista(r)}`),
      x.plan.keep.map((k) => `${k.id} ${k.why}`), x.fermo],
    [null, ['run 101', 'run 101', 'run 101'], ['102 manual 2023-05-07T05:00 → 2023-05-17T05:00', '101 wiki 2025-01-14T00:00 → aperta ?'], ['101 fissa'], true])
  // la stessa con la run alla data ferma per una missione (pinned, senza
  // clear: la regola dei clear non c'entra). Le finestre prendevano le due
  // run incrociate; ora nell'ordine: la prima prende quella alla data, la
  // seconda ha una copia nuova
  const p = giro('incrocio con una missione', { globalRuns: glob, japanRuns: japan, wikiJapan: new Map([[ev, ora(W)]]), pinned: new Set(['101']) })
  // Il piano che non si puo' scrivere si rifa' con i divieti della regola
  // dei clear (seed 2062 della simulazione): due run del wiki ferme (quella
  // del 2020 con un clear scelto nel builder, fuori; quella del giorno dopo
  // la data con dei clear fino al 2026) e una finestra alle 15:00 UTC del
  // giorno della data. La finestra adottava la run coi clear e chiudeva
  // l'altra, in un ordine di scritture che non c'e', e l'evento restava
  // fermo ogni settimana. Il divieto (i clear resterebbero fuori dalla
  // finestra) toglie proprio l'adozione: la finestra e' un conflitto
  // contro la run coi clear, detto a ogni giro, e la run del 2020 (il suo
  // clear e' gia' fuori) va alla data del wiki, come da zero. Senza il
  // divieto il piano si rifaceva con la finestra in conflitto e la run del
  // 2020 ferma sopra la data.
  const ev2 = 63, W2 = '2025-01-18T00:00Z'
  const q = giro('un piano che non si scrive, rifatto coi divieti', { globalRuns: [g(ev2, '2025-01-18T15:00Z', '2025-01-29T01:00Z')],
    japanRuns: [j(221, ev2, 'wiki', '2020-04-26T00:00Z', '2025-01-19T00:00Z', false), j(222, ev2, 'wiki', '2025-01-19T00:00Z', '2026-12-16T06:30Z', false),
                j(223, ev2, 'manual', '2026-12-16T06:30Z', '2026-12-23T06:30Z')],
    wikiJapan: new Map([[ev2, ora(W2)]]), pinned: new Set(['223']),
    clears: clearDi({ 222: ['2026-04-23T12:06Z', '2026-11-19T08:53Z'], 221: ['2026-12-01T16:23Z'] }) })
  vale('...un piano scritto: il conflitto contro la run coi clear (che resta com\'era, tengo), la run del 2020 alla data',
    [q.plan.conflict.map((c) => `${c.why} ${c.run ?? c.detail}`), q.perEvento(ev2).map((r) => `${r.id} ${vista(r)}`), q.plan.keep.map((k) => `${k.id} ${k.why}`)],
    [['run 222'], ['221 wiki 2025-01-18T00:00 → 2025-01-19T00:00 ?', '222 wiki 2025-01-19T00:00 → 2026-12-16T06:30 ?', '223 manual 2026-12-16T06:30 → 2026-12-23T06:30'],
      ['222 wiki']])
  vale('...con una missione al posto dei clear: nessun piano fermo, la run alla data (stesso id) prende la prima finestra',
    [p.plan.conflict.map((c) => c.why), p.perEvento(ev).filter((r) => r.source === 'mirror').map((r) => `${r.id.startsWith('n') ? 'nuova' : r.id} ${vista(r)}`)],
    [[], ['101 mirror 2025-01-13T06:30 → 2025-01-14T16:30', 'nuova mirror 2025-01-14T16:30 → 2025-01-27T09:30', 'nuova mirror 2025-06-26T15:00 → 2025-07-18T01:00']])
}

console.log('\nuna finestra bloccata e la copia della finestra prima che ci arriva: conflitti, non un evento fermo')
{
  // seed 134 della simulazione r4: due finestre Global a mano a un'ora una
  // dall'altra, la seconda bloccata da una run del wiki ferma per un clear
  // che ci comincia dentro. La seconda finestra lascia la sua copia dov'era
  // (un conflitto, come in load-windows), ma la copia della prima si
  // allungava fin dentro di lei: il piano non si poteva scrivere, e l'evento
  // restava fermo per sempre ("piano non applicabile"). Ora anche la prima
  // finestra e' un conflitto (contro quella copia), come load-windows fa
  // con una run del gioco che comincia dentro la finestra e non si sa
  // sistemare, e il piano si scrive.
  const ev = 64, W = '2021-05-31T00:00Z'
  const glob = [{ ...g(ev, '2025-10-16T05:00Z', '2025-10-17T06:00Z'), source: 'manual' }, { ...g(ev, '2025-10-17T06:00Z', '2025-10-31T05:00Z'), source: 'manual' }]
  const p = giro('una finestra bloccata accanto a un\'altra', { globalRuns: glob, wikiJapan: new Map([[ev, ora(W)]]),
    japanRuns: [j(231, ev, 'wiki', W, '2025-10-16T05:00Z', false), j(232, ev, 'mirror', '2025-10-16T05:00Z', '2025-10-17T05:00Z', false),
                j(233, ev, 'mirror', '2025-10-17T05:00Z', '2025-10-17T06:00Z', false), j(234, ev, 'wiki', '2025-10-19T00:00Z', null, false)],
    clears: clearDi({ 234: ['2025-11-09T21:39Z'] }) })
  vale('nessun piano fermo: le due finestre in conflitto (contro la copia rimasta e contro la run coi clear), niente da scrivere, tengo',
    [p.plan.conflict.map((c) => `${c.why} ${c.run ?? c.detail}`), p.plan.steps.length, p.plan.keep.map((k) => `${k.id} ${k.why}`).sort()],
    [['run 233', 'run 234'], 0, ['232 conflict', '233 conflict', '234 wiki']])
}

console.log('\nla run del wiki che va alla data, e quella che finiva dove lei cominciava: in un giro solo')
{
  // Due run del wiki: una ferma per un clear del 2020, chiusa dove comincia
  // l'altra (2021); la data del wiki cinque ore prima di una run a mano (il
  // passo 6 non c'e'), e la seconda la copre: va alla data (7b). La prima
  // finisce dove comincia la prossima run (il passo 7), ma il 7 girava
  // prima del 7b: la allungava solo il giro dopo.
  const ev = 62, W = '2025-03-01T00:00Z'
  const p = giro('due run del wiki, una alla data', { globalRuns: [], wikiJapan: new Map([[ev, ora(W)]]),
    japanRuns: [j(211, ev, 'wiki', '2020-01-01T00:00Z', '2021-06-01T00:00Z', false), j(212, ev, 'wiki', '2021-06-01T00:00Z', '2025-03-01T05:00Z', false),
                j(213, ev, 'manual', '2025-03-01T05:00Z', '2025-03-10T05:00Z')],
    clears: clearDi({ 211: ['2020-06-01T00:00Z'] }) })
  vale('la seconda alla data, la prima fino a lei, nello stesso giro; tengo la prima',
    [p.perEvento(ev).map((r) => `${r.id} ${vista(r)}`), p.plan.keep.map((k) => `${k.id} ${k.why}`)],
    [['211 wiki 2020-01-01T00:00 → 2025-03-01T00:00 ?', '212 wiki 2025-03-01T00:00 → 2025-03-01T05:00 ?', '213 manual 2025-03-01T05:00 → 2025-03-10T05:00'], ['211 wiki']])
}

console.log('\nla regola dei clear: una run del wiki non si adotta se i suoi clear restano fuori')
{
  // Una run del wiki del 2025 (aperta: la run Japan attiva fino al primo
  // giro dello specchio) con un clear Japan del 2026, e la finestra Global
  // dello stesso giorno: il passo 3 la adottava, e il clear finiva fuori
  // dalla copia (repro-adopt-pinned). Ora resta com'e', e la finestra e' un
  // conflitto contro di lei, detto a ogni giro.
  const ev = 52
  const glob = [g(ev, '2025-03-01T05:00Z', '2025-03-15T15:00Z')]
  const japan = [j(60, ev, 'wiki', '2025-03-01T00:00Z', null, false)]
  const x = dopoUnaSettimana(japan, ev, '2025-03-01T00:00Z', glob, clearDi({ 60: ['2026-02-01T00:00Z'] }))
  vale('la run del wiki resta aperta col suo clear; la finestra e\' un conflitto; tengo',
    [diEvento(x, ev).map((r) => `${r.id} ${vista(r)}`), x.plan.adopt.length, x.plan.conflict.map((c) => `${c.why} ${c.run}`),
      x.plan.keep.map((k) => `${k.id} ${k.why}`), x.fermo],
    [['60 wiki 2025-03-01T00:00 → aperta ?'], 0, ['run 60'], ['60 fissa'], true])
  // con il clear dentro la finestra si adotta, come senza clear
  const y = dopoUnaSettimana(japan, ev, '2025-03-01T00:00Z', glob, clearDi({ 60: ['2025-03-05T00:00Z'] }))
  vale('...con il clear dentro la finestra: adottata (stesso id)', [diEvento(y, ev).map((r) => `${r.id} ${vista(r)}`), y.plan.adopt.map((a) => a.id), y.fermo],
    [['60 mirror 2025-03-01T05:00 → 2025-03-15T15:00'], ['60'], true])
  // con il clear in una replica dopo: la run del wiki si chiude, e lo
  // scambio di mirror-japan.mjs porta la sua riga nella copia della replica
  // (il primo giro in produzione). Il piano lo dice (spinte)
  const glob2 = [...glob, g(ev, '2026-01-29T05:00Z', null, false)]
  const z = dopoUnaSettimana(japan, ev, '2025-03-01T00:00Z', glob2, clearDi({ 60: ['2026-02-01T00:00Z'] }))
  vale('...con il clear nella replica dopo: non adottata ma chiusa all\'inizio della prima finestra, da scambiare (spinte), nessun conflitto',
    [z.plan.adopt.length, z.plan.spinte.map((p) => p.id), z.plan.conflict.length], [0, ['60'], 0])
}

console.log('\nla regola dei clear: i clear gia\' fuori, le copie, e la run del wiki che va alla data')
{
  // 612048 dopo il primo giro: la run del wiki del 2020 chiusa all'inizio
  // della prima copia, una seconda copia aperta. Un clear di oggi attaccato
  // nel builder alla run del 2020 (fuori dalla sua corsa): il piano non
  // cambia niente, e non la da' da scambiare (spinte vuote).
  const ev = 53
  const glob = [g(ev, '2025-07-07T01:00Z', '2026-01-27T02:00Z'), g(ev, '2026-01-29T05:00Z', null, false)]
  const japan = [j(465, ev, 'wiki', '2020-01-29T00:00Z', '2025-07-07T01:00Z', false), j(2090, ev, 'mirror', '2025-07-07T01:00Z', '2026-01-27T02:00Z'),
                 j(2091, ev, 'mirror', '2026-01-29T05:00Z', null, false)]
  const x = dopoUnaSettimana(japan, ev, '2020-01-29T00:00Z', glob, clearDi({ 465: ['2026-11-16T04:32:55Z'] }))
  vale('un clear di oggi sulla run del wiki chiusa: niente da scrivere, niente da scambiare, nessun tengo',
    [x.plan.steps.length, x.plan.spinte, x.plan.keep.length, x.fermo], [0, [], 0, true])
  // ...e se il piano la accorcia (una finestra nuova prima) il clear gia'
  // fuori non la fa scambiare
  const y = dopoUnaSettimana(japan, ev, '2020-01-29T00:00Z', [g(ev, '2025-03-01T05:00Z', '2025-03-10T05:00Z'), ...glob],
    clearDi({ 465: ['2026-11-16T04:32:55Z'] }))
  vale('...anche quando una finestra nuova la chiude prima: chiusa, e nessuno scambio',
    [diEvento(y, ev)[0].id, iso(diEvento(y, ev)[0].ends_at), y.plan.spinte, y.fermo], ['465', '2025-03-01T05:00:00.000Z', [], true])

  // Una copia con un clear della sua corsa e un clear scelto nel builder
  // dopo la sua fine; la sua finestra Global si divide al --dal (set-event-
  // window --reg global): la copia segue la finestra chiusa al --dal, e il
  // clear della corsa resta fuori. Lo scambio porterebbe la corsa scelta nel
  // builder nella replica dopo: non si fa. La finestra a mano ha la sua
  // copia nuova; nessun conflitto, nessun tengo (prima la copia restava
  // com'era, con le due finestre in conflitto e le date vecchie su Japan).
  const ev4 = 56
  const x6 = dopoUnaSettimana([j(74, ev4, 'mirror', '2025-05-01T05:00Z', '2025-05-20T05:00Z')], ev4, null,
    [g(ev4, '2025-05-01T05:00Z', '2025-05-03T00:00Z', false), { ...g(ev4, '2025-05-03T00:00Z', '2025-06-10T00:00Z'), source: 'manual' }],
    clearDi({ 74: ['2025-05-10T00:00Z', '2025-06-05T00:00Z'] }))
  vale('una copia con un clear scelto nel builder segue la finestra chiusa al --dal e non si scambia; nessun conflitto, nessun tengo',
    [diEvento(x6, ev4).map((r) => `${r.id.startsWith('n') ? 'nuova' : r.id} ${vista(r)}`), x6.plan.spinte, x6.plan.conflict.length,
      x6.plan.keep.length, x6.fermo],
    [['74 mirror 2025-05-01T05:00 → 2025-05-03T00:00 ?', 'nuova mirror 2025-05-03T00:00 → 2025-06-10T00:00'], [], 0, 0, true])

  // Una copia con un clear Japan, e la sua finestra Global che si sposta di
  // cinque ore in avanti: la copia segue la finestra (stesso id), come
  // load-windows fa con una run del gioco, e il clear (scritto nella prima
  // ora) resta fuori: lo specchio lo conta, da rivedere a mano. Prima la
  // copia restava chiusa all'inizio della finestra, con una copia nuova
  // accanto: Japan aveva una corsa in piu' che Global non ha.
  const ev2 = 54
  const x2 = dopoUnaSettimana([j(70, ev2, 'mirror', '2025-05-01T05:00Z', '2025-05-15T05:00Z')], ev2, null,
    [g(ev2, '2025-05-01T10:00Z', '2025-05-15T10:00Z')], clearDi({ 70: ['2025-05-01T06:00Z'] }))
  vale('la copia del clear segue la finestra (stesso id); niente da scambiare, nessun tengo',
    [diEvento(x2, ev2).map((r) => `${r.id} ${vista(r)}`), x2.plan.update.map((x) => x.id), x2.plan.spinte, x2.plan.keep.length, x2.fermo],
    [['70 mirror 2025-05-01T10:00 → 2025-05-15T10:00'], ['70'], [], 0, true])
  // Le tre forme di una finestra che cambia sotto una copia con un clear:
  // spostata dopo il clear, spostata prima con il clear dopo la sua fine
  // nuova, accorciata prima del clear. La copia la segue ogni volta (stesso
  // id), senza conflitti e senza tengo; prima teneva le date vecchie (un
  // conflitto contro di lei, "tengo ... fissa"), o restava chiusa accanto a
  // una copia nuova con anche lei "fissa".
  const ev5 = 57
  const segue = [
    ['spostata tre giorni dopo, il clear prima del nuovo inizio', g(ev5, '2026-03-04T05:00Z', '2026-03-18T05:00Z'), '2026-03-02T00:00Z'],
    ['spostata tre giorni prima, il clear dopo la nuova fine', g(ev5, '2026-02-26T05:00Z', '2026-03-12T05:00Z'), '2026-03-13T00:00Z'],
    ['accorciata, il clear dopo la nuova fine', g(ev5, '2026-03-01T05:00Z', '2026-03-08T05:00Z'), '2026-03-10T00:00Z'],
  ].map(([nome, w, c]) => {
    const x = dopoUnaSettimana([j(77, ev5, 'mirror', '2026-03-01T05:00Z', '2026-03-15T05:00Z')], ev5, null, [w], clearDi({ 77: [c] }))
    const r = diEvento(x, ev5)
    return { nome, ok: !x.errore && x.fermo && r.length === 1 && r[0].id === '77' && iso(r[0].starts_at) === iso(w.starts_at)
      && iso(r[0].ends_at) === iso(w.ends_at) && r[0].ends_at_known && !x.plan.conflict.length && !x.plan.keep.length && !x.plan.insert.length,
    got: `${x.errore ?? forma(x.runs, ev5)}; conflitti ${x.plan.conflict.length}; tengo ${x.plan.keep.map((k) => `${k.id} ${k.why}`)}` }
  })
  tutte('una copia con un clear segue la sua finestra Global, comunque cambi', segue, (x) => x.ok)
  // ...e una copia con dei clear che nessuna finestra vuole piu', chiusa
  // dalla finestra che ne ha un'altra piu' vicina, con il clear dopo la
  // chiusura: si chiude (da scambiare con la copia della finestra, che lo
  // contiene), e resta per i clear ("tengo", "clear"), mai "fissa". Prima
  // la chiusura le era vietata: la finestra era un conflitto contro di lei.
  const x7 = dopoUnaSettimana([j(78, ev5, 'mirror', '2026-03-01T05:00Z', '2026-03-11T05:00Z'), j(79, ev5, 'mirror', '2026-03-11T05:00Z', '2026-03-25T05:00Z')],
    ev5, null, [g(ev5, '2026-03-10T05:00Z', '2026-03-25T05:00Z')], clearDi({ 78: ['2026-03-10T12:00Z'] }))
  vale('...una copia che nessuna finestra vuole, chiusa da una finestra nuova: da scambiare, tengo per i clear (non "fissa"), nessun conflitto',
    [diEvento(x7, ev5).map((r) => `${r.id} ${vista(r)}`), x7.plan.spinte.map((x) => x.id), x7.plan.keep.map((k) => `${k.id} ${k.why}`),
      x7.plan.conflict.length, x7.fermo],
    [['78 mirror 2026-03-01T05:00 → 2026-03-10T05:00 ?', '79 mirror 2026-03-10T05:00 → 2026-03-25T05:00'], ['78'], ['78 clear'], 0, true])
  // con il clear dopo le dieci la copia segue la finestra, come senza clear
  const x3 = dopoUnaSettimana([j(71, ev2, 'mirror', '2025-05-01T05:00Z', '2025-05-15T05:00Z')], ev2, null,
    [g(ev2, '2025-05-01T10:00Z', '2025-05-15T10:00Z')], clearDi({ 71: ['2025-05-02T06:00Z'] }))
  vale('...con il clear dentro la finestra nuova la segue (stesso id)', [diEvento(x3, ev2).map((r) => `${r.id} ${vista(r)}`), x3.fermo],
    [['71 mirror 2025-05-01T10:00 → 2025-05-15T10:00'], true])

  // Una run del wiki con un clear, aperta un giorno dopo la data del wiki
  // (la data e' tornata indietro di un giorno): load-events non la sposta
  // (ha un clear), e il passo 6 non c'e' (comincia entro due giorni). Lo
  // specchio la porta alla data: allungarla non lascia fuori il clear.
  const ev3 = 55
  const x4 = dopoUnaSettimana([j(72, ev3, 'wiki', '2021-06-01T00:00Z', null, false)], ev3, '2021-05-31T00:00Z', [],
    clearDi({ 72: ['2021-06-05T00:00Z'] }))
  vale('la run del wiki col clear va alla data, un giorno prima (stesso id)', [diEvento(x4, ev3).map((r) => `${r.id} ${vista(r)}`), x4.fermo],
    [['72 wiki 2021-05-31T00:00 → aperta ?'], true])
  // un giorno dopo, con il clear nel primo giorno: resta dov'e', e lo dice
  const x5 = dopoUnaSettimana([j(73, ev3, 'wiki', '2021-05-31T00:00Z', null, false)], ev3, '2021-06-01T00:00Z', [],
    clearDi({ 73: ['2021-05-31T12:00Z'] }))
  vale('...in avanti, con il clear prima della data: resta, tengo', [diEvento(x5, ev3).map((r) => `${r.id} ${vista(r)}`),
    x5.plan.keep.map((k) => `${k.id} ${k.why}`), x5.fermo], [['73 wiki 2021-05-31T00:00 → aperta ?'], ['73 fissa'], true])
}

console.log('\nle copie vicine vanno alle finestre nel loro ordine')
{
  // Due set-event-window --reg global a poche ore (le run a mano con i
  // microsecondi di now()) e la data del wiki che cambia: la copia piu'
  // vicina, finestra per finestra, incrociava due copie (una avanti sopra
  // l'altra che tornava indietro), e l'evento restava fermo ogni settimana.
  const ev = 48
  const G = (id, source, s, e, known) => ({ id, event_id: ev, source, starts_at: s, ends_at: e, ends_at_known: known })
  const glob = [G('g1', 'game', '2025-01-01T21:00:00.000000Z', '2025-01-02T02:00:00.120456Z', false),
                G('g2', 'manual', '2025-01-02T02:00:00.120456Z', '2025-01-02T05:00:00.120456Z', true),
                G('g3', 'manual', '2025-01-02T05:00:00.120456Z', '2025-01-03T05:00:00.240912Z', false),
                G('g4', 'manual', '2025-01-03T05:00:00.240912Z', null, true)]
  const japan = [{ ...G('97', 'x', '2025-01-01T21:00:00.000000Z', '2025-01-02T05:00:00.120456Z', false), source: 'mirror' },
                 { ...G('98', 'x', '2025-01-02T05:00:00.120456Z', '2025-01-03T05:00:00.240912Z', false), source: 'mirror' },
                 { ...G('99', 'x', '2025-01-03T05:00:00.240912Z', null, true), source: 'mirror' }]
  const { plan, perEvento } = giro('copie vicine', { globalRuns: glob, japanRuns: japan, wikiJapan: new Map([[ev, ora('2025-01-04T00:00Z')]]) })
  vale('nessun piano fermo; ogni copia alla finestra dopo di lei, nell\'ordine',
    [plan.conflict.map((c) => c.why), perEvento(ev).map((r) => `${r.id} ${r.starts_at}`)],
    [['wiki'], ['97 2025-01-02T02:00:00.120456Z', '98 2025-01-02T05:00:00.120456Z', '99 2025-01-03T05:00:00.240912Z']])
  // la finestra prima non prende la copia esatta di quella dopo (a meno di
  // due giorni): la copia resta alla sua, e la prima prende la run del wiki
  const ev2 = 49
  const glob2 = [g(ev2, '2025-01-01T01:00Z', '2025-01-02T01:00Z'), g(ev2, '2025-01-02T21:00Z', '2025-01-02T22:00Z')]
  const x = dopoUnaSettimana([j(95, ev2, 'wiki', '2021-05-31T00:00Z', '2025-01-02T21:00Z', false), j(96, ev2, 'mirror', '2025-01-02T21:00Z', '2025-01-02T22:00Z')],
    ev2, '2025-01-03T00:00Z', glob2)
  vale('...e la copia esatta resta alla sua finestra: niente piano fermo, come da zero',
    [x.plan.conflict.map((c) => c.why), diEvento(x, ev2).map((r) => `${r.id} ${vista(r)}`), x.fermo,
      forma(x.runs, ev2) === forma(daZero(ev2, '2025-01-03T00:00Z', glob2), ev2)],
    [[], ['95 mirror 2025-01-01T01:00 → 2025-01-02T01:00', '96 mirror 2025-01-02T21:00 → 2025-01-02T22:00'], true, true])
}

console.log('\nla run del wiki riaperta fino a una run della stessa uscita parte dalla data')
{
  // La data del wiki (3 Dec 2024) a un'ora da una run a mano: il passo 6 non
  // c'e' (una run comincia entro due giorni), e la run del wiki riaperta fino
  // alla run a mano partiva ancora dal 28 Nov. load-events la spostava la
  // settimana dopo: due giri per un cambio solo.
  const ev = 50
  const x = dopoUnaSettimana([j(84, ev, 'wiki', '2024-11-28T00:00Z', '2024-12-01T01:00Z', false), j(85, ev, 'manual', '2024-12-03T01:00Z', '2024-12-13T01:00Z')],
    ev, '2024-12-03T00:00Z', [])
  vale('la run del wiki (stesso id) dalla data alla run a mano; il giro dopo non cambia niente',
    [diEvento(x, ev).map((r) => `${r.id} ${vista(r)}`), x.fermo],
    [['84 wiki 2024-12-03T00:00 → 2024-12-03T01:00 ?', '85 manual 2024-12-03T01:00 → 2024-12-13T01:00'], true])
  // la finestra presa da un'altra run del wiki (con dei clear, vicina alla
  // finestra): la run del wiki della data e' una in piu', e si toglie
  const ev2 = 51
  const glob2 = [{ ...g(ev2, '2025-01-01T15:00Z', '2025-01-21T15:00Z'), source: 'manual' }, g(ev2, '2025-10-17T01:00Z', '2025-10-30T01:00Z')]
  const x2 = dopoUnaSettimana([j(86, ev2, 'wiki', '2025-01-01T00:00Z', '2025-06-04T00:00Z', false), j(87, ev2, 'wiki', '2025-06-04T00:00Z', '2025-10-17T01:00Z', false),
                               j(88, ev2, 'mirror', '2025-10-17T01:00Z', '2025-10-30T01:00Z')], ev2, '2025-01-01T00:00Z', glob2,
                             clearDi({ 86: ['2025-01-05T00:00Z'], 88: ['2025-10-20T00:00Z'] }))
  vale('...una run del wiki coi clear adottata: quella della data se ne va nello stesso giro',
    [diEvento(x2, ev2).map((r) => `${r.id} ${vista(r)}`), x2.plan.dropWiki.map((d) => `${d.id} ${d.copy}`), x2.fermo],
    [['86 mirror 2025-01-01T15:00 → 2025-01-21T15:00', '88 mirror 2025-10-17T01:00 → 2025-10-30T01:00'], ['87 86'], true])
}

console.log('\nla run del wiki ferma per i clear si dice anche senza una run alla data')
{
  // La copia della finestra della data del wiki ha un clear (anche uno
  // scelto nel builder, fuori): la riunione del passo 3b non si fa, alla
  // data non c'e' una run del wiki, e la run del wiki lontana, aperta e
  // tenuta dai suoi clear restava senza la riga "tengo".
  const ev = 61
  const glob = [g(ev, '2025-03-28T05:00Z', '2025-04-11T05:00Z'), g(ev, '2026-11-03T21:00Z', '2026-11-14T00:00Z')]
  const japan = [j(112, ev, 'mirror', '2025-03-28T05:00Z', '2025-04-11T05:00Z'), j(110, ev, 'wiki', '2026-11-05T00:00Z', null, false)]
  const W = new Map([[ev, ora('2025-03-28T00:00Z')]])
  const tieni = (clears) => planJapanMirror({ rules: R, globalRuns: glob, japanRuns: japan, wikiJapan: W, pinned: new Set(clears.keys()), clears })
    .keep.map((k) => `${k.id} ${k.why}`)
  const base = { 110: ['2026-11-22T03:50Z', '2026-11-26T20:37Z'] }
  vale('la copia senza clear: tengo la 110', tieni(clearDi(base)).length, 1)
  vale('la copia con un clear scelto nel builder: tengo la 110 lo stesso', tieni(clearDi({ ...base, 112: ['2026-12-31T18:16Z'] })).length, 1)
}

console.log('\nle uscite Japan delle carte')
{
  const glob = [
    { card_id: 1, released_at: '2024-12-31' },   // prima di D sul calendario giapponese
    { card_id: 2, released_at: '2025-01-01' },
    { card_id: 3, released_at: '2026-07-29' },   // ha gia' la data Japan del wiki, diversa
    { card_id: 4, released_at: '2026-09-29' },   // copia vecchia con un'altra data
    { card_id: 5, released_at: '2026-10-01' },   // copia giusta
    { card_id: 6, released_at: '2026-10-01' },   // solo Global per regola
    { card_id: 7, released_at: '2026-01-15' },   // data Japan a mano
  ]
  const jp = [
    { card_id: 3, released_at: '2025-01-29', source: 'wiki' },
    { card_id: 4, released_at: '2026-09-28', source: 'mirror' },
    { card_id: 5, released_at: '2026-10-01', source: 'mirror' },
    { card_id: 6, released_at: '2026-10-01', source: 'mirror' },
    { card_id: 7, released_at: '2026-01-10', source: 'manual' },
    { card_id: 8, released_at: '2025-05-01', source: 'mirror' },   // la carta non e' piu' uscita su Global
  ]
  const p = planCardMirror({ globalReleases: glob, japanReleases: jp,
    rules: { ...R, globalOnlyCards: [{ card: 6, why: 'carta di una collaborazione solo Global' }] } })
  vale('nuova: solo la carta uscita da D senza data Japan', p.insert, [{ card_id: 2, released_at: '2025-01-01' }])
  vale('aggiornata: la copia con la data vecchia', p.update, [{ card_id: 4, released_at: '2026-09-29', was: '2026-09-28' }])
  vale('una data Japan del wiki o a mano non si tocca, anche diversa', p.skip.map((x) => `${x.card_id} ${x.source}`), ['3 wiki', '7 manual'])
  vale('tolte: la carta solo Global e quella senza piu\' l\'uscita Global', p.delete.map((x) => x.card_id), [6, 8])
  vale('invariata la copia giusta; la carta del 2024-12-31 fuori', [p.unchanged, p.since], [1, '2025-01-01'])

  // Le carte che solo il gioco conosce: la data Global e' il giorno UTC di
  // open_at, e dalle 15:00 UTC a Tokyo e' gia' il giorno dopo (il lotto del
  // decimo anniversario giapponese, 2025-01-28 alle 21:00 UTC).
  const q = planCardMirror({
    globalReleases: [
      { card_id: 11, released_at: '2025-01-28', source: 'game' },   // 21:00 UTC: il 29 a Tokyo
      { card_id: 12, released_at: '2026-07-29', source: 'game' },   // 05:00 UTC: lo stesso giorno
      { card_id: 13, released_at: '2024-12-31', source: 'game' },   // 16:00 UTC: gia' D a Tokyo
      { card_id: 14, released_at: '2024-12-31', source: 'game' },   // 14:59 UTC: prima di D
      { card_id: 15, released_at: '2025-01-28', source: 'wiki' },   // del wiki: il suo giorno resta
      { card_id: 16, released_at: '2025-02-10', source: 'game' },   // open_at di un altro giorno: il giorno Global
    ],
    japanReleases: [{ card_id: 12, released_at: '2026-07-29', source: 'mirror' }],
    openAt: new Map([[11, ora('2025-01-28T21:00Z')], [12, ora('2026-07-29T05:00Z')], [13, ora('2024-12-31T16:00Z')],
                     [14, ora('2024-12-31T14:59Z')], [15, ora('2025-01-28T21:00Z')], [16, ora('2025-01-28T21:00Z')]]),
    rules: R,
  })
  vale('il giorno giapponese di open_at per le carte del gioco, il giorno Global per le altre',
    q.insert.map((x) => `${x.card_id} ${x.released_at}`), ['11 2025-01-29', '13 2025-01-01', '15 2025-01-28', '16 2025-02-10'])
  vale('...e lo dice', q.shifted, [{ card_id: 11, global: '2025-01-28', japan: '2025-01-29' }, { card_id: 13, global: '2024-12-31', japan: '2025-01-01' }])
  vale('...la copia dello stesso giorno resta', q.unchanged, 1)
}

console.log(`\n  ${passes} PASS, ${fails} FAIL`)
process.exit(fails ? 1 : 0)
