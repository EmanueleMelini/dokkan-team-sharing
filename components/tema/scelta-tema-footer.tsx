'use client'

import { useId } from 'react'
import { useCambiaTema } from '@/components/viewer/provider'
import { Scelta } from '@/components/scelta/scelta'
import { useTema } from '@/lib/tema/client'
import { OPZIONI_TEMA, isTemaId } from '@/lib/tema/temi'

/**
 * Il selettore compatto del footer, per tutti (anche senza account): un
 * menu a scelta (components/scelta) con gli 11 temi. Undici voci: sul
 * telefono si sceglie col dito, senza tastiera, e in fondo alla pagina
 * l'elenco si apre verso l'alto.
 *
 * Nell'HTML del server c'e' il <select> nativo, uguale per tutti, che
 * mostra System; il combobox lo sostituisce dopo l'idratazione, nella
 * stessa scatola. Il tema non passa di qui: data-theme lo mette lo script
 * del <head> prima del primo paint (nessun lampo), e un cambio lo applica
 * applicaTema. Il campo mostra System finche' useTema non lo sa (null sul
 * server e all'idratazione), poi il tema vero. Solo token dei temi, quindi
 * anche il menu cambia colore con loro.
 */
export function SceltaTemaFooter() {
  const tema = useTema()
  const cambia = useCambiaTema()
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id}>Theme</label>
      <Scelta
        id={id}
        etichetta="Theme"
        misura="compatta"
        opzioni={OPZIONI_TEMA}
        valore={tema ?? 'system'}
        onCambia={(v) => { if (isTemaId(v)) cambia(v) }}
        className="w-[9.5rem]"
      />
    </div>
  )
}
