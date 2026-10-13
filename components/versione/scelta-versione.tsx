'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { useCambiaVersione } from '@/components/viewer/provider'
import { annunciaVersione, useVersione } from '@/lib/versione/client'
import { NOME_VERSIONE, annuncioVersione, esitoVersione } from '@/lib/versione/interruttore'
import { VERSIONI, type Versione } from '@/lib/versione/versione'

/** riga: l'header dai 1024px; menu: la prima riga del burger; settings: la riga di Settings. */
type Variante = 'riga' | 'menu' | 'settings'

// Un controllo a segmenti, lo stesso nelle tre varianti: un binario (lo
// sfondo della pagina, bordo linea) e due segmenti larghi uguali; cambiano
// solo le misure. Quello scelto ha il pieno di inchiostro, come i chip dei
// tier e dei filtri: si riconosce anche senza i colori.
//
// Quale opzione e' scelta lo dice il CSS, dall'attributo data-reg che lo
// script del <head> mette prima del primo paint (variante japan:): giusto
// gia' prima dell'idratazione e uguale per tutti nell'HTML in cache.
// Global e' la base, japan: la sovrascrive. Solo token dei temi, quindi
// vale in tutti e 11 (i contrasti li prova versione-ui.test.mts).
// Nell'header l'opzione non scelta e' tenue, come il link Events accanto.
const SCELTA: Record<Variante, Record<Versione, string>> = {
  riga: {
    global: 'bg-inchiostro text-sfondo japan:bg-transparent japan:text-tenue',
    japan: 'bg-transparent text-tenue japan:bg-inchiostro japan:text-sfondo',
  },
  menu: {
    global: 'bg-inchiostro text-sfondo japan:bg-transparent japan:text-testo',
    japan: 'bg-transparent text-testo japan:bg-inchiostro japan:text-sfondo',
  },
  settings: {
    global: 'bg-inchiostro text-sfondo japan:bg-transparent japan:text-testo',
    japan: 'bg-transparent text-testo japan:bg-inchiostro japan:text-sfondo',
  },
}

// Con i colori forzati (il contrasto elevato di Windows) il browser toglie
// i colori dei temi: il pieno di inchiostro sparirebbe, e le due opzioni,
// dello stesso peso, sarebbero uguali. Quella scelta prende allora il pieno
// di sistema delle selezioni (Highlight, come una voce scelta di un
// elenco), con forced-color-adjust: none: senza, Chrome mette dietro al
// testo il suo riquadro del colore della pagina, e su Highlight il testo
// (HighlightText) sparirebbe. Sono colori di sistema, quindi quelli che
// chi guarda ha scelto (l'anello del focus, dentro: app/globals.css).
// Anche questo dal CSS, con la sua variante japan:, giusto gia' prima
// dell'idratazione.
const FORZATI: Record<Versione, string> = {
  global: 'forced-colors:bg-[color:Highlight] forced-colors:text-[color:HighlightText] forced-colors:forced-color-adjust-none ' +
    'japan:forced-colors:bg-transparent japan:forced-colors:text-[color:ButtonText] japan:forced-colors:forced-color-adjust-auto',
  japan: 'japan:forced-colors:bg-[color:Highlight] japan:forced-colors:text-[color:HighlightText] japan:forced-colors:forced-color-adjust-none',
}

const BINARIO = 'inline-grid grid-cols-2 gap-0.5 rounded-[var(--raggio)] border border-linea bg-sfondo p-0.5'

const MISURA: Record<Variante, string> = {
  // 24px: il bersaglio minimo (WCAG 2.5.8) anche col mouse
  riga: 'h-6 px-2.5 text-[12px]',
  // 44px, il bersaglio di un dito
  menu: 'h-11 px-3.5 text-[14px]',
  settings: 'h-8 px-3.5 text-[13px]',
}

// Lo stesso peso per le due opzioni: scegliere non cambia la larghezza.
// Hover e pressione solo sull'opzione non scelta: aria-pressed c'e' solo
// dopo l'idratazione, quando la versione si conosce. "segmento": il focus
// sta nei 2px fra i segmenti (app/globals.css).
const SEGMENTO = 'segmento relative inline-flex items-center justify-center font-medium whitespace-nowrap ' +
  'rounded-[calc(var(--raggio)-2px)] transition-colors aria-disabled:cursor-wait ' +
  'aria-[pressed=false]:hover:bg-superficie-2 aria-[pressed=false]:hover:text-inchiostro aria-[pressed=false]:active:bg-linea'

