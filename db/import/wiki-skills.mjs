// I parametri del template Characters, letti come li legge MediaWiki.
//
// field() in wiki-card.mjs prende un campo solo a inizio riga e solo fino
// a fine riga: va bene per rarita', date e immagini, non per i testi. Il
// wiki mette piu' parametri sulla stessa riga ("|SA type = Ki |SA name =
// Galick Gun"), e la passiva va spesso a capo dopo un <hr>: a fine riga
// se ne perdeva la seconda meta'. Qui il template si divide come fa il
// wiki: sui "|" che non stanno dentro [[...]], {{...}}, <ref>...</ref> o un
// commento. Un "|" dentro [[File:x.png|30px|link=Category:TEQ]] non chiude
// niente, e nemmeno quelli dentro le note.

// Dove cominciano i parametri: dopo il primo {{Characters. Le pagine con
// piu' forme (tabber: Beerus e Beerus in Rage) hanno un template per
// forma, e la carta e' la prima, come per l'id in wiki-card.mjs. Senza
// template (i frammenti dei test) si legge tutto il testo.
// at: da dove cercare il template, per le schede dopo la prima.
const CHARACTERS = /\{\{\s*Characters\b/gi
function paramsStart(txt, at) {
  CHARACTERS.lastIndex = at
  const m = CHARACTERS.exec(txt)
  return m ? m.index + m[0].length : at
}

// Il primo indice dopo la fine di cio' che comincia in i e va saltato in
// blocco (nota o commento), oppure -1.
function skipBlock(txt, i) {
  if (txt.startsWith('<!--', i)) {
    const e = txt.indexOf('-->', i + 4)
    return e < 0 ? txt.length : e + 3
  }
  if (/^<ref\b/i.test(txt.slice(i, i + 5))) {
    const close = txt.indexOf('>', i)
    if (close < 0) return -1
    if (txt[close - 1] === '/') return close + 1            // <ref name="x"/>
    const e = txt.slice(close).search(/<\/ref\s*>/i)
    if (e < 0) return close + 1
    const end = close + e
    return txt.indexOf('>', end) + 1
  }
  return -1
}

// Divide i parametri al livello piu' esterno del template.
function splitParams(txt, at) {
  const parts = []
  let link = 0, tpl = 0, from = paramsStart(txt, at), i = from
  while (i < txt.length) {
    const skip = skipBlock(txt, i)
    if (skip > i) { i = skip; continue }
    const two = txt.slice(i, i + 2)
    if (two === '[[') { link++; i += 2; continue }
    if (two === ']]' && link > 0) { link--; i += 2; continue }
    if (two === '{{') { tpl++; i += 2; continue }
    if (two === '}}') {
      if (tpl > 0) { tpl--; i += 2; continue }
      break                                                  // fine del template
    }
    if (txt[i] === '|' && link === 0 && tpl === 0) {
      parts.push(txt.slice(from, i))
      from = i + 1
    }
    i++
  }
  parts.push(txt.slice(from, i))
  return parts.slice(1)                 // prima del primo "|" c'e' solo il nome
}

// Una chiave vera e' un nome ("SA name", "12 ki"): se prima dell'"=" ci
// sono markup o tag, l'"=" sta nel testo e il pezzo continua il valore
// precedente (un "|" sfuggito al conteggio, un attributo HTML).
const KEY = /^[A-Za-z0-9][^<>[\]{}\n]*$/

// chiave -> valore grezzo, gia' senza spazi ai lati. Vince il primo valore
// non vuoto, come field() vede la prima riga.
export function templateParams(txt, at = 0) {
  const out = new Map()
  let last = null
  for (const part of splitParams(txt ?? '', at)) {
    const eq = part.indexOf('=')
    const key = eq > 0 ? part.slice(0, eq).trim() : ''
    if (!KEY.test(key)) {
      if (last) out.set(last, `${out.get(last)}|${part}`)
      continue
    }
    const value = part.slice(eq + 1)
    if (!out.has(key) || !out.get(key).trim()) { out.set(key, value); last = key } else last = null
  }
  for (const [k, v] of out) out.set(k, v.trim())
  return out
}

// I parametri di ogni scheda della pagina, nell'ordine: la prima e' la
// carta, le altre le sue forme (Rage, Giant Ape, Standby).
export function characterForms(w) {
  // una regex nuova: matchAll copierebbe il lastIndex lasciato da paramsStart
  const at = [...(w ?? '').matchAll(new RegExp(CHARACTERS.source, 'gi'))].map((m) => m.index)
  return at.length ? at.map((i) => templateParams(w, i)) : [templateParams(w)]
}

// Il valore di un parametro, o null se manca o e' vuoto. Le chiavi del
// template sono sensibili alle maiuscole, ma il wiki scrive a mano
// "Active skill" e "Active Skill": se la forma esatta manca, vale l'altra.
export function paramOf(params, key) {
  let v = params.get(key)
  if (v === undefined) {
    const k = key.toLowerCase()
    for (const [kk, vv] of params) if (kk.toLowerCase() === k) { v = vv; break }
  }
  return v ? v : null
}

// inlineField(testo, chiave): il campo anche a meta' riga, fino al "|"
// del campo dopo (fuori dai link) o alla riga che apre il campo dopo.
// Un campo vuoto resta vuoto: non si prende la riga successiva.
export const inlineField = (txt, key) => paramOf(templateParams(txt), key)

// ---------------------------------------------------------------- pulizia

// Le note con nome: <ref name="[2]">testo</ref> definisce, <ref name="[2]"/>
// o <ref name="[2]"></ref> riusa. Le EZA riusano spesso una nota della
// base (le tre super di Beerus), quindi la mappa e' della pagina intera,
// e vale la prima definizione anche se arriva dopo l'uso.
const REF_NAME = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/i
const refName = (attrs) => {
  const m = REF_NAME.exec(attrs ?? '')
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null
}
export function refsOf(txt) {
  const out = new Map()
  for (const m of (txt ?? '').matchAll(/<ref\b([^>]*[^/>])?>([\s\S]*?)<\/ref\s*>/gi)) {
    const name = refName(m[1])
    if (name && m[2].trim() && !out.has(name)) out.set(name, m[2])
  }
  return out
}

// Le icone dentro il testo dicono qualcosa ("[[File:TEQ icon.png]] Type
// ATK +60%"): tornano parole, il resto delle immagini se ne va. Gli
// stati del nemico (St 0100 = Stun) hanno il nome nel link=.
const CLASS = { S: 'Super ', E: 'Extreme ' }
function fileText(inner) {
  const [file, ...opts] = inner.split('|')
  const f = file.replace(/^\s*file:\s*/i, '').replace(/[_\s]+/g, ' ').trim()
  let m = f.match(/^([SE])?(AGL|TEQ|INT|STR|PHY) icon\b/i)
  if (m) return (m[1] ? CLASS[m[1].toUpperCase()] : '') + m[2].toUpperCase()
  m = f.match(/^(Rainbow|Ki|Orb) icon\b/i)
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
  if (/down arrow/i.test(f)) return ' ↓'
  if (/^Global server\b/i.test(f)) return ' (Global) '
  if (/^Japan server\b/i.test(f)) return ' (Japan) '
  const link = opts.map((o) => o.match(/^\s*link\s*=\s*(.+)$/i)?.[1]).find(Boolean)
  if (/^St \d+/i.test(f) && link && !/^:?category:/i.test(link)) return link.trim()
  return ''
}

// {{Passive|UpArrow}} e' la freccia che il gioco mette accanto al valore:
// toglierla cambia il senso (DownArrow e' un calo, non un aumento).
// Permanent e OneTime sono le icone di "resta per tutta la battaglia" e
// "una volta sola", sempre in testa al punto elenco.
const PASSIVE = { uparrow: ' ↑', downarrow: ' ↓', downredarrow: ' ↓',
                  permanent: ' (Permanent) ', onetime: ' (Once only) ' }
const templateText = (inner) => {
  const [name, arg] = inner.split('|').map((s) => s.trim().toLowerCase())
  return name === 'passive' ? (PASSIVE[arg] ?? '') : ''
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }

// Il wikitext senza markup, con gli a capo come righe. Le note qui sono
// gia' state tolte.
function cleanBody(s) {
  let t = s.replace(/<!--[\s\S]*?-->/g, '')
  // i template annidati non ci sono nei testi delle skill; due giri
  // bastano comunque a toglierne uno dentro l'altro
  for (let k = 0; k < 2; k++) t = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => templateText(inner))
  t = t
    .replace(/\[\[\s*file:([^\]]*)\]\]/gi, (_, inner) => fileText(inner))
    .replace(/\[\[:?(?:category:)?([^\]|]+)\|([^\]]*)\]\]/gi, '$2')
    .replace(/\[\[:?(?:category:)?([^\]|]+)\]\]/gi, '$1')
    .replace(/<br\s*\/?>|<hr\s*\/?>|<\/?b\s*>|<\/?p\s*>/gi, '\n')
    // un segnaposto dell'editor rimasto nel testo ("mega-c<u>Underline</u>olossal")
    .replace(/<u>\s*Underline\s*<\/u>/gi, '')
    .replace(/<[^>]+>/g, '')
    // i refusi del wiki: un link mai chiuso ("[[Pagina|testo"), un tag
    // spezzato ("=b>Basic", "</b>>", "Ki +3< and")
    .replace(/\[\[[^\]|\n]*\|/g, '').replace(/\[\[|\]\]/g, '')
    .replace(/<(?=\s)/g, '').replace(/(^|\n)\/?b>/g, '$1').replace(/[<>]+(?=\s*(\n|$))/g, '')
    .replace(/'''?/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/gi, (_, e) => ENTITIES[e.toLowerCase()])
  return t.split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim().replace(/^-\s*(?=\S)/, '- ').replace(/ ([,.;:)])/g, '$1'))
    .filter((l) => l && l !== '-')
    .join('\n')
}

// cleanSkill(grezzo, note della pagina) -> { text, details }
//   text: le righe del testo ("- " = punto elenco), null se non resta niente
//   details: il testo delle note, nell'ordine in cui compaiono, una volta
//            sola ciascuna. Una nota vuota col nome prende la definizione.
export function cleanSkill(raw, refs = new Map()) {
  if (raw == null) return { text: null, details: [] }
  const details = []
  const note = (body) => {
    const d = cleanBody(body ?? '').replace(/\n/g, ' ').trim()
    if (d && !details.includes(d)) details.push(d)
    // uno spazio e non niente: "turn<ref>...</ref>Raises" non deve
    // diventare "turnRaises"; gli spazi doppi li toglie cleanBody
    return ' '
  }
  const noRefs = String(raw)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b([^>]*?)\/>/gi, (_, attrs) => note(refs.get(refName(attrs))))
    .replace(/<ref\b([^>]*)>([\s\S]*?)<\/ref\s*>/gi,
             (_, attrs, body) => note(body.trim() ? body : refs.get(refName(attrs))))
  const text = cleanBody(noRefs)
  return { text: text || null, details }
}

// ---------------------------------------------------------------- skill

// Il suffisso del livello: "LS description Z" e' l'EZA, "PS description
// SZ" la Super EZA. Il wiki li scrive solo per i campi che cambiano.
const TIERS = [['base', ''], ['eza', ' Z'], ['seza', ' SZ']]

// Le skill che vivono in un'altra scheda della pagina: il Finish attack
// sta sulla scheda della modalita' Standby, non su quella della carta, e
// lo stesso capita a qualche attiva, dominio o Unit Super. Per questi
// tipi, se la prima scheda non ne ha, vale la prima scheda che li ha.
// Leader, super, Ultra, passiva e trasformazione invece le hanno tutte
// le forme, ognuna la sua: la carta e' la prima.
const ANY_FORM = new Set(['active', 'standby', 'domain', 'ex_super', 'unit_super', 'finish'])

// Le skill di una carta: per ogni tipo, per ogni livello che il wiki
// documenta, una riga { kind, tier, seq, name, description, details,
// condition, ki }. Senza descrizione non c'e' riga: un "PS description =
// -" e' "nessuna passiva", non una passiva vuota.
//
// A un livello EZA senza nome passa il nome della base: il wiki scrive
// "SA name Z" solo quando cambia (92 pagine su 665 con l'EZA).
export function skillsFromPage(w) {
  const forms = characterForms(w)
  const refs = refsOf(w)
  const rows = []
  for (const kind of KINDS) {
    for (const [i, P] of forms.entries()) {
      if (i > 0 && !ANY_FORM.has(kind)) break
      const got = []
      const add = (tier, seq, { name, desc, cond, ki }) => {
        const n = cleanSkill(name, refs), d = cleanSkill(desc, refs), c = cleanSkill(cond, refs)
        if (!d.text) return
        const details = [...new Set([...n.details, ...d.details, ...c.details])]
        got.push({ kind, tier, seq, name: n.text?.replace(/\n/g, ' ') ?? null, description: d.text,
                   details, condition: c.text?.replace(/\n/g, ' ') ?? null, ki: cleanSkill(ki).text })
      }
      BUILD[kind]((k) => paramOf(P, k), add)
      if (got.length) { rows.push(...got); break }
    }
  }
  return rows
}

// un tipo con una sola skill per livello: nome, descrizione, condizione,
// tipo d'attacco; alt e' la chiave di riserva della descrizione
const simple = (keys) => (get, add) => {
  for (const [tier, z] of TIERS) {
    add(tier, 1, {
      name: keys.name ? get(keys.name + z) ?? get(keys.name) : null,
      desc: get(keys.desc + z) ?? (keys.alt ? get(keys.alt + z) : null),
      cond: keys.cond ? get(keys.cond + z) ?? get(keys.cond) : null,
      ki: keys.ki ? keys.ki.map((k) => get(k + z) ?? get(k)).find(Boolean) : null,
    })
  }
}

const BUILD = {
  leader: simple({ desc: 'LS description' }),
  super: supers,
  ultra: simple({ name: 'UltraSA name', desc: 'UltraSA description', ki: ['UltraSA type'] }),
  passive: simple({ name: 'PS name', desc: 'PS description' }),
  // un'attiva che trasforma ha spesso solo "Active skill transform"
  // ("Fuses with Kami"): e' quella la descrizione
  active: simple({ name: 'Active skill name', desc: 'Active skill', alt: 'Active skill transform',
                   cond: 'Active skill condition', ki: ['SA type Active', 'SAtype Active'] }),
  standby: simple({ name: 'Standby name', desc: 'Standby description', cond: 'Standby condition' }),
  domain: simple({ name: 'Domain name', desc: 'Domain description' }),
  transform: simple({ name: 'Transform type', desc: 'Transform condition' }),
  // Unit Super: "UnitSA name", "UnitSA name2", "UnitSA description2 Z"
  unit_super: (get, add) => {
    for (const [seq, n] of [[1, ''], [2, '2'], [3, '3']]) {
      for (const [tier, z] of TIERS) {
        add(tier, seq, {
          name: get(`UnitSA name${n}${z}`) ?? get(`UnitSA name${n}`),
          desc: get(`UnitSA description${n}${z}`),
          cond: get(`UnitSA condition${n}${z}`) ?? get(`UnitSA condition${n}`),
          ki: get(`UnitSA type${n}`),
        })
      }
    }
  },
  ex_super: simple({ name: 'EXSA name', desc: 'EXSA description', cond: 'EXSA condition', ki: ['EXSA type'] }),
  // Finish: "Finish attack name" o "Finish attack 1 name" per il primo
  finish: (get, add) => {
    for (const seq of [1, 2, 3]) {
      const f = (what) => get(`Finish attack ${seq} ${what}`) ?? (seq === 1 ? get(`Finish attack ${what}`) : null)
      add('base', seq, { name: f('name'), desc: f('description'), cond: f('condition'), ki: f('type') })
    }
  },
}
const KINDS = Object.keys(BUILD)

// Le super attack. Di solito una ("SA name", "SA description"); le forme
// con piu' super (Beerus in Rage, i Finish) hanno "SA name2", "SA name3" e
// UNA descrizione con una riga per super, separate da <br>. Se le righe
// sono tante quante i nomi, ogni super prende la sua, con le sue note;
// altrimenti la descrizione intera va alla prima e le altre restano solo
// col nome nella prima (una riga senza descrizione non si scrive).
function supers(get, add) {
  for (const [tier, z] of TIERS) {
    const names = ['', '2', '3'].map((n) => get(`SA name${n}${z}`) ?? get(`SA name${n}`))
    const kis = ['', '2', '3'].map((n) => get(`SA type${n}${z}`) ?? get(`SA type${n}`))
    const desc = get(`SA description${z}`)
    if (!desc) continue
    const many = names.filter(Boolean).length
    const lines = desc.split(/<br\s*\/?>/i).filter((l) => cleanSkill(l).text)
    if (many > 1 && names.slice(0, many).every(Boolean) && lines.length === many) {
      lines.forEach((l, i) => add(tier, i + 1, { name: names[i], desc: l, ki: kis[i] }))
    } else {
      const name = many > 1 ? names.filter(Boolean).join(' / ') : names[0]
      add(tier, 1, { name, desc, ki: kis[0] })
    }
  }
}

// I tre testi riassuntivi di card_text (ricerca, builder): la base, col
// testo intero della super anche quando le super sono piu' d'una.
export function baseTexts(w) {
  const P = templateParams(w)
  const refs = refsOf(w)
  const t = (k) => cleanSkill(paramOf(P, k), refs).text
  return { leader_skill: t('LS description'), passive: t('PS description'), super_attack: t('SA description') }
}
