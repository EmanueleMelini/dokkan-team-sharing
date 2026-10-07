// Quale area (o z_battle_stage) del database Global e' un nostro evento.
//
// I nostri eventi hanno il pageid del wiki come id, e il gioco non lo
// conosce: il ponte si costruisce con chiavi che i due lati hanno in
// comune, e nessuna basta da sola. Il join per solo nome reggeva l'84%
// degli eventi e lo 0% delle EZA, e sbagliava sulle riedizioni (la storia
// originale e il suo remake DbStory si chiamano uguali).
//
// EVENTI NORMALI, chiavi forti:
//   banner   il file di 'Event Image' del wiki == areas.event_image_path
//            ("Quest top banner 582 2.png" == quest_top_banner_582_2.png),
//            o il suo numero
//   name     il titolo senza i suffissi del wiki == areas.name
//   stages   i nostri stage coprono le quest dell'area (Jaccard >= 0,5)
// e deboli, solo come conferma:
//   anyBanner  un numero di banner altrove nella pagina (che mostra anche
//              i banner di altri eventi, quindi da solo sbaglia)
//   boss       i boss della pagina fra i nemici delle quest (~4% di errore)
// Si accetta con almeno due conferme di cui una forte: 'high' con due
// forti, 'medium' altrimenti. Misurato a mano su 448 eventi: 424 legati,
// nessun falso positivo nei controlli a campione.
//
// EZA, solo fra gli stage Normal (le Super pendono da una Normal):
//   title  "Extreme Z-Battle: <soprannome> <nome>" == z_battle_stage_views
//   boss   la prima carta del livello 1 == la carta del livello piu' basso
//   news   "News banner event zbattle N" == z_battle_stages.id (debole)
// Misurato: 152 su 152, 138 con tre chiavi.
//
// Quello che non si lega resta senza finestra dal gioco, ed e' meglio
// cosi': una finestra sbagliata e' peggio di una fine non nota.
import { int, isPreLaunch, isSentinel } from './datamine.mjs'

