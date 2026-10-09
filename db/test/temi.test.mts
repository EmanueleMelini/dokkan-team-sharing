// Verifica i temi del sito: i blocchi [data-theme] di app/globals.css
// (tutti i 17 token, color-scheme, i contrasti WCAG), che coincidano con
// lib/tema/temi.ts e con il vincolo app_user_theme (0027), lo script del
// <head> su un document finto, e il verbo set_theme.
//
// Gira sul database di test (npm run db:test). Crea solo gli utenti
// themetest+...@example.invalid e li toglie alla fine.
import { readFileSync } from 'node:fs'
import { db } from '@/lib/db'
import {
  BARRA_SISTEMA, TEMA_IDS, TEMA_KEY, TEMI, isTemaId, riconciliaTema, scriptTema, temaDaAccount, temaPerAccount,
} from '@/lib/tema/temi'
import { DOMINIO, check, esito, guardia, one, q, stato, utente } from '@/db/test/builder-helpers'

guardia()
const P = 'themetest'

const TOKEN = [
  'sfondo', 'superficie', 'superficie-2', 'inchiostro', 'testo', 'tenue', 'linea', 'linea-forte', 'campo',
  'oro', 'oro-linea', 'oro-tenue', 'agl', 'teq', 'int', 'str', 'phy',
] as const
const TIPI = ['agl', 'teq', 'int', 'str', 'phy'] as const

// ---------------------------------------------------------------------
//  Colori: luminanza e contrasto WCAG, OKLab e la deuteranopia
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
const oklab = ([r, g, b]: number[]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
// Machado 2009, deuteranopia piena, su RGB lineare
const DEUT = [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]]
const deuteranopia = (h: string) => {
  const c = canali(h).map(lineare)
  return DEUT.map((r) => Math.min(1, Math.max(0, r[0] * c[0] + r[1] * c[1] + r[2] * c[2])))
}
const distanzaDeut = (a: string, b: string) => {
  const p = oklab(deuteranopia(a)), s = oklab(deuteranopia(b))
  return Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2])
}

// ---------------------------------------------------------------------
//  Il CSS: i blocchi dei temi
// ---------------------------------------------------------------------

type Blocco = { selettori: string[]; props: Map<string, string> }
const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
// Solo i blocchi piu' interni (senza graffe dentro): @media resta fuori,
// la regola che contiene no. Prima del selettore puo' esserci un'istruzione
// come @import: conta quello che viene dopo l'ultimo ';'.
const blocchi: Blocco[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selettori: (m[1].split(';').pop() ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  props: new Map(m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':')
    return [d.slice(0, i).trim(), d.slice(i + 1).trim().toLowerCase()] as [string, string]
  })),
}))
const temiCss = new Map<string, Blocco>()
for (const b of blocchi) {
  for (const s of b.selettori) {
    const m = /^\[data-theme="([^"]+)"\]$/.exec(s)
    if (m) temiCss.set(m[1], b)
  }
}
const token = (b: Blocco) => Object.fromEntries(TOKEN.map((t) => [t, b.props.get(`--${t}`) ?? '']))

function struttura() {
  console.log('\n  -- i blocchi di app/globals.css')
  const attesi = TEMA_IDS.filter((id) => id !== 'system')
  check('un blocco [data-theme] per ogni tema tranne System, e nessun altro',
    [...temiCss.keys()].sort().join() === [...attesi].sort().join(), [...temiCss.keys()].join())
  for (const [id, b] of temiCss) {
    const mancanti = TOKEN.filter((t) => !/^#[0-9a-f]{6}$/.test(b.props.get(`--${t}`) ?? ''))
    check(`${id}: tutti i 17 token, in esadecimale`, mancanti.length === 0, mancanti.join())
    const schema = b.props.get('color-scheme')
    const scuro = luminanza(b.props.get('--sfondo') ?? '#ffffff') < 0.2
    check(`${id}: color-scheme coerente con lo sfondo`, schema === (scuro ? 'dark' : 'light'), String(schema))
  }
  const chiaro = temiCss.get('light')
  check('System senza attributo: :root ha i valori di Light',
    !!chiaro && chiaro.selettori.includes(':root'), chiaro?.selettori.join())
  const media = blocchi.filter((b) => b.selettori.includes(':root:not([data-theme])'))
  const scuro = temiCss.get('dark')
  check('System su un sistema scuro: :root:not([data-theme]) con i valori di Dark', media.length === 1 && !!scuro &&
    JSON.stringify(token(media[0])) === JSON.stringify(token(scuro)) && media[0].props.get('color-scheme') === 'dark')
  check('il blocco scuro di System sta dentro prefers-color-scheme: dark',
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme\]\)/.test(css))
  // Alto contrasto e' chiaro: sopra un sistema scuro abbaglierebbe.
  check('nessun tema si applica da solo con prefers-contrast', !/prefers-contrast/.test(css))
}

