'use client'

import { useEffect, useId, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useViewer } from '@/components/viewer/provider'
import { Tipo } from '@/components/tipo'
import {
  artStorage, formatBytes, readArtChoice, resolveArt, saveArtChoice, type ArtMode,
} from '@/lib/card-art'

type Props = {
  cardId: string
  /** il nome per l'alt dell'artwork */
  name: string
  still: string | null
  stillW: number | null
  stillH: number | null
  animated: string | null
  animatedBytes: number | null
  thumb: string | null
  type: string
  class: string | null
}

type Ambiente = { stored: ArtMode | null; reducedMotion: boolean; saveData: boolean }

/** Save-Data: non tutti i browser hanno navigator.connection. */
function risparmioDati(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return c?.saveData === true
}

/**
 * L'artwork della carta, statico o animato. Il primo render e' sempre lo
 * statico, come l'HTML in cache: la scelta salvata, il movimento ridotto
 * e il risparmio dati si leggono dopo l'idratazione, e il default
 * dell'account arriva da /api/me. Lo statico resta sotto anche quando si
 * mostra l'animato: e' l'immagine che si vede subito (LCP), e copre
 * l'attesa dei 4 MB.
 */
export function ArtToggle({ cardId, name, still, stillW, stillH, animated, animatedBytes, thumb, type, class: classe }: Props) {
  const { user } = useViewer()
  const id = useId()
  const [amb, setAmb] = useState<Ambiente | null>(null)
  // l'URL animato gia' arrivato: al cambio di carta o di scelta si riparte
  const [arrivato, setArrivato] = useState<string | null>(null)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const leggi = () => setAmb((a) => ({
      stored: a?.stored ?? readArtChoice(artStorage(), cardId),
      reducedMotion: motion.matches,
      saveData: risparmioDati(),
    }))
    leggi()
    motion.addEventListener('change', leggi)
    return () => motion.removeEventListener('change', leggi)
  }, [cardId])

  const accountDefault: ArtMode | null = user ? (user.prefersAnimated ? 'animated' : 'still') : null
  const mode = amb
    ? resolveArt({ hasAnimated: !!animated, accountDefault, ...amb })
    : 'still'
  const peso = formatBytes(animatedBytes)
  const mostraAnimato = mode === 'animated' && !!animated
  const caricato = mostraAnimato && arrivato === animated

  function scegli(m: ArtMode) {
    setAmb((a) => ({ reducedMotion: a?.reducedMotion ?? false, saveData: a?.saveData ?? false, stored: m }))
    saveArtChoice(artStorage(), cardId, m)
  }

  // Perche' l'account dice Animated ma si vede lo statico: va detto.
  const forzato = amb && !amb.stored && accountDefault === 'animated' && animated && mode === 'still'
    ? (amb.reducedMotion ? 'reduced motion' : 'data saving')
    : null

  return (
    <div>
      {still ? (
        <div className="relative overflow-hidden rounded-[var(--raggio)] border border-linea bg-superficie-2">
          <Image
            src={still}
            alt={`${name} artwork`}
            width={stillW ?? 640}
            height={stillH ?? 855}
            preload
            sizes="(min-width: 1024px) 380px, 100vw"
            className="block w-full h-auto"
          />
          {mostraAnimato && (
            <Image
              key={animated}
              src={animated}
              alt=""
              fill
              unoptimized
              sizes="(min-width: 1024px) 380px, 100vw"
              onLoad={() => setArrivato(animated)}
              className={`object-cover transition-opacity duration-150 ${caricato ? 'opacity-100' : 'opacity-0'}`}
            />
          )}
        </div>
      ) : thumb ? (
        // Senza artwork ma con la miniatura: alla sua misura, non ingrandita
        <div className="flex aspect-[3/4] items-center justify-center rounded-[var(--raggio)] border border-linea bg-superficie-2">
          <Image src={thumb} alt={`${name} thumbnail`} width={250} height={250} preload className="max-w-[70%] h-auto" />
        </div>
      ) : (
        <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-[var(--raggio)] border border-linea bg-superficie-2 px-6 text-center">
          <span className="text-[20px]"><Tipo tipo={type} classe={classe} /></span>
          <p className="text-[13px] text-tenue">Artwork not available yet</p>
        </div>
      )}

      {animated && (
        <div className="mt-3">
          <fieldset>
            <legend className="sr-only">Artwork for this card</legend>
            <div className="inline-flex rounded-[var(--raggio)] border border-campo bg-superficie p-0.5">
              {(['still', 'animated'] as const).map((m) => (
                <label key={m} className="relative">
                  <input
                    type="radio"
                    name={`${id}-art`}
                    value={m}
                    checked={mode === m}
                    onChange={() => scegli(m)}
                    className="peer sr-only"
                  />
                  <span className="block cursor-pointer select-none rounded-[var(--raggio)] px-2.5 py-1 text-[12px] text-testo peer-checked:bg-oro-tenue peer-checked:text-oro peer-checked:font-medium peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--oro)]">
                    {m === 'still' ? 'Still' : <>Animated{peso && <span className="numeri"> · {peso}</span>}</>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p role="status" className="mt-1.5 min-h-[1lh] text-[12px] text-tenue">
            {mostraAnimato && !caricato ? `Loading animation${peso ? ` (${peso})` : ''}…` : ''}
          </p>
          <p className="text-[12px] leading-relaxed text-tenue">
            {forzato && <>Still frame shown because your device asks for {forzato}. </>}
            Default for all cards: {accountDefault === 'animated' ? 'Animated' : 'Still'}.{' '}
            <Link href="/settings" prefetch={false} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
              Change in Settings
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
