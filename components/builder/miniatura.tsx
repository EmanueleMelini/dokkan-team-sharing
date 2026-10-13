import Image from 'next/image'
import { CorniceCarta, SegnapostoCarta } from '@/components/segnaposto'
import { Tipo } from '@/components/tipo'
import { tipoPerEsteso } from '@/lib/segnaposto'

/**
 * La miniatura di una carta nel builder, nel picker e nei filtri dei
 * clear. Le carte prese dal gioco (0015) spesso non hanno immagine: al suo
 * posto il segnaposto con il colore del tipo, l'iniziale e la rarita',
 * così la carta resta riconoscibile. Il nome e' sempre scritto accanto.
 *
 * Il riquadro e' quadrato, cosi' le righe del picker restano allineate, ma
 * le miniature del gioco quasi mai lo sono (2449 su 2632: 256x224 le
 * vecchie, 255x255 le nuove): object-fit contain le tiene intere e nelle
 * loro proporzioni, e il fondo del riquadro riempie i due o tre px che
 * avanzano. Prima larghezza e altezza fissate senza object-fit le
 * stiravano di un settimo in altezza, su ogni browser. Una miniatura nuda
 * (bare: il solo personaggio, asset.frame false) sta dentro la cornice
 * disegnata.
 */
export function Miniatura({ carta, size = 44 }: {
  carta: { thumb: string | null; type: string; name: string | null; rarity?: string | null; bare?: boolean }
  size?: number
}) {
  if (carta.thumb) {
    const img = (
      <Image
        src={carta.thumb}
        alt=""
        width={size}
        height={size}
        // le dimensioni anche nello style: il preflight di Tailwind mette
        // height:auto alle img e next/image avvisa del rapporto alterato.
        // Con entrambe fissate serve objectFit, o l'immagine si deforma
        style={{ width: size, height: size, objectFit: 'contain' }}
        className="shrink-0 rounded-[var(--raggio)] bg-superficie-2"
      />
    )
    return carta.bare
      ? <CorniceCarta type={carta.type} rarity={carta.rarity} size={size}>{img}</CorniceCarta>
      : img
  }
  return <SegnapostoCarta name={carta.name} type={carta.type} rarity={carta.rarity} size={size} />
}

/**
 * Tipo e classe in lettere ("SAGL", "EINT") accanto al nome di una carta
 * senza miniatura, dove il riquadro e' piccolo e il nome non li dice: lo
 * slot del builder (40 px) e il menu "Uses card" dei filtri (32 px). Il
 * segnaposto li' ha la banda col colore del tipo, ma il colore da solo non
 * basta, e la classe non la dice affatto; il riquadro di prima li
 * scriveva. Una miniatura del gioco invece li mostra da se': niente, se
 * non e' nuda.
 *
 * Un lettore di schermo sente "Super AGL" invece di "SAGL", con una
 * virgola per staccarlo dal nome.
 */
export function TipoSenzaMiniatura({ carta }: {
  carta: { thumb: string | null; type: string; class?: string | null; bare?: boolean }
}) {
  // una miniatura nuda non ha il badge del tipo: anche li' accanto
  if (carta.thumb && !carta.bare) return null
  return (
    <span className="shrink-0">
      <span aria-hidden><Tipo tipo={carta.type} classe={carta.class} /></span>
      <span className="sr-only">, {tipoPerEsteso(carta.type, carta.class)}</span>
    </span>
  )
}
