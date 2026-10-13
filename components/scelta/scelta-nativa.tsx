import type { FocusEventHandler } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/ssr'
import { sceltaVisibile, testoCampo, testoNativo, valoreScelto } from '@/lib/scelta'
import {
  CAMPO, CAMPO_BASE, FRECCIA, FRECCIA_BASE, SCATOLA, SCATOLA_BASE, VALORE, VALORE_BASE,
} from '@/components/scelta/stile'
import type { PropsInterne } from '@/components/scelta/scelta'

// Senza JavaScript il <select> prende il posto del valore, alto uguale
const SENZA_SCRIPT = {
  normale: 'noscript:static noscript:py-1.5 noscript:opacity-100',
  compatta: 'noscript:static noscript:py-1 noscript:opacity-100',
} as const

/**
 * La forma del server e senza JavaScript: l'unico <select> vero del sito
 * (la guardia di db/test/scelta.test.mts lo pretende). Nell'HTML in cache
 * e' uguale per tutti, e Headless UI non gira sul server.
 *
 * La scatola mostra il valore in uno <span> che va a capo, come il campo
 * del combobox, e il <select> le sta sopra trasparente: un clic apre il
 * menu del browser, che funziona gia' prima che arrivi il combobox. Senza
 * JavaScript (noscript:, cioe' @media (scripting: none)) il <select>
 * torna visibile al posto dello <span>, con la stessa misura: il form GET
 * dei filtri manda gli stessi name=value di prima. I browser senza
 * "scripting" (Safari prima della 17) hanno la stessa regola nel
 * <noscript> della barra dei filtri, sugli attributi data-scelta-*.
 */
export function SceltaNativa({
  id, opzioni, valore, onCambia, name, misura = 'normale', className = '', disabled, aggancia,
  'aria-describedby': descritto, 'data-fuoco': fuoco, onFocus, onBlur,
}: PropsInterne & { onFocus?: FocusEventHandler<HTMLSelectElement>; onBlur?: FocusEventHandler<HTMLSelectElement> }) {
  const scelta = sceltaVisibile(opzioni, valore)
  return (
    <div data-scelta-nativa="" className={`${SCATOLA_BASE} ${SCATOLA[misura]} ${className}`}>
      <span
        aria-hidden="true"
        data-scelta-valore=""
        className={`${VALORE_BASE} ${VALORE[misura]} ${scelta?.valore === '' ? 'text-tenue' : ''} noscript:hidden`}
      >
        {scelta ? testoCampo(scelta) : ''}
      </span>
      <CaretDown size={12} weight="bold" aria-hidden className={`${FRECCIA_BASE} ${FRECCIA[misura]}`} />
      <select
        id={id}
        ref={aggancia}
        name={name}
        value={scelta?.valore ?? ''}
        disabled={disabled}
        data-fuoco={fuoco}
        aria-describedby={descritto}
        onChange={(e) => {
          const v = valoreScelto(e.target.value, valore, opzioni)
          if (v !== null) onCambia(v)
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`${CAMPO_BASE} ${CAMPO[misura]} ${SENZA_SCRIPT[misura]} cursor-default appearance-none text-inchiostro opacity-0`}
      >
        {opzioni.map((o) => (
          <option key={o.valore} value={o.valore}>{testoNativo(o)}</option>
        ))}
      </select>
    </div>
  )
}
