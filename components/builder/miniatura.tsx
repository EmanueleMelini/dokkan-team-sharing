import Image from 'next/image'
import { Tipo } from '@/components/tipo'
import type { CartaScelta } from '@/lib/clears/builder-stato'

/**
 * La miniatura di una carta nel builder e nel picker. Le carte prese dal
 * gioco (0015) spesso non hanno immagine: al suo posto un riquadro con il
 * tipo, così la carta resta riconoscibile.
 */
export function Miniatura({ carta, size = 44 }: { carta: Pick<CartaScelta, 'thumb' | 'type' | 'class'>; size?: number }) {
  if (carta.thumb) {
    return (
      <Image
        src={carta.thumb}
        alt=""
        width={size}
        height={size}
        // le dimensioni anche nello style: il preflight di Tailwind mette
        // height:auto alle img e next/image avvisa del rapporto alterato
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[var(--raggio)] bg-superficie-2"
      />
    )
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="shrink-0 inline-flex items-center justify-center rounded-[var(--raggio)] bg-superficie-2 border border-linea"
    >
      <Tipo tipo={carta.type} classe={carta.class} />
    </span>
  )
}
