'use client'

import type { Filtri } from '@/components/builder/use-carte'

export type Categoria = { id: number; name: string }

// Gli stessi valori che /api/cards accetta (lib/cards.ts, che è solo server)
const TIPI = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
const CLASSI = ['Super', 'Extreme']
const RARITA = ['LR', 'UR', 'SSR', 'SR', 'R', 'N']

const select =
  'mt-1 w-full min-w-0 px-2 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro'

type Props = {
  filtri: Filtri
  onFiltri: (f: Filtri) => void
  categorie: Categoria[]
  idBase: string
}

/** I quattro filtri del picker. Cambiano i risultati subito, senza un bottone. */
export function PickerFiltri({ filtri, onFiltri, categorie, idBase }: Props) {
  const campo = (k: keyof Filtri, etichetta: string, vuoto: string, opzioni: { v: string; t: string }[]) => (
    <div className="min-w-0">
      <label htmlFor={`${idBase}-${k}`} className="block text-[11px] text-tenue">{etichetta}</label>
      <select
        id={`${idBase}-${k}`}
        value={filtri[k]}
        onChange={(e) => onFiltri({ ...filtri, [k]: e.target.value })}
        className={select}
      >
        <option value="">{vuoto}</option>
        {opzioni.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]">
      {campo('type', 'Type', 'Any type', TIPI.map((v) => ({ v, t: v })))}
      {campo('class', 'Class', 'Any class', CLASSI.map((v) => ({ v, t: v })))}
      {campo('rarity', 'Rarity', 'Any rarity', RARITA.map((v) => ({ v, t: v })))}
      {campo('category', 'Category', 'Any category', categorie.map((c) => ({ v: String(c.id), t: c.name })))}
    </div>
  )
}
