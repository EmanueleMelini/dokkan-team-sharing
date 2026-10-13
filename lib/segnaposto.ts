// I segnaposto delle immagini: cosa mostrare al posto della miniatura di
// una carta o dell'immagine di un evento che ancora non abbiamo (le carte
// prese dal gioco, gli eventi che il wiki non ha). Solo roba nostra: i
// cinque colori fissi del marchio (le sue regole in app/globals.css), la
// rarita' e l'iniziale del nome per le carte, un'icona del tipo per gli
// eventi. Mai icone o immagini del wiki.
//
// Modulo puro, senza 'use client' ne' import: lo usano i componenti
// (components/segnaposto.tsx, anche dentro le isole client) e il test
// (db/test/segnaposto.test.mts).

/**
 * I tipi nell'ordine dei settori del marchio: il settore N ha il colore
 * --marchio-N (AGL in alto, poi in senso orario).
 */
export const TIPI_MARCHIO = ['AGL', 'TEQ', 'INT', 'STR', 'PHY'] as const

/** Il settore del marchio di un tipo, da 1 a 5; 0 per un tipo sconosciuto o vuoto. */
export function settoreTipo(type: string | null | undefined): number {
  return (TIPI_MARCHIO as readonly string[]).indexOf(type ?? '') + 1
}

/**
 * L'iniziale del nome: la prima lettera o cifra (anche giapponese), in
 * maiuscolo. Parentesi e simboli si saltano: "(Clone) X" da' "C". '?'
 * quando non c'e' niente da mostrare.
 */
export function inizialeCarta(name: string | null | undefined): string {
  const m = /[\p{L}\p{N}]/u.exec(name ?? '')
  if (!m) return '?'
  const su = m[0].toUpperCase()
  // "ß" diventa "SS": nel riquadro ci sta una lettera sola
  return [...su].length === 1 ? su : m[0]
}

// Le rarita' del gioco, le sole che si scrivono nel riquadro
const RARITA = new Set(['N', 'R', 'SR', 'SSR', 'UR', 'LR'])

/** Sotto questa misura niente iniziale: resta la sola banda del tipo. */
export const INIZIALE_DA = 24
/** Da questa misura in su anche la rarita', in un angolo. */
export const RARITA_DA = 40

/**
 * L'angolo della rarita', sempre a sinistra. 'basso': dove la mettono le
 * miniature del gioco. 'alto': subito sotto la banda, per i riquadri con
 * il fondo coperto da un'etichetta. Nelle squadre dei clear
 * (components/carta.tsx, 48 px) Leader e Friend coprono quasi tutta la
 * riga in basso, angolo sinistro compreso.
 */
export type AngoloRarita = 'basso' | 'alto'

export type SegnapostoCarta = {
  iniziale: string
  /** 1..5 per --marchio-N, 0 per un tipo sconosciuto (banda neutra) */
  settore: number
  /** null sotto RARITA_DA o con una rarita' che il gioco non ha */
  rarita: string | null
  mostraIniziale: boolean
  /** l'altezza della banda del tipo, in px */
  banda: number
  /** il corpo dell'iniziale in px: con leading-none e' anche la sua altezza */
  corpoIniziale: number
  /** il corpo della rarita' in px, idem */
  corpoRarita: number
  /** dove sta la rarita': px dal bordo interno in alto o in basso (lo style del componente) */
  posRarita: { top: number } | { bottom: number }
}

/** Cosa mostra il riquadro di una carta senza miniatura, a una misura in px. */
export function segnapostoCarta({ name, type, rarity, size, angolo = 'basso' }: {
  name: string | null | undefined
  type: string | null | undefined
  rarity?: string | null
  size: number
  angolo?: AngoloRarita
}): SegnapostoCarta {
  const mostraIniziale = size >= INIZIALE_DA
  // un sedicesimo del lato (2 px a 32, 3 a 48, 10 a 160): sottile accanto
  // all'iniziale. Da sola, nei 16 px dei premi, e' l'unico segno: 4 px
  const banda = mostraIniziale ? Math.max(2, Math.round(size / 16)) : 4
  return {
    iniziale: inizialeCarta(name),
    settore: settoreTipo(type),
    rarita: size >= RARITA_DA && rarity && RARITA.has(rarity) ? rarity : null,
    mostraIniziale,
    banda,
    corpoIniziale: Math.round(size * 0.42),
    corpoRarita: Math.max(9, Math.round(size * 0.12)),
    // attaccata alla banda (lo spazio sopra le maiuscole fa da margine), o
    // a un px dal bordo: cosi' non tocca l'iniziale, nemmeno a 40 px
    posRarita: angolo === 'alto' ? { top: banda } : { bottom: 1 },
  }
}

