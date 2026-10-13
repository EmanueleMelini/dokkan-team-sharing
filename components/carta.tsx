import Image from 'next/image'
import Link from 'next/link'
import { assetUrl } from '@/lib/db'
import { cardHref } from '@/lib/urls'
import { Tipo } from '@/components/tipo'
import { CorniceCarta, SegnapostoCarta } from '@/components/segnaposto'

export type CartaProps = {
  // NULL per le carte che il wiki non ha ancora (0015): la riga resta
  // vuota invece di inventare un epiteto
  epithet: string | null
  name: string
  type: string
  class?: string | null
  rarity?: string | null
  thumbKey: string | null
  /** la miniatura e' il solo personaggio (asset_bare, 0034): dentro la cornice disegnata */
  thumbBare?: boolean
  ruolo?: 'leader' | 'member' | 'friend'
  /**
   * Con l'id il nome porta alla pagina della carta, nella stessa scheda.
   * Senza prefetch: una pagina evento ha 20 clear da 7 carte, e 140
   * prefetch a pagina costerebbero CPU per niente.
   */
  cardId?: string
}

const RUOLO: Record<string, string> = { leader: 'Leader', friend: 'Friend' }

/** Una carta in una squadra: miniatura, ruolo, nome, tipo. */
export function Carta({ epithet, name, type, class: classe, rarity, thumbKey, thumbBare = false, ruolo, cardId }: CartaProps) {
  const src = assetUrl(thumbKey)
  const etichetta = ruolo ? RUOLO[ruolo] : undefined
  // alt vuoto: il nome della carta è scritto accanto, l'immagine lo
  // ripeterebbe soltanto
  const img = src && (
    <Image
      src={src}
      alt=""
      width={48}
      height={48}
      className="rounded-[var(--raggio)] bg-superficie-2"
    />
  )

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div className="relative shrink-0">
        {img ? (
          // Una miniatura nuda: la cornice disegnata, con la rarita' in alto
          // come il segnaposto qui sotto (in basso c'e' l'etichetta del ruolo)
          thumbBare ? <CorniceCarta type={type} rarity={rarity} size={48} angolo="alto">{img}</CorniceCarta> : img
        ) : (
          // Senza miniatura (le carte prese dal gioco): il riquadro del
          // tipo, decorativo come l'immagine. La rarita' in alto, sotto la
          // banda: in basso la coprirebbe l'etichetta del ruolo qui sotto,
          // larga quasi quanto il riquadro. In alto anche per i membri, cosi'
          // in una squadra le rarita' stanno tutte alla stessa altezza.
          <SegnapostoCarta name={name} type={type} rarity={rarity} size={48} angolo="alto" />
        )}
        {etichetta && (
          <span className="absolute -bottom-1 -right-1 numeri text-[10px] font-semibold px-1 py-px rounded-[var(--raggio)] bg-oro-tenue text-oro border border-oro-linea">
            {etichetta}
          </span>
        )}
      </div>
      {/* I nomi di Dokkan sono lunghi ("Super Saiyan Gohan (Future)/Super
          Saiyan Trunks (Youth) (Future)"): troncati a una riga, il title
          li rende leggibili interi. */}
      <div className="min-w-0 pt-0.5">
        <div className="text-[13px] font-medium text-inchiostro leading-tight truncate" title={name}>
          {cardId ? (
            <Link href={cardHref(cardId)} prefetch={false} className="hover:underline decoration-oro-linea underline-offset-2">
              {name}
            </Link>
          ) : name}
        </div>
        {epithet && (
          <div className="text-[11px] text-tenue leading-tight truncate" title={epithet}>
            {epithet}
          </div>
        )}
        <Tipo tipo={type} classe={classe} />
      </div>
    </div>
  )
}
