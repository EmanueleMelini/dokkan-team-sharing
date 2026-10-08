import Image from 'next/image'
import { assetUrl } from '@/lib/db'
import { Tipo } from '@/components/tipo'

export type CartaProps = {
  // NULL per le carte che il wiki non ha ancora (0015): la riga resta
  // vuota invece di inventare un epiteto
  epithet: string | null
  name: string
  type: string
  class?: string | null
  rarity?: string
  thumbKey: string | null
  ruolo?: 'leader' | 'member' | 'friend'
}

const RUOLO: Record<string, string> = { leader: 'Leader', friend: 'Friend' }

/** Una carta in una squadra: miniatura, ruolo, nome, tipo. */
export function Carta({ epithet, name, type, class: classe, thumbKey, ruolo }: CartaProps) {
  const src = assetUrl(thumbKey)
  const etichetta = ruolo ? RUOLO[ruolo] : undefined

  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div className="relative shrink-0">
        {/* alt vuoto: il nome della carta è scritto accanto, l'immagine
            lo ripeterebbe soltanto */}
        {src ? (
          <Image
            src={src}
            alt=""
            width={48}
            height={48}
            className="rounded-[var(--raggio)] bg-superficie-2"
          />
        ) : (
          <div
            className="w-12 h-12 rounded-[var(--raggio)] bg-superficie-2 border border-linea"
            aria-hidden
          />
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
          {name}
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