export const norm = (s) => (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').trim()

const field = (txt, key) => {
  const m = txt.match(new RegExp('^\\|\\s*' + key + '\\s*=\\s*(.*)$', 'mi'))
  return m ? m[1].trim() || null : null
}
const add = (m, k, v) => { if (k == null) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v) }
const group = (a, f) => {
  const m = new Map()
  for (const x of a) { const k = f(x); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x) }
  return m
}
const best = (xs, f) => { const top = Math.max(...xs.map(f)); return xs.filter((x) => f(x) === top) }
const jacc = (A, B) => { if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i) }
const cover = (A, B) => { if (!A.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / A.size }

// Una carta nemica e' una variante di quella giocabile (1023050 -> 9023051):
// si confronta la "base" a cinque cifre.
const base = (id) => Math.floor((id % 100000) / 10)
const CARD_RE = /(?:Card[ _](\d{7})[ _]thumb|Thumb[ _](\d{7})\.png)/gi
const cardsIn = (txt) => [...new Set([...txt.matchAll(CARD_RE)].map((m) => Number(m[1] ?? m[2])))]

// il numero dentro il nome di un file del gioco: quest_top_banner_582_2.png -> 582
const imgNum = (p) => { const n = p?.match(/_(\d+)(?:_[^/]*)?\.png$/)?.[1]; return n ? Number(n) : null }
// "Quest top banner 582 2.png" e "quest_top_banner_582_2.png" sono lo stesso file
const fileKey = (f) => f.toLowerCase().replace(/^.*\//, '').replace(/[ _]+/g, '_').trim()
const BANNER_RE = /(?:quest[ _]top[ _]banner|news[ _]banner[ _]event|quest[ _]list[ _]banner|myp[ _]banner[ _]event|EN[ _]news[ _]banner[ _]event)[ _](\d+)/gi
// il wiki distingue le pagine omonime con un suffisso che il gioco non ha
const WIKI_SUFFIX = /\s*\((?:Discontinued(?: \d+)?|Unavailable|Old|Story Event|Event|Global|JP|Renewal)\)\s*$/i
const nameKey = (s) => norm(s.replace(WIKI_SUFFIX, '').replace(WIKI_SUFFIX, ''))
const STRONG = new Set(['banner', 'name', 'stages'])
// la chiave che ha deciso, per le contese: banner > nome > stage
const PRIO = { banner: 3, name: 2, 'name+tiebreak': 2, stage: 1 }
// Il wiki a volte scrive accanto allo stage la sua variante fra parentesi
// ("Vs. Majin Buu (Majin Buu Tactics)"): vale anche il nome senza, ma solo
// se e' quello di una quest dell'area, altrimenti resta il nome intero.
const stageForms = (stages) => stages.map((s) => [norm(s), norm(s.replace(/\s*\([^()]*\)\s*$/, ''))]).filter(([f]) => f)
const stageSet = (forms, Q) => new Set(forms.map(([f, t]) => (Q.has(f) || !Q.has(t) ? f : t)))
// a pari Jaccard decidono i segni della pagina: un suo banner, poi i boss
const narrow = (t) => {
  if (t.length > 1) { const ab = t.filter((x) => x.anyB); if (ab.length) t = ab }
  if (t.length > 1) { const bb = best(t, (x) => x.boss); if (bb[0].boss > 0) t = bb }
  return t
}

function mapNormal(events, pages, dm) {
  const areas = dm.areas.map((a) => ({ ...a, id: int(a.id) }))
  const areaById = new Map(areas.map((a) => [a.id, a]))
  const questsByArea = group(dm.quests, (q) => int(q.area_id))
  const qnamesCache = new Map()
  const qnames = (a) => {
    if (!qnamesCache.has(a)) qnamesCache.set(a, new Set((questsByArea.get(a) ?? []).map((q) => norm(q.name)).filter(Boolean)))
    return qnamesCache.get(a)
  }

  // la scheda del gioco di ogni categoria (Story, Bonus, Growth, Limited,
  // Challenge): due riedizioni sono la stessa cosa solo nella stessa scheda
  const tabOf = new Map()
  for (const t of dm.areaTabs) {
    let ids = []
    try { ids = JSON.parse(t.area_category_ids || '{}').area_category_ids ?? [] } catch { /* nessuna */ }
    for (const c of ids) tabOf.set(c, t.name)
  }
  const tab = (a) => tabOf.get(int(a.category)) ?? `categoria ${a.category}`

  const byHeaderFile = new Map(), byHeaderNum = new Map(), byOtherNum = new Map(), byName = new Map()
  for (const a of areas) {
    if (a.event_image_path && !/dummy/.test(a.event_image_path)) {
      add(byHeaderFile, fileKey(a.event_image_path), a.id)
      add(byHeaderNum, imgNum(a.event_image_path), a.id)
    }
    for (const p of [a.banner_image_path, a.listbutton_image_path]) {
      if (p && !/dummy/.test(p)) add(byOtherNum, imgNum(p), a.id)
    }
    if (a.type !== 'Area::MainArea') add(byName, norm(a.name), a.id)
  }

  // i nemici di ogni area, dalle mappe delle sue quest
  const questArea = new Map(dm.quests.map((q) => [int(q.id), int(q.area_id)]))
  const enemyInfo = new Map(dm.sugorokuEnemies.map((r) => [int(r.sugoroku_map_id), r.enemy_info]))
  const enemyBases = new Map()
  for (const m of dm.sugorokuMaps) {
    const a = questArea.get(int(m.quest_id))
    const info = enemyInfo.get(int(m.id))
    if (a == null || !info) continue
    let j
    try { j = JSON.parse(info) } catch { continue }
    for (const b of j.battles ?? []) for (const r of b.rounds ?? []) for (const e of r.enemies ?? []) {
      if (e.card_id) add(enemyBases, a, base(Number(e.card_id)))
    }
  }

  function bannerAreas(img) {
    const f = img ? fileKey(img.replace(/\[\[File:/i, '').replace(/[|\]].*$/, '')) : null
    if (!f) return []
    if (byHeaderFile.has(f)) return [...byHeaderFile.get(f)]
    const n = Number(f.match(/quest_top_banner_(\d+)/)?.[1] ?? NaN)
    if (!Number.isFinite(n)) return []
    if (byHeaderNum.has(n)) return [...byHeaderNum.get(n)]
    if (areaById.has(n)) return [n]
    return [...(byOtherNum.get(n) ?? [])]
  }

  // L'ancora fra i candidati, tolte le aree in `exclude`: il banner se
  // c'e', poi il nome (con gli spareggi), poi gli stage.
  function decide(ev, all, S, exclude) {
    const cands = all.filter((x) => !exclude.has(x.a))
    let anchor = [], via = null
    const b = cands.filter((x) => x.banner)
    if (b.length) { anchor = b.length > 1 ? best(b, (x) => x.keys.length) : b; via = 'banner' }
    else {
      const n = cands.filter((x) => x.name)
      if (n.length) {
        anchor = narrow(n.length > 1 && S.size ? best(n, (x) => x.J) : n)
        via = n.length === 1 ? 'name' : 'name+tiebreak'
      } else {
        // anche qui gli spareggi: le due edizioni di una storia hanno le
        // stesse quest, e la pagina "(Discontinued)" ha il nome lungo
        // (7750: le aree 321 e 371, il suo banner e i suoi boss dicono 321)
        const s = cands.filter((x) => x.cov >= 0.5)
        if (s.length) { anchor = narrow(best(s, (x) => x.J)); via = 'stage' }
      }
    }
    if (!anchor.length) return { ev, reason: 'nessuna area candidata (banner, nome, stage)' }
    const conf = Math.min(...anchor.map((x) => x.keys.length))
    const strong = Math.min(...anchor.map((x) => x.strong))
    const level = strong >= 2 ? 'high' : strong >= 1 && conf >= 2 ? 'medium' : null
    if (!level) return { ev, reason: `una sola conferma (${anchor.map((x) => `area ${x.a}: ${x.keys.join('+') || 'nessuna'}`).join(', ')})` }
    // un'ancora su piu' aree regge solo se sono la stessa cosa: stesso nome
    // e stesse quest (riedizioni), non due eventi diversi
    const a0 = anchor[0].a
    if (anchor.some((x) => norm(areaById.get(x.a).name) !== norm(areaById.get(a0).name) || jacc(qnames(x.a), qnames(a0)) !== 1)) {
      return { ev, reason: `aree candidate diverse fra loro (${anchor.map((x) => x.a).join(', ')})` }
    }
    return { ev, anchor, via, conf, level }
  }

  const out = []
  for (const ev of events) {
    const w = pages.get(ev.id)
    if (w == null) { out.push({ ev, reason: 'pagina del wiki non in cache' }); continue }
    const S = new Set(ev.stages.map(norm).filter(Boolean))
    const forms = stageForms(ev.stages)
    const banner = new Set(bannerAreas(field(w, 'Event Image')))
    const anyB = new Set([...w.matchAll(BANNER_RE)].map((m) => Number(m[1]))
      .flatMap((n) => [...(byHeaderNum.get(n) ?? []), ...(areaById.has(n) ? [n] : [])]))
    const name = new Set(byName.get(nameKey(ev.wiki_title)) ?? byName.get(norm(ev.name)) ?? [])
    // i boss solo dalla tabella degli stage, prima delle schede (<tabber>)
    const tabber = w.indexOf('<tabber>')
    const bossB = new Set(cardsIn(w.slice(0, tabber >= 0 ? tabber : w.length)).map(base))

    const C = new Set([...banner, ...anyB, ...name])
    if (S.size) for (const a of questsByArea.keys()) if (cover(stageSet(forms, qnames(a)), qnames(a)) >= 0.5) C.add(a)
    const cands = [...C].filter((a) => areaById.has(a)).map((a) => {
      const Q = qnames(a), Sa = stageSet(forms, Q), en = enemyBases.get(a) ?? new Set()
      const boss = bossB.size ? [...bossB].filter((b) => en.has(b)).length / bossB.size : 0
      const x = { a, banner: banner.has(a), anyB: anyB.has(a), name: name.has(a), J: jacc(Sa, Q), cov: cover(Sa, Q), boss }
      x.keys = [x.banner && 'banner', x.name && 'name', x.J >= 0.5 && 'stages',
                x.anyB && !x.banner && 'anyBanner', x.boss >= 0.5 && 'boss'].filter(Boolean)
      x.strong = x.keys.filter((k) => STRONG.has(k)).length
      return x
    })

    const o = decide(ev, cands, S, new Set())
    o.retry = { cands, S }
    out.push(o)
  }

  // Un'area ancorata da piu' eventi va a quello con la chiave piu' forte e
  // piu' conferme; a pari merito a nessuno.
  const accepted = out.filter((o) => o.anchor)
  const claim = new Map()
  for (const o of accepted) for (const x of o.anchor) { if (!claim.has(x.a)) claim.set(x.a, []); claim.get(x.a).push(o) }
  for (const [a, os] of claim) {
    if (os.length < 2) continue
    const top = best(os, (o) => PRIO[o.via] * 10 + o.conf)
    for (const o of os) if (top.length > 1 || o !== top[0]) o.lost = a
  }
  for (const o of accepted.filter((o) => o.lost != null)) {
    o.reason = `area ${o.lost} contesa con un altro evento`
    delete o.anchor
  }
  // Chi perde una contesa riprova una volta senza le aree ancorate dagli
  // altri: la pagina "(Discontinued)" ha il nome della riedizione, ma la sua
  // area e' un'altra (1302 Galactic Crisis: la 364 e' del remake, la sua e'
  // la 306, con le stesse quest e il suo banner nella pagina). Se due la
  // ritrovano nella stessa area, non la prende nessuno.
  const retried = []
  for (const o of accepted.filter((o) => o.lost != null)) {
    const others = new Set([...claim].filter(([, os]) => os.some((x) => x !== o && x.anchor)).map(([a]) => a))
    others.add(o.lost)
    const r = decide(o.ev, o.retry.cands, o.retry.S, others)
    if (r.anchor) { Object.assign(o, r, { reason: undefined }); retried.push(o) }
  }
  const reClaim = new Map()
  for (const o of retried) for (const x of o.anchor) reClaim.set(x.a, (reClaim.get(x.a) ?? 0) + 1)
  for (const o of retried) {
    const a = o.anchor.find((x) => reClaim.get(x.a) > 1)?.a
    if (a != null) { o.reason = `area ${a} contesa con un altro evento`; delete o.anchor; continue }
    for (const x of o.anchor) claim.set(x.a, [o])
  }

  // Fratelli: la stessa area ripubblicata con un id nuovo (stesso nome,
  // stesse quest), nella stessa scheda e dello stesso tipo — mai un remake
  // DbStory attaccato alla storia originale — e che nessuno ha come ancora.
  const anchored = new Set(claim.keys())
  const winners = out.filter((o) => o.anchor)
  for (const o of winners) {
    o.areas = new Set(o.anchor.map((x) => x.a))
    o.siblings = []
    for (const x of o.anchor) {
      const A0 = areaById.get(x.a), nm = norm(A0.name), Q = qnames(x.a)
      if (!Q.size) continue
      for (const a of areas) {
        if (o.areas.has(a.id) || anchored.has(a.id) || norm(a.name) !== nm) continue
        if (a.type !== A0.type || tab(a) !== tab(A0) || jacc(Q, qnames(a.id)) < 1) continue
        if (!o.siblings.includes(a.id)) o.siblings.push(a.id)
      }
    }
  }
  const sibClaim = new Map()
  for (const o of winners) for (const s of o.siblings) sibClaim.set(s, (sibClaim.get(s) ?? 0) + 1)

  // Riaperture: la stessa area rimessa in gioco con un id nuovo e qualche
  // quest in piu' o in meno (789 = 727 piu' "Grand Opening", 1202 tiene
  // una delle due quest di 135). Le quest identiche non bastano piu', e
  // allora serve il tempo: l'area nuova parte quando quella che abbiamo
  // smette (entro due giorni), o dopo di lei se la nostra non ha missioni.
  // Un'area gia' fratello di qualcuno resta sua.
  const span = new Map()   // area -> { first, last } dalle missioni valide
  for (const m of dm.missions) {
    const a = int(m.area_id)
    if (a == null || m.type === 'Mission::DeletedMission' || isSentinel(m.start_at)
      || isPreLaunch(m.start_at) || !(m.start_at < m.end_at)) continue
    const s = span.get(a) ?? { first: m.start_at, last: m.start_at }
    if (m.start_at < s.first) s.first = m.start_at
    const end = isSentinel(m.end_at) ? m.start_at : m.end_at
    if (end > s.last) s.last = end
    span.set(a, s)
  }
  const ms = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime()
  const nested = (A, B) => [...A].every((q) => B.has(q))
  const relClaim = new Map()
  for (const o of winners) {
    o.relisted = []
    for (const x of o.anchor) {
      const A0 = areaById.get(x.a), nm = norm(A0.name), Q = qnames(x.a), s0 = span.get(x.a)
      if (!Q.size) continue
      for (const a of areas) {
        if (o.areas.has(a.id) || anchored.has(a.id) || sibClaim.has(a.id) || norm(a.name) !== nm) continue
        if (a.type !== A0.type || tab(a) !== tab(A0)) continue
        const Qa = qnames(a.id), s1 = span.get(a.id)
        if (!Qa.size || !s1 || !(nested(Qa, Q) || nested(Q, Qa))) continue
        if (s0 ? Math.abs(ms(s1.first) - ms(s0.last)) > 2 * 86_400_000 : a.id < A0.id) continue
        if (!o.relisted.includes(a.id)) { o.relisted.push(a.id); relClaim.set(a.id, (relClaim.get(a.id) ?? 0) + 1) }
      }
    }
  }

  const refs = []
  for (const o of winners) {
    for (const x of o.anchor) {
      refs.push({ event_id: o.ev.id, game_kind: 'area', game_id: x.a, via: o.via, keys: x.keys, confidence: o.level })
    }
    for (const s of o.siblings) {
      if (sibClaim.get(s) !== 1) continue
      refs.push({ event_id: o.ev.id, game_kind: 'area', game_id: s, via: 'sibling', keys: ['name', 'quests'], confidence: o.level })
    }
    for (const s of o.relisted) {
      if (relClaim.get(s) !== 1) continue
      refs.push({ event_id: o.ev.id, game_kind: 'area', game_id: s, via: 'sibling', keys: ['name', 'nested-quests', 'follows'], confidence: 'medium' })
    }
  }
  return { refs, unmatched: out.filter((o) => !o.anchor).map((o) => ({ ev: o.ev, reason: o.reason })) }
}

function mapEza(events, pages, dm) {
  const stageById = new Map(dm.zStages.map((s) => [int(s.id), s]))
  const isNormal = (id) => stageById.get(id)?.type === 'ZBattleStage::Normal'

  // il titolo come lo scrive il wiki: "<soprannome> <nome>", oppure solo
  // <nome> quando il soprannome e' "Extreme Z-Battle" (EZA a piu' boss)
  const titleKey = (v) => norm(/^extreme z-battle$/i.test(v.enemy_nickname.trim())
    ? v.enemy_name : `${v.enemy_nickname} ${v.enemy_name}`)
  const byTitle = group(dm.zViews.filter((v) => isNormal(int(v.z_battle_stage_id))), titleKey)
  const strip = (t) => norm(t.replace(/^Extreme Z-Battle:\s*/i, '')
    .replace(/\s*\((?:Discontinued|Unavailable|Old|AGL|TEQ|INT|STR|PHY)\)\s*$/i, ''))

  // il boss del livello piu' basso di ogni stage
  const escByType = group(dm.zEscalations, (e) => int(e.escalation_type))
  const stagesByLv1Base = new Map()
  for (const e of dm.zEnemies) {
    const st = int(e.z_battle_stage_id)
    const rows = escByType.get(int(e.card_escalation_type)) ?? []
    if (!rows.length) continue
    const min = Math.min(...rows.map((r) => int(r.level)))
    for (const r of rows) if (int(r.level) === min) add(stagesByLv1Base, base(int(r.card_id)), st)
  }

  const picked = []
  const unmatched = []
  for (const ev of events) {
    const w = pages.get(ev.id)
    if (w == null) { unmatched.push({ ev, reason: 'pagina del wiki non in cache' }); continue }
    const t = (byTitle.get(strip(ev.wiki_title)) ?? []).map((v) => int(v.z_battle_stage_id))
    // la prima riga della tabella dei livelli: "!1" e le carte fino a "|-"
    const i = w.search(/\n!\s*1\s*\n/)
    let lv1 = []
    if (i >= 0) { const j = w.indexOf('\n|-', i + 3); lv1 = cardsIn(w.slice(i, j >= 0 ? j : w.length)) }
    const b = [...new Set(lv1.flatMap((c) => [...(stagesByLv1Base.get(base(c)) ?? [])]))].filter(isNormal)
    const n = [...new Set([...w.matchAll(/news[ _]banner[ _]event[ _]zbattle[ _](\d+)/gi)].map((m) => Number(m[1])))]
      .filter(isNormal)

    // il titolo se e' unico; se no lo stringono boss o news; senza titolo
    // servono boss e news insieme
    let pick = t, via = 'title'
    if (pick.length > 1) {
      const k = pick.filter((s) => b.includes(s) || n.includes(s))
      if (k.length === 1) pick = k
    }
    if (!pick.length) { pick = b.filter((s) => n.includes(s)); via = 'boss+news' }
    if (pick.length !== 1) {
      unmatched.push({ ev, reason: pick.length ? `piu' stage possibili (${pick.join(', ')})` : 'nessuno stage con titolo o boss e banner' })
      continue
    }
    const s = pick[0]
    const keys = ['title', 'boss', 'news'].filter((_, k) => [t, b, n][k].includes(s))
    picked.push({ ev, s, via, keys, confidence: keys.length >= 2 ? 'high' : 'medium' })
  }

  // uno stage scelto da due eventi: a chi ha piu' chiavi, a pari merito a nessuno
  const byStage = group(picked, (p) => p.s)
  const refs = []
  for (const [s, ps] of byStage) {
    const top = best(ps, (p) => p.keys.length)
    for (const p of ps) {
      if (top.length === 1 && p === top[0]) {
        refs.push({ event_id: p.ev.id, game_kind: 'z_battle_stage', game_id: s, via: p.via, keys: p.keys, confidence: p.confidence })
      } else unmatched.push({ ev: p.ev, reason: `stage ${s} conteso con un altro evento` })
    }
  }
  return { refs, unmatched }
}

// La prima uscita Global secondo il wiki, letta come la legge load-events
// (che la scrive nella run del wiki): serve a load-windows anche dopo che
// quella run e' diventata del gioco, e la data non c'e' piu'.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
export function wikiGlobalRelease(w) {
  const v = (field(w ?? '', 'GLBdate') ?? '').replace(/\}\}.*$/, '').replace(/\|\s*[A-Za-z][\w ]*=.*$/, '')
    .replace(/^prior to\s+/i, '').trim()
  const m = v.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})$/)
  const mo = m && MONTHS[m[2].slice(0, 3).toLowerCase()]
  return mo ? new Date(Date.UTC(Number(m[3]), mo - 1, Number(m[1]))) : null
}

/**
 * events: [{ id, kind, wiki_title, name, stages: [nomi degli stage] }]
 * pages:  Map pageid -> wikitext
 * dm:     le tabelle del datamine (vedi load-windows)
 */
export function mapEvents(events, pages, dm) {
  const normal = mapNormal(events.filter((e) => e.kind !== 'zbattle'), pages, dm)
  const eza = mapEza(events.filter((e) => e.kind === 'zbattle'), pages, dm)
  return { refs: [...normal.refs, ...eza.refs], unmatched: [...normal.unmatched, ...eza.unmatched] }
}
