// Lo stato del builder dei clear (lib/clears/builder-stato.ts): il reducer
// che il componente client usa e il payload che manda alla Server Action.
// Il payload deve passare parseBuilderPayload, lo stesso controllo che fa
// l'azione, altrimenti il builder manderebbe clear che il server rifiuta.
//
// Funzioni pure, niente database.
import {
  payloadDa, reducer, statoVuoto, type Azione, type BuilderStato, type CartaScelta,
} from '@/lib/clears/builder-stato'
import { LIMITS, parseBuilderPayload } from '@/lib/clears/validate'

let fails = 0
let passes = 0
function check(nome: string, ok: boolean, dettaglio = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${nome}${dettaglio ? `  (${dettaglio})` : ''}`)
  if (ok) passes++
  else fails++
}

const carta = (id: number): CartaScelta => ({ id, name: `Card ${id}`, epithet: null, type: 'AGL', class: 'Super', thumb: null })
const applica = (s: BuilderStato, ...az: Azione[]) => az.reduce(reducer, s)
const ruoli = (s: BuilderStato, l = 0) => s.squadre[l].slots.map((x) => x.role[0]).join('')

console.log('le carte e i ruoli')
let s = statoVuoto('42')
check('parte con una squadra vuota di 7', s.squadre.length === 1 && s.squadre[0].slots.length === 7 && s.squadre[0].slots.every((x) => !x.carta))
s = applica(s, { t: 'carta', l: 0, i: 2, carta: carta(10) })
check('la prima carta diventa leader', ruoli(s) === 'mmlmmmm', ruoli(s))
s = applica(s, { t: 'carta', l: 0, i: 0, carta: carta(11) })
check('la seconda resta member', ruoli(s) === 'mmlmmmm', ruoli(s))
s = applica(s, { t: 'ruolo', l: 0, i: 0, role: 'leader' })
check('un leader nuovo toglie il vecchio', ruoli(s) === 'lmmmmmm', ruoli(s))
s = applica(s, { t: 'ruolo', l: 0, i: 2, role: 'friend' })
check('il friend su un altro slot', ruoli(s) === 'lmfmmmm', ruoli(s))
s = applica(s, { t: 'ruolo', l: 0, i: 0, role: 'friend' })
check('il friend spostato sul leader lo fa friend e basta', ruoli(s) === 'fmmmmmm', ruoli(s))
s = applica(s, { t: 'ruolo', l: 0, i: 0, role: 'leader' }, { t: 'ruolo', l: 0, i: 2, role: 'friend' })
s = applica(s, { t: 'carta', l: 0, i: 2, carta: carta(11) })
check('sostituire una carta tiene il ruolo dello slot', ruoli(s) === 'lmfmmmm' && s.squadre[0].slots[2].carta?.id === 11)
s = applica(s, { t: 'svuota', l: 0, i: 2 })
check('svuotare toglie carta e ruolo', !s.squadre[0].slots[2].carta && ruoli(s) === 'lmmmmmm')

console.log('il payload')
let pieno = statoVuoto('42')
for (let i = 0; i < 7; i++) pieno = applica(pieno, { t: 'carta', l: 0, i, carta: carta(100 + i) })
pieno = applica(pieno, { t: 'ruolo', l: 0, i: 6, role: 'friend' })
const p1 = parseBuilderPayload(payloadDa(pieno))
check('una squadra piena passa il controllo dell\'azione', p1.ok, p1.ok ? '' : p1.error)
const vuoti = parseBuilderPayload(payloadDa(applica(pieno, { t: 'svuota', l: 0, i: 3 })))
check('uno slot vuoto dice di scegliere una carta', !vuoti.ok && /Pick a card/.test(vuoti.error), vuoti.ok ? '' : vuoti.error)
const senzaFriend = parseBuilderPayload(payloadDa(applica(pieno, { t: 'ruolo', l: 0, i: 6, role: 'member' })))
check('senza friend si rifiuta', !senzaFriend.ok && /friend/.test(senzaFriend.error))
const turni = payloadDa(applica(pieno, { t: 'campo', campo: 'turns', valore: '12' }))
check('i turni diventano un numero', turni.turns === 12)
check('turni vuoti: null', payloadDa(pieno).turns === null)
check('senza nota la lingua è null', payloadDa(pieno).lang === null)
const nota = payloadDa(applica(pieno, { t: 'campo', campo: 'note', valore: '  ciao  ' }))
check('la nota è ripulita e porta la lingua', nota.note === 'ciao' && nota.lang === 'en')

console.log('i cambi di squadra')
let c = applica(pieno, { t: 'aggiungi_cambio' })
check('il cambio copia la squadra precedente', c.squadre.length === 2 &&
  c.squadre[1].slots.every((x, k) => x.carta?.id === c.squadre[0].slots[k].carta?.id && x.role === c.squadre[0].slots[k].role))
c = applica(c, { t: 'carta', l: 1, i: 4, carta: carta(999) })
check('cambiare il cambio non tocca la partenza', c.squadre[0].slots[4].carta?.id === 104 && c.squadre[1].slots[4].carta?.id === 999)
const senzaNome = parseBuilderPayload(payloadDa(c))
check('un cambio senza nome si rifiuta', !senzaNome.ok && /change 1/.test(senzaNome.error))
c = applica(c, { t: 'squadra', l: 1, campo: 'label', valore: 'From phase 3' })
const conNome = parseBuilderPayload(payloadDa(c))
check('con il nome passa', conNome.ok && conNome.value.lineups[1].label === 'From phase 3' && conNome.value.lineups[0].label === null)
for (let k = 0; k < 5; k++) c = applica(c, { t: 'aggiungi_cambio' })
check(`al massimo ${LIMITS.lineups - 1} cambi`, c.squadre.length === LIMITS.lineups)
c = applica(c, { t: 'togli_cambio', l: 2 }, { t: 'togli_cambio', l: 0 })
check('si toglie un cambio, mai la partenza', c.squadre.length === LIMITS.lineups - 1 && c.squadre[0].slots[4].carta?.id === 104)

console.log('le prove')
let p = pieno
for (let k = 0; k < 5; k++) p = applica(p, { t: 'aggiungi_prova' })
check(`al massimo ${LIMITS.proofs} prove`, p.proofs.length === LIMITS.proofs)
p = applica(p, { t: 'prova', i: 0, kind: 'screenshot', url: ' https://imgur.com/a/x ' })
const pp = payloadDa(p)
check('le righe vuote si ignorano, gli spazi si tolgono', pp.proofs.length === 1 && pp.proofs[0].url === 'https://imgur.com/a/x' && pp.proofs[0].kind === 'screenshot')
p = applica(p, { t: 'togli_prova', i: 0 })
check('togliere una prova', p.proofs.length === LIMITS.proofs - 1 && payloadDa(p).proofs.length === 0)

console.log(fails ? `\n  ${passes} verdi, ${fails} rosse\n` : `\n  ${passes} verifiche, TUTTO VERDE\n`)
process.exit(fails ? 1 : 0)