function contrasti() {
  console.log('\n  -- i contrasti (WCAG 2.x)')
  for (const [id, b] of temiCss) {
    const t = token(b)
    const coppie: [string, string, number][] = [
      ['inchiostro', 'sfondo', 4.5], ['testo', 'superficie', 4.5], ['tenue', 'sfondo', 4.5],
      ['tenue', 'superficie-2', 4.5], ['oro', 'sfondo', 4.5], ['oro', 'oro-tenue', 4.5],
      ...TIPI.flatMap((x): [string, string, number][] => [[x, 'superficie', 4.5], [x, 'superficie-2', 4.5]]),
      ['campo', 'sfondo', 3],
    ]
    const sotto = coppie.map(([a, s, min]) => [a, s, min, contrasto(t[a], t[s])] as const)
      .filter(([, , min, r]) => !(r >= min)).map(([a, s, , r]) => `${a}/${s} ${r.toFixed(2)}`)
    check(`${id}: testo, oro e tipi almeno 4.5:1, campo almeno 3:1`, sotto.length === 0, sotto.join('; '))
    // le card sono bg-superficie border-linea: il bordo deve vedersi
    const bordo = contrasto(t.linea, t.sfondo)
    check(`${id}: il bordo delle card si vede sullo sfondo`, bordo >= 1.2, bordo.toFixed(2))
  }
  // Sui neri la superficie non si stacca dallo sfondo: conta solo il bordo.
  for (const id of ['oled', 'lr-oro']) {
    const t = token(temiCss.get(id)!)
    const r = contrasto(t.linea, t.sfondo)
    check(`${id}: linea almeno 1.5:1 sullo sfondo`, r >= 1.5, r.toFixed(2))
  }
  const ac = token(temiCss.get('alto-contrasto')!)
  const d = distanzaDeut(ac.str, ac.phy)
  check('alto-contrasto: STR e PHY distinguibili con la deuteranopia (OKLab >= 0.08)', d >= 0.08, d.toFixed(3))
}

function lista() {
  console.log('\n  -- lib/tema/temi.ts')
  check('TEMI ha ogni id una volta, nello stesso insieme di TEMA_IDS',
    TEMI.length === TEMA_IDS.length && new Set(TEMI.map((t) => t.id)).size === TEMA_IDS.length &&
    TEMI.every((t) => isTemaId(t.id)))
  check('i nomi sono unici e senza trattini lunghi', new Set(TEMI.map((t) => t.label)).size === TEMI.length &&
    TEMI.every((t) => !/—/.test(t.label)))
  check('System per primo e senza sfondo', TEMI[0].id === 'system' && TEMI[0].sfondo === null)
  const diversi = TEMI.filter((t) => t.id !== 'system' && t.sfondo !== temiCss.get(t.id)?.props.get('--sfondo'))
  check('lo sfondo di ogni tema (theme-color) e\' quello del CSS', diversi.length === 0, diversi.map((t) => t.id).join())
  check('la barra di System usa gli sfondi di Light e Dark',
    BARRA_SISTEMA.light === temiCss.get('light')?.props.get('--sfondo') &&
    BARRA_SISTEMA.dark === temiCss.get('dark')?.props.get('--sfondo'))
  check('isTemaId rifiuta il resto', !isTemaId('') && !isTemaId('Dark') && !isTemaId(null) && !isTemaId('__proto__'))
  check('verso l\'account: System e\' null', temaPerAccount('system') === null && temaPerAccount('oled') === 'oled')
  check('dall\'account: null e\' System, assente o sconosciuto non tocca niente',
    temaDaAccount(null) === 'system' && temaDaAccount('lr-oro') === 'lr-oro' && temaDaAccount(undefined) === undefined &&
    temaDaAccount('nuovo-tema') === undefined && temaDaAccount('system') === undefined)
  // Chi sceglie un tema prima di entrare non lo perde: un account ancora su
  // System lo prende dal dispositivo; ogni altra scelta dell'account vince.
  const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
  check('riconciliaTema: account su System, scelta qui: si salva sull\'account', eq(riconciliaTema('system', 'oled', 'oled', true), { salva: 'oled' }))
  check('riconciliaTema: account non completo: la scelta resta qui, niente si cambia', riconciliaTema('system', 'oled', 'oled', false) === null)
  check('riconciliaTema: account con un tema: vince sul dispositivo', eq(riconciliaTema('lr-oro', 'oled', 'oled', true), { applica: 'lr-oro' }) && eq(riconciliaTema('light', 'system', 'system', true), { applica: 'light' }))
  check('riconciliaTema: stesso tema ma attributo diverso: si rimette', eq(riconciliaTema('oled', 'oled', 'system', true), { applica: 'oled' }))
  check('riconciliaTema: tutto uguale o account sconosciuto: niente da fare', riconciliaTema('oled', 'oled', 'oled', true) === null && riconciliaTema('system', 'system', 'system', true) === null && riconciliaTema(undefined, 'oled', 'oled', true) === null)
}

