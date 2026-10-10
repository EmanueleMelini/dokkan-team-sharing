import Image from 'next/image'
import { SegnapostoCarta } from '@/components/segnaposto'
import { Tipo } from '@/components/tipo'
import { tipoPerEsteso } from '@/lib/segnaposto'

/**
 * La miniatura di una carta nel builder, nel picker e nei filtri dei
 * clear. Le carte prese dal gioco (0015) spesso non hanno immagine: al suo
 * posto il segnaposto con il colore del tipo, l'iniziale e la rarita',
 * così la carta resta riconoscibile. Il nome e' sempre scritto accanto.
 */
export function Miniatura({ carta, size = 44 }: {
  carta: { thumb: string | null; type: string; name: string | null; rarity?: string | null }
  size?: number
}) {
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
  return <SegnapostoCarta name={carta.name} type={carta.type} rarity={carta.rarity} size={size} />
}

/**
 * Tipo e classe in lettere ("SAGL", "EINT") accanto al nome di una carta
 * senza miniatura, dove il riquadro e' piccolo e il nome non li dice: lo
 * slot del builder (40 px) e il menu "Uses card" dei filtri (32 px). Il
 * segnaposto li' ha la banda col colore del tipo, ma il colore da solo non
 * basta, e la classe non la dice affatto; il riquadro di prima li
 * scriveva. Una miniatura del gioco invece li mostra da se': niente.
 *
 * Un lettore di schermo sente "Super AGL" invece di "SAGL", con una
 * virgola per staccarlo dal nome.
 */
export function TipoSenzaMiniatura({ carta }: {
  carta: { thumb: string | null; type: string; class?: string | null }
}) {
  if (carta.thumb) return null
  return (
    <span className="shrink-0">
      <span aria-hidden><Tipo tipo={carta.type} classe={carta.class} /></span>
      <span className="sr-only">, {tipoPerEsteso(carta.type, carta.class)}</span>
    </span>
  )
}
