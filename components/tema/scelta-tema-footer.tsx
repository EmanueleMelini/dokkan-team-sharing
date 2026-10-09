'use client'

import { useId } from 'react'
import { useCambiaTema } from '@/components/viewer/provider'
import { useTema } from '@/lib/tema/client'
import { TEMI, isTemaId } from '@/lib/tema/temi'

/**
 * Il selettore compatto del footer, per tutti (anche senza account). Un
 * <select> nativo: corto, da tastiera, e i suoi colori seguono
 * color-scheme. Sul server e all'idratazione mostra System per tutti; il
 * tema vero arriva al render dopo (useTema).
 */
export function SceltaTemaFooter() {
  const tema = useTema()
  const cambia = useCambiaTema()
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id}>Theme</label>
      <select
        id={id}
        value={tema ?? 'system'}
        onChange={(e) => { if (isTemaId(e.target.value)) cambia(e.target.value) }}
        className="px-1.5 py-1 text-xs rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro"
      >
        {TEMI.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </div>
  )
}
