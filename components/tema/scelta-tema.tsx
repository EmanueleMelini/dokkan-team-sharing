'use client'

import { useId } from 'react'
import { useCambiaTema } from '@/components/viewer/provider'
import { useTema } from '@/lib/tema/client'
import { TEMI, type TemaId } from '@/lib/tema/temi'

const TIPI = ['bg-agl', 'bg-teq', 'bg-int', 'bg-str', 'bg-phy'] as const

/**
 * Un campione: sfondo, una superficie con testo e oro, i cinque tipi. I
 * colori li prende dal CSS (data-theme sullo span), non da una copia qui.
 * Decorativo: il nome del tema e' nell'etichetta accanto.
 */
function Campione({ tema }: { tema: Exclude<TemaId, 'system'> }) {
  return (
    <span data-theme={tema} className="flex-1 block bg-sfondo p-1.5">
      <span className="flex items-center justify-between gap-1 rounded-[var(--raggio)] border border-linea bg-superficie px-1.5 py-1">
        <span className="text-[11px] font-semibold leading-none text-inchiostro">Aa</span>
        <span className="h-1.5 w-4 rounded-full bg-oro" />
      </span>
      <span className="mt-1.5 flex gap-1">
        {TIPI.map((c) => <span key={c} className={`h-2 w-2 rounded-full ${c}`} />)}
      </span>
    </span>
  )
}

/**
 * Il tema in Settings: un radio group nativo (frecce per muoversi, il nome
 * scritto accanto a ogni campione). Si applica al clic, senza Save: il
 * browser lo ricorda subito e l'account lo riceve senza farsi aspettare.
 * System mostra le due meta', chiaro e scuro.
 */
export function SceltaTema() {
  const tema = useTema()
  const cambia = useCambiaTema()
  const id = useId()
  return (
    <fieldset aria-describedby={`${id}-aiuto`}>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {TEMI.map((t) => (
          <label
            key={t.id}
            className="flex flex-col overflow-hidden rounded-[var(--raggio)] border border-linea bg-superficie cursor-pointer hover:border-linea-forte has-[:checked]:border-oro has-[:checked]:ring-1 has-[:checked]:ring-oro"
          >
            <span aria-hidden="true" className="flex border-b border-linea">
              {t.id === 'system' ? (
                <>
                  <Campione tema="light" />
                  <Campione tema="dark" />
                </>
              ) : (
                <Campione tema={t.id} />
              )}
            </span>
            <span className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-inchiostro">
              <input
                type="radio"
                name="tema"
                value={t.id}
                checked={tema === t.id}
                onChange={() => cambia(t.id)}
                className="accent-[var(--oro)]"
              />
              {t.label}
            </span>
          </label>
        ))}
      </div>
      <p id={`${id}-aiuto`} className="mt-3 text-[12px] leading-relaxed text-tenue">
        Applies right away. System follows your device&apos;s light or dark setting. Your choice is saved to
        your account, so it follows you to other devices. Type names always stay written, so no theme relies on
        color alone.
      </p>
    </fieldset>
  )
}
