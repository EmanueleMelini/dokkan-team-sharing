'use client'

import { useMemo } from 'react'
import type { Filtri } from '@/components/builder/use-carte'
import { Scelta } from '@/components/scelta/scelta'
import {
  OPZIONI_PICKER_CLASSE, OPZIONI_PICKER_RARITA, OPZIONI_PICKER_TIPO, opzioniPickerCategoria,
} from '@/lib/clears/builder-opzioni'
import type { Opzione } from '@/lib/scelta'

export type Categoria = { id: number; name: string }

type Props = {
  filtri: Filtri
  onFiltri: (f: Filtri) => void
  categorie: Categoria[]
  idBase: string
}

/** I quattro filtri del picker (menu a scelta). Cambiano i risultati subito, senza un bottone. */
export function PickerFiltri({ filtri, onFiltri, categorie, idBase }: Props) {
  // Le categorie sono un centinaio: l'elenco e' virtuale (components/scelta)
  const vociCategoria = useMemo(() => opzioniPickerCategoria(categorie), [categorie])
  const campo = (k: keyof Filtri, etichetta: string, opzioni: readonly Opzione[]) => (
    <div className="min-w-0">
      <label htmlFor={`${idBase}-${k}`} className="block text-[11px] text-tenue">{etichetta}</label>
      <Scelta
        id={`${idBase}-${k}`}
        etichetta={etichetta}
        opzioni={opzioni}
        valore={filtri[k]}
        onCambia={(v) => onFiltri({ ...filtri, [k]: v })}
        className="mt-1 w-full"
      />
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]">
      {campo('type', 'Type', OPZIONI_PICKER_TIPO)}
      {campo('class', 'Class', OPZIONI_PICKER_CLASSE)}
      {campo('rarity', 'Rarity', OPZIONI_PICKER_RARITA)}
      {campo('category', 'Category', vociCategoria)}
    </div>
  )
}
