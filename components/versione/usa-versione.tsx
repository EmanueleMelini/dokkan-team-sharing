'use client'

import { useId, useRef, useState, useTransition, type ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { useCambiaVersione } from '@/components/viewer/provider'
import { annunciaVersione, useVersione } from '@/lib/versione/client'
import { RIPROVA_VERSIONE, annuncioVersione } from '@/lib/versione/interruttore'
import type { Versione } from '@/lib/versione/versione'

/**
 * Il bottone sta nell'avviso, e il cambio lo nasconde (CSS): col focus
 * dentro, il browser lo rimetterebbe in cima al documento (WCAG 2.4.3).
 * Prima di nasconderlo, il focus va al titolo della pagina (tabindex -1:
 * raggiungibile dallo script, non dal Tab).
 */
function focusFuoriDa(avviso: Element | null) {
  if (!avviso || !avviso.contains(document.activeElement)) return
  const titolo = document.querySelector<HTMLElement>('main h1')
  if (!titolo) return
  if (!titolo.hasAttribute('tabindex')) titolo.tabIndex = -1
  titolo.focus()
}

/**
 * "Use Japan everywhere" dell'avviso (AvvisoVersione): la versione di
 * questa pagina diventa quella del sito. La pagina e' gia' di quella
 * versione, quindi si resta qui (quiPerCambio): l'avviso sparisce col CSS
 * appena l'attributo cambia, e lo dice la regione live del layout.
 *
 * Un errore puo' arrivare dopo secondi (la rete): una riga in piu'
 * nell'avviso spingerebbe giu' la pagina. Allora lo dice il bottone
 * stesso, nel suo posto: l'icona e "Try again" al posto di "Use ...
 * everywhere", sovrapposti nella stessa cella, cosi' la larghezza e'
 * sempre quella dell'etichetta piu' lunga e non cambia niente intorno.
 * L'errore intero e' un role=alert per i lettori di schermo, e descrive
 * il bottone finche' c'e'.
 */
export function UsaVersione({ v, children }: { v: Versione; children: ReactNode }) {
  const cambia = useCambiaVersione()
  const versione = useVersione()
  const [inCorso, avvia] = useTransition()
  const [errore, setErrore] = useState<string | null>(null)
  const bottone = useRef<HTMLButtonElement>(null)
  const id = useId()

  return (
    <>
      <button
        ref={bottone}
        type="button"
        aria-disabled={inCorso || undefined}
        aria-describedby={errore ? `${id}-errore` : undefined}
        onClick={() => {
          if (inCorso || versione === null || versione === v) return
          setErrore(null)
          avvia(async () => {
            const r = await cambia(v, () => focusFuoriDa(bottone.current?.closest('[data-avviso-versione]') ?? null))
            if ('error' in r) setErrore(r.error)
            else annunciaVersione(annuncioVersione(v))
          })
        }}
        className={`relative inline-grid h-6 items-center justify-items-center rounded-[var(--raggio)] border bg-superficie px-2 font-medium text-inchiostro transition-colors active:bg-superficie-2 aria-disabled:cursor-wait ${
          errore ? 'border-str/40 hover:border-str' : 'border-oro-linea hover:border-oro'
        }`}
      >
        {/* le due etichette nella stessa cella: quella nascosta tiene la larghezza (e non ha nome) */}
        <span className={`col-start-1 row-start-1 ${errore ? 'invisible' : ''}`}>{children}</span>
        <span className={`col-start-1 row-start-1 inline-flex items-center gap-1 text-str ${errore ? '' : 'invisible'}`}>
          <WarningCircle size={14} weight="bold" aria-hidden className="shrink-0" />
          {RIPROVA_VERSIONE}
        </span>
        {/* il velo dei link che caricano (AttesaLink): sempre presente, non sposta niente */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 rounded-[inherit] bg-current transition-opacity ${inCorso ? 'opacity-15' : 'opacity-0'}`}
        />
      </button>
      {errore && <span id={`${id}-errore`} role="alert" className="sr-only">{errore}</span>}
    </>
  )
}