const CONTENITORE: Record<Variante, string> = {
  riga: 'relative',
  // nel burger la riga e' una griglia (etichetta, controllo): l'errore sta
  // nella cella dell'etichetta (ERRORE.menu)
  menu: 'contents',
  // in Settings l'esito sta accanto al controllo dai 640px; sotto non ci
  // sta e va sulla riga dopo, che resta riservata (ESITO)
  settings: 'flex flex-wrap items-center gap-x-3 gap-y-1.5',
}

// Il posto dell'esito di Settings, e dell'errore: sotto i 640px una riga
// sua, alta una riga anche vuota, cosi' scegliere non sposta quello che
// c'e' sotto (prima l'esito si svuota, poi torna). L'errore va nello
// stesso posto e ci sta in una riga anche a 320px, perche' e' breve
// (ERRORE_VERSIONE in lib/versione/interruttore.ts, misurato li'). Dai
// 640px sta accanto al controllo, dove c'e' posto (il riquadro di Display
// e' largo 32rem).
const ESITO = 'basis-full sm:basis-auto min-h-[1lh] min-w-0 text-[12px]'

const ERRORE: Record<Variante, string> = {
  // nell'header non c'e' una riga sotto: un riquadro che non sposta niente
  riga: 'absolute left-0 top-full z-30 mt-1.5 w-max max-w-80 flex items-start gap-1.5 rounded-[var(--raggio)] border border-str/40 bg-superficie px-2 py-1.5 text-[12px] leading-snug text-inchiostro shadow-sm',
  // Nel burger un errore arriva anche dopo secondi (la rete), e una riga in
  // piu' spingerebbe giu' Events e le altre voci mentre il dito ci va.
  // Allora prende il posto dell'etichetta, nella stessa cella (la riga la
  // nasconde, menu-mobile.tsx), alta quanto il controllo (50px): a 320px
  // la cella e' larga 120px e il testo va su tre righe da 15px (45px),
  // bilanciate ("Couldn't change / the version. / Try again.", senza una
  // parola sola in fondo); dai 375px su due. Il controllo resta li', per
  // riprovare.
  menu: 'col-start-1 row-start-1 flex items-start gap-1 text-[12px] leading-tight text-balance text-str',
  settings: 'flex items-start gap-1.5 leading-snug text-str',
}

/**
 * L'interruttore Global/Japan: un gruppo di due bottoni, quello scelto
 * aria-pressed. Si sceglie con il click, Spazio o Invio, e scegliere puo'
 * portare a un'altra pagina, il gemello nell'altra versione
 * (lib/versione/interruttore.ts). Due bottoni e non un radio group: un
 * radio vuole aria-checked, che l'HTML in cache (uguale per tutti) non
 * puo' dire; aria-pressed invece si puo' lasciare fuori finche' la
 * versione non si sa. Tutte e due le opzioni stanno nel giro del Tab, e il
 * focus e' quello globale (:focus-visible).
 *
 * Mentre l'azione gira e finche' la pagina nuova non e' arrivata: busy,
 * le opzioni restano dove sono (aria-disabled, non disabled: il focus non
 * si perde), e quella scelta ha il velo dei link che caricano
 * (AttesaLink). Un'opzione gia' scelta non fa niente.
 *
 * etichetta: l'id di un'etichetta visibile (il burger, Settings); senza,
 * il gruppo si chiama "Game version" solo per i lettori di schermo.
 * onNavigato: dopo l'azione, se porta al gemello (il burger si chiude).
 */