/** Lo script del <head> su un document finto: cosa scrive, con cosa trova in localStorage. */
function eseguiScript(valore: string | null | Error) {
  const attributi: Record<string, string> = {}
  const meta: Record<string, string>[] = []
  const finto = {
    localStorage: {
      getItem: (k: string) => {
        if (valore instanceof Error) throw valore
        return k === TEMA_KEY ? valore : null
      },
    },
    document: {
      documentElement: { setAttribute: (k: string, v: string) => { attributi[k] = v } },
      createElement: () => {
        const el: Record<string, string> = {}
        return Object.assign(el, { setAttribute: (k: string, v: string) => { el[k] = v } })
      },
      head: { firstChild: null, insertBefore: (el: Record<string, string>) => { meta.push(el) } },
    },
  }
  new Function('localStorage', 'document', scriptTema())(finto.localStorage, finto.document)
  return { tema: attributi['data-theme'], meta }
}

function script() {
  console.log('\n  -- lo script del <head>')
  const r = eseguiScript('oled')
  check('un tema noto: data-theme e un theme-color in testa', r.tema === 'oled' && r.meta.length === 1 &&
    r.meta[0].name === 'theme-color' && r.meta[0].content === '#000000', JSON.stringify(r))
  for (const v of [null, 'system', 'nope', '"><script>', 'constructor', 'toString']) {
    const x = eseguiScript(v)
    check(`${JSON.stringify(v)}: nessun attributo e nessun meta`, x.tema === undefined && x.meta.length === 0,
      JSON.stringify(x))
  }
  let lancia = false
  try { eseguiScript(new Error('SecurityError')) } catch { lancia = true }
  check('localStorage che lancia: nessun errore', !lancia)
  check('la chiave e\' dts:tema', scriptTema().includes(JSON.stringify(TEMA_KEY)) && TEMA_KEY === 'dts:tema')
}

// ---------------------------------------------------------------------
//  Il database (0027)
// ---------------------------------------------------------------------

async function vincolo() {
  console.log('\n  -- app_user_theme')
  const def = await one<{ d: string }>(
    `select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'app_user_theme' and conrelid = 'app_user'::regclass`)
  const ids = [...(def?.d ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  check('il vincolo elenca gli stessi id del CSS (System e\' null)',
    ids.join() === [...temiCss.keys()].sort().join(), ids.join())
  const col = await one<{ nullable: string; def: string | null }>(
    `select is_nullable as nullable, column_default as def from information_schema.columns
      where table_name = 'app_user' and column_name = 'theme'`)
  check('app_user.theme: nullabile, senza default (null = System)', col?.nullable === 'YES' && col.def === null,
    JSON.stringify(col))
}

async function verbo() {
  console.log('\n  -- set_theme')
  const a = await utente(P, 'theme_a')
  const b = await utente(P, 'theme_b')
  const nuovo = await utente(P, 'theme_new', false)
  const val = async (id: string) => (await one<{ t: string | null }>('select theme as t from app_user where id = $1', [id]))?.t
  check('per difetto null (System)', await val(a) === null)
  const r = await one<{ v: string }>('select set_theme($1, $2) as v', [a, 'oled'])
  check('torna il valore salvato', r?.v === 'oled')
  check('cambia quell\'utente', await val(a) === 'oled')
  check('...e solo lui', await val(b) === null)
  check('ogni tema del CSS si salva', (await Promise.all([...temiCss.keys()].map((id) =>
    esito('select set_theme($1, $2)', [b, id])))).every((e) => e === 'ok'))
  check('null torna a System', await esito('select set_theme($1, null)', [a]) === 'ok' && await val(a) === null)
  const rifiuti: [string, string, unknown[]][] = [
    ['un id sconosciuto', '23514 app_user_theme', [a, 'rainbow']],
    ['system non si salva: e\' null', '23514 app_user_theme', [a, 'system']],
    ['le maiuscole contano', '23514 app_user_theme', [a, 'Dark']],
    ['un uuid sconosciuto', 'P0002 user_not_found', ['00000000-0000-0000-0000-000000000000', 'dark']],
    ['un utente senza onboarding', 'P0002 user_not_found', [nuovo, 'dark']],
  ]
  for (const [nome, vuole, args] of rifiuti) {
    const got = await esito('select set_theme($1, $2)', args)
    check(`${nome}: ${vuole}`, got === vuole, got)
  }
  check('dopo i rifiuti niente e\' cambiato', await val(a) === null && await val(nuovo) === null)
  check('il vincolo vale anche per un update diretto',
    await esito(`update app_user set theme = 'nope' where id = $1`, [a]) === '23514 app_user_theme')
}

try {
  struttura()
  contrasti()
  lista()
  script()
  await vincolo()
  await verbo()
} catch (e) {
  check('nessuna eccezione inattesa', false, e instanceof Error ? e.stack ?? e.message : String(e))
}

try {
  const emails = ['theme_a', 'theme_b', 'theme_new'].map((h) => `${P}+${h}${DOMINIO}`)
  await db.query('delete from app_user where email = any($1::text[])', [emails])
  check('pulizia: nessun utente di prova rimasto',
    (await q('select 1 from app_user where email = any($1::text[])', [emails])).length === 0)
} finally {
  await db.end()
}

console.log(`\n  ${stato.passes} PASS, ${stato.fails} FAIL`)
process.exit(stato.fails ? 1 : 0)
