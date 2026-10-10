import type { Icon } from '@phosphor-icons/react'
import {
  BookOpenText, CalendarBlank, Gift, Hourglass, Lightning, Medal, Trophy,
} from '@phosphor-icons/react/dist/ssr'
import { segnapostoCarta, segnapostoEvento, type AngoloRarita, type IconaEvento } from '@/lib/segnaposto'

/*
 * I segnaposto delle immagini che non abbiamo: la miniatura di una carta,
 * l'immagine di un evento. Fatti solo di roba nostra (lib/segnaposto.ts):
 * nessuna immagine, nessuna icona del wiki.
 *
 * Niente 'use client', hook o sessione: vanno nelle pagine in cache e
 * dentro le isole client (builder, picker, artwork) allo stesso modo, e
 * l'HTML resta uguale per tutti. Il tema lo segue solo il CSS: i token di
 * app/globals.css per fondo, bordo e testo, le variabili del marchio per
 * la banda del tipo (chiara o scura come il marchio nell'header). Anche
 * quelle stanno in globals.css, sotto .colori-marchio: niente <style> qui,
 * che ogni segnaposto rimetterebbe nel payload della pagina.
 */

/**
 * Una carta senza miniatura: in alto una banda col colore del tipo, al
 * centro l'iniziale del nome, a sinistra la rarita'. In basso, dove la
 * mettono le miniature del gioco; in alto sotto la banda con
 * angolo="alto", dove il fondo del riquadro lo copre un'etichetta (Leader
 * e Friend nelle squadre dei clear, components/carta.tsx). Le misure le
 * decide lib/segnaposto.ts, e db/test/segnaposto.test.mts prova che niente
 * si sovrapponga. Il testo non sta mai sul colore del marchio: inchiostro e
 * tenue su superficie-2, che i temi tengono a contrasto.
 *
 * Di norma e' decorativo (aria-hidden): il nome e' scritto accanto. Con
 * `etichetta`, dove il riquadro e' l'unica cosa che dice la carta, diventa
 * un'immagine col nome.
 */
export function SegnapostoCarta({ name, type, rarity, size, angolo, etichetta }: {
  name: string | null | undefined
  type: string | null | undefined
  rarity?: string | null
  size: number
  angolo?: AngoloRarita
  etichetta?: string
}) {
  const s = segnapostoCarta({ name, type, rarity, size, angolo })
  const accessibile = etichetta
    ? { role: 'img', 'aria-label': etichetta, title: etichetta }
    : { 'aria-hidden': true }
  return (
    <span
      data-segnaposto="carta"
      {...accessibile}
      style={{ width: size, height: size }}
      // piccolo come le icone dei premi (16 px): il loro raggio, non quello
      // dei riquadri, che si mangerebbe la banda
      className={`colori-marchio relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-linea bg-superficie-2 ${
        s.mostraIniziale ? 'rounded-[var(--raggio)]' : 'rounded-[2px]'
      }`}
    >
      <span
        className="absolute inset-x-0 top-0"
        style={{
          height: s.banda,
          // un tipo sconosciuto (una carta nota solo dall'URL): banda neutra,
          // col grigio del testo tenue, che sta a contrasto come le altre
          background: s.settore ? `var(--marchio-${s.settore})` : 'var(--tenue)',
        }}
      />
      {s.mostraIniziale && (
        <span className="font-semibold leading-none text-inchiostro" style={{ fontSize: s.corpoIniziale }}>
          {s.iniziale}
        </span>
      )}
      {s.rarita && (
        <span
          className="numeri absolute left-1 leading-none text-tenue"
          style={{ fontSize: s.corpoRarita, ...s.posRarita }}
        >
          {s.rarita}
        </span>
      )}
    </span>
  )
}

// Icone Phosphor gia' nel bundle del sito, una per tipo di evento
const ICONE: Record<IconaEvento, Icon> = {
  lampo: Lightning, trofeo: Trophy, libro: BookOpenText, clessidra: Hourglass,
  regalo: Gift, medaglia: Medal, calendario: CalendarBlank,
}

/**
 * Un evento senza banner ne' carta del boss: l'icona del suo tipo. Sempre
 * decorativa, il tipo e' scritto accanto (sulla scheda della lista) o
 * nell'intestazione (sulla pagina dell'evento).
 */
export function SegnapostoEvento({ kind, misura }: { kind: string; misura: 'scheda' | 'pagina' }) {
  const I = ICONE[segnapostoEvento(kind).icona]
  return (
    <I
      data-segnaposto="evento"
      size={misura === 'pagina' ? 40 : 28}
      weight="duotone"
      aria-hidden
      className="shrink-0 text-tenue"
    />
  )
}
