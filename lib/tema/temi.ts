// I temi del sito. Si applicano solo nel browser, con l'attributo
// data-theme su <html>: l'HTML del server resta identico per tutti, quindi
// le pagine pubbliche restano in cache. I colori stanno in app/globals.css
// (un blocco [data-theme] per tema); qui ci sono gli id, i nomi mostrati e
// il solo sfondo, che serve a <meta name="theme-color"> prima che il CSS
// sia caricato. Un test (db/test/temi.test.mts) controlla che questa lista,
// i blocchi del CSS e il vincolo app_user_theme (0027) coincidano.
//
// Modulo puro, senza 'use client' ne' import: lo usano il layout (server),
// le isole client, la Server Action e il test.

/** La chiave di localStorage, per tutti (anche chi non ha un account). */
export const TEMA_KEY = 'dts:tema'

export const TEMA_IDS = [
  'system', 'light', 'dark',
  'notte-agl', 'giada-teq', 'nebulosa-int', 'brace-str', 'sabbia-phy',
  'lr-oro', 'oled', 'alto-contrasto',
] as const

export type TemaId = (typeof TEMA_IDS)[number]

export type Tema = {
  id: TemaId
  label: string
  /** --sfondo del tema; null per System, che segue il sistema operativo */
  sfondo: string | null
}

// L'ordine e' quello del selettore: prima i tre di base, poi i chiari, poi
// gli scuri, e Alto contrasto per ultimo.
export const TEMI: readonly Tema[] = [
  { id: 'system', label: 'System', sfondo: null },
  { id: 'light', label: 'Light', sfondo: '#f3f4f8' },
  { id: 'dark', label: 'Dark', sfondo: '#0f111d' },
  { id: 'giada-teq', label: 'TEQ Jade', sfondo: '#eef5f1' },
  { id: 'sabbia-phy', label: 'PHY Sand', sfondo: '#f8f3ea' },
  { id: 'notte-agl', label: 'AGL Night', sfondo: '#0b1424' },
  { id: 'nebulosa-int', label: 'INT Nebula', sfondo: '#130f22' },
  { id: 'brace-str', label: 'STR Ember', sfondo: '#1a0f0f' },
  { id: 'lr-oro', label: 'LR Gold', sfondo: '#0e0c08' },
  { id: 'oled', label: 'OLED Black', sfondo: '#000000' },
  { id: 'alto-contrasto', label: 'High contrast', sfondo: '#ffffff' },
]

/** Le voci del selettore del footer (components/scelta): l'id e il nome, nello stesso ordine. */
export const OPZIONI_TEMA: readonly { valore: string; testo: string }[] = TEMI.map((t) => ({ valore: t.id, testo: t.label }))

/** La barra del browser mobile con System: i due sfondi di oggi, per media query. */
export const BARRA_SISTEMA = { light: '#f3f4f8', dark: '#0f111d' } as const

/**
 * Il content del theme-color nostro (lo script del <head>, applicaTema):
 * lo sfondo del tema in maiuscolo, lo stesso colore per il browser. Serve
 * a non somigliare ai due del layout: React prende come suoi i <meta> gia'
 * nel documento confrontando content e name, non media, e il nostro sta
 * per primo. Con Light o Dark (gli stessi colori di BARRA_SISTEMA) si
 * prendeva il nostro: al primo giro del layout dal server (un'azione che
 * scrive un cookie, come l'interruttore della versione) React lo toglieva,
 * e dopo un cambio di tema, gia' tolto, il commit si rompeva su
 * removeChild. Un test lo controlla (db/test/temi.test.mts).
 */
export const coloreBarra = (sfondo: string) => sfondo.toUpperCase()

export const isTemaId = (v: unknown): v is TemaId =>
  typeof v === 'string' && (TEMA_IDS as readonly string[]).includes(v)

/** Quello che si salva sull'account: System e' null. */
export const temaPerAccount = (id: TemaId): string | null => (id === 'system' ? null : id)

/**
 * Dall'account: null e' System. undefined per un campo assente (un server
 * vecchio) o un id che questo client non conosce ancora: in quei casi il
 * tema di questo dispositivo non si tocca.
 */
export const temaDaAccount = (v: unknown): TemaId | undefined =>
  v === null ? 'system' : isTemaId(v) && v !== 'system' ? v : undefined

/**
 * Tra account e dispositivo, quando /api/me risponde. Di norma vince
 * l'account. Ma un account senza scelta (null, cioe' System) davanti a una
 * scelta fatta su questo dispositivo, di solito prima di entrare: vince il
 * dispositivo, e la scelta passa all'account. Altrimenti entrare
 * cancellerebbe il tema appena scelto.
 */
export function riconciliaTema(account: TemaId | undefined, locale: TemaId, attuale: TemaId, completo: boolean):
  { applica: TemaId } | { salva: TemaId } | null {
  if (account === undefined) return null
  // chi deve ancora scegliere l'handle non puo' salvare: la scelta resta qui
  if (account === 'system' && locale !== 'system') return completo ? { salva: locale } : null
  return account === locale && account === attuale ? null : { applica: account }
}

/**
 * Lo script sincrono del <head>: gira prima del primo paint, quindi la
 * pagina non lampeggia col tema sbagliato. Accetta solo gli id noti (un
 * valore qualunque in localStorage non finisce in un attributo) e mette in
 * testa al <head> un theme-color suo: il primo che corrisponde vince sui
 * due per media query del layout (il colore e' coloreBarra, qui sopra).
 * try/catch: localStorage puo' lanciare (cookie bloccati, navigazione
 * privata).
 */
export function scriptTema(): string {
  const colori = Object.fromEntries(TEMI.flatMap((t) => (t.sfondo ? [[t.id, coloreBarra(t.sfondo)]] : [])))
  return `(function(){try{var t=localStorage.getItem(${JSON.stringify(TEMA_KEY)}),c=${JSON.stringify(colori)};` +
    `if(!Object.prototype.hasOwnProperty.call(c,t))return;document.documentElement.setAttribute("data-theme",t);` +
    `var m=document.createElement("meta");m.name="theme-color";m.content=c[t];m.setAttribute("data-tema","");` +
    `document.head.insertBefore(m,document.head.firstChild)}catch(e){}})()`
}