export function SceltaVersione({ variante, etichetta, onNavigato }: {
  variante: Variante
  etichetta?: string
  onNavigato?: () => void
}) {
  const versione = useVersione()
  const cambia = useCambiaVersione()
  const [inCorso, avvia] = useTransition()
  // la versione scelta mentre la pagina del gemello sta arrivando
  const [attesa, setAttesa] = useState<Versione | null>(null)
  // l'ultima scelta: il velo sta su di lei finche' il cambio non e' finito
  const [verso, setVerso] = useState<Versione | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [salvata, setSalvata] = useState<'account' | 'device' | null>(null)
  const id = useId()
  const radice = useRef<HTMLDivElement>(null)

  // L'header sta nel layout e non si smonta: un errore e' della pagina
  // dove e' successo, e cambiando pagina se ne va (il burger e Settings si
  // smontano da soli). Durante il render, come per l'attesa qui sotto.
  const percorso = usePathname()
  const [errorePer, setErrorePer] = useState(percorso)
  if (errorePer !== percorso) {
    setErrorePer(percorso)
    setErrore(null)
  }

  // Il riquadro dell'header sta sopra la pagina: si chiude anche con Esc o
  // con un tocco fuori, come il burger.
  useEffect(() => {
    if (!errore || variante !== 'riga') return
    const fuori = (e: PointerEvent) => {
      if (!radice.current?.contains(e.target as Node)) setErrore(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setErrore(null)
    }
    document.addEventListener('pointerdown', fuori)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fuori)
      document.removeEventListener('keydown', esc)
    }
  }, [errore, variante])

  // Arrivata (SeguiVersione rimette data-reg al cambio di URL): fine dell'attesa
  if (attesa !== null && versione === attesa) setAttesa(null)
  const occupato = inCorso || attesa !== null

  function scegli(v: Versione) {
    if (occupato || versione === null || v === versione) return
    setErrore(null)
    setSalvata(null)
    setVerso(v)
    avvia(async () => {
      const r = await cambia(v)
      if ('error' in r) {
        setErrore(r.error)
      } else if ('navigato' in r) {
        setAttesa(v)
        // se il cookie non resta (bloccato), l'attributo non cambia: l'attesa non e' per sempre
        setTimeout(() => setAttesa((a) => (a === v ? null : a)), 8000)
        onNavigato?.()
      } else if (variante === 'settings') {
        // Settings ha la sua riga di stato, visibile
        setSalvata(r.saved)
      } else {
        annunciaVersione(annuncioVersione(v))
      }
    })
  }

  return (
    <div ref={radice} className={CONTENITORE[variante]}>
      <div
        role="group"
        aria-label={etichetta ? undefined : 'Game version'}
        aria-labelledby={etichetta}
        aria-describedby={errore ? `${id}-errore` : undefined}
        aria-busy={occupato || undefined}
        className={BINARIO}
      >
        {VERSIONI.map((v) => (
          <button
            key={v}
            type="button"
            // prima dell'idratazione la versione non si sa: niente aria-pressed
            // (lo stato visibile lo da' il CSS)
            aria-pressed={versione === null ? undefined : versione === v}
            aria-disabled={occupato || undefined}
            onClick={() => scegli(v)}
            className={`${SEGMENTO} ${MISURA[variante]} ${SCELTA[variante][v]} ${FORZATI[v]}`}
          >
            {NOME_VERSIONE[v]}
            {/* sempre presente, cambia solo l'opacita': non sposta niente */}
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-0 rounded-[inherit] bg-current transition-opacity ${
                occupato && verso === v ? 'opacity-15' : 'opacity-0'
              }`}
            />
          </button>
        ))}
      </div>
      {variante === 'settings' ? (
        // l'esito e l'errore nello stesso posto riservato: uno solo alla volta
        <div className={ESITO}>
          <p role="status" className="text-tenue">
            {salvata && versione ? esitoVersione(versione, salvata) : ''}
          </p>
          {errore && <Errore id={`${id}-errore`} className={ERRORE.settings}>{errore}</Errore>}
        </div>
      ) : (
        errore && <Errore id={`${id}-errore`} className={ERRORE[variante]}>{errore}</Errore>
      )}
    </div>
  )
}

function Errore({ id, className, children }: { id: string; className: string; children: string }) {
  return (
    <p id={id} role="alert" className={className}>
      <WarningCircle size={14} weight="bold" aria-hidden className="mt-px shrink-0 text-str" />
      {children}
    </p>
  )
}