/**
 * La cornice che il sito disegna attorno a una miniatura nuda: il solo
 * personaggio, senza la cornice del gioco, il badge del tipo e il logo (le
 * LR del wiki, asset.frame false, migrazione 0034). Il bordo ha il colore
 * del tipo come la banda del segnaposto, la rarita' sta in un'etichetta
 * dentro il bordo, a sinistra.
 */
export type CorniceDisegnata = {
  /** 1..5 per --marchio-N, 0 per un tipo sconosciuto (bordo neutro, --tenue) */
  settore: number
  /** lo spessore del bordo in px */
  bordo: number
  /** null sotto RARITA_DA o con una rarita' che il gioco non ha */
  rarita: string | null
  /** il corpo dell'etichetta in px: con leading-none e' anche la sua altezza, senza il padding */
  corpoRarita: number
  /** dove sta l'etichetta: px dal bordo esterno, appena dentro il bordo disegnato */
  posRarita: { top: number } | { bottom: number }
}

/** Il padding verticale dell'etichetta della rarita' in CorniceCarta (py-px), per lato. */
export const PAD_RARITA = 1

/** Le misure della cornice disegnata attorno a una miniatura nuda, a una misura in px. */
export function corniceDisegnata({ type, rarity, size, angolo = 'basso' }: {
  type: string | null | undefined
  rarity?: string | null
  size: number
  angolo?: AngoloRarita
}): CorniceDisegnata {
  // un sedicesimo del lato come la banda (3 px a 48, 10 a 160, 16 a 250);
  // 1 px nei riquadri sotto INIZIALE_DA (i 16 px dei premi), dove 4 px
  // coprirebbero mezzo personaggio
  const bordo = size < INIZIALE_DA ? 1 : Math.max(2, Math.round(size / 16))
  return {
    settore: settoreTipo(type),
    bordo,
    rarita: size >= RARITA_DA && rarity && RARITA.has(rarity) ? rarity : null,
    corpoRarita: Math.max(9, Math.round(size * 0.12)),
    posRarita: angolo === 'alto' ? { top: bordo } : { bottom: bordo },
  }
}

/**
 * Tipo e classe per esteso, per i lettori di schermo: "Super AGL",
 * "Extreme INT", il solo tipo senza classe. La stessa regola di
 * components/tipo.tsx, che scrive "SAGL" ed "EINT" (S per Super, E per
 * tutto il resto).
 */
export function tipoPerEsteso(type: string, classe?: string | null): string {
  if (!classe) return type
  return `${classe === 'Super' ? 'Super' : 'Extreme'} ${type}`
}

/** Il tipo di evento in parole, come lo scrive la pagina dell'evento. */
export const ETICHETTA_EVENTO: Record<string, string> = {
  challenge: 'Challenge', zbattle: 'Extreme Z-Battle', limited: 'Limited', story: 'Story',
  bonus: 'Bonus', world_tournament: 'World Tournament', other: 'Event',
}

/** L'icona del segnaposto di un evento: il nome, il componente lo traduce in un'icona Phosphor. */
export type IconaEvento = 'lampo' | 'trofeo' | 'libro' | 'clessidra' | 'regalo' | 'medaglia' | 'calendario'

const ICONA_EVENTO = new Map<string, IconaEvento>([
  ['zbattle', 'lampo'], ['challenge', 'trofeo'], ['story', 'libro'], ['limited', 'clessidra'],
  ['bonus', 'regalo'], ['world_tournament', 'medaglia'],
])
// Una Map e non l'oggetto: "constructor" o "toString" non sono tipi di evento
const ETICHETTE = new Map(Object.entries(ETICHETTA_EVENTO))

/** Il segnaposto di un evento senza immagine: un'icona per tipo, il calendario per tutto il resto. */
export function segnapostoEvento(kind: string | null | undefined): { icona: IconaEvento; etichetta: string } {
  const k = kind ?? ''
  return { icona: ICONA_EVENTO.get(k) ?? 'calendario', etichetta: ETICHETTE.get(k) ?? 'Event' }
}
