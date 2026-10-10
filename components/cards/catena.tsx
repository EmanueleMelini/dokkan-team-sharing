import Image from 'next/image'
import Link from 'next/link'
import { CaretRight } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { cardHref } from '@/lib/urls'
import { Tipo } from '@/components/tipo'
import { SegnapostoCarta } from '@/components/segnaposto'
import type { ChainItem } from '@/lib/card-page'

/**
 * La catena del Dokkan Awakening, dalla prima forma all'ultima. La carta
 * della pagina non e' un link (aria-current); le altre si'. La riga
 * scorre dentro il suo contenitore, mai la pagina.
 */
export function Catena({ catena, corrente }: { catena: ChainItem[]; corrente: string }) {
  return (
    <ol className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
      {catena.map((c, i) => {
        const qui = c.id === corrente
        const src = assetUrl(c.thumb_key)
        const corpo = (
          <>
            {src ? (
              <Image src={src} alt="" width={48} height={48} className="rounded-[var(--raggio)] bg-superficie-2" />
            ) : (
              <SegnapostoCarta name={c.name} type={c.type} rarity={c.rarity} size={48} />
            )}
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-inchiostro">{c.name ?? `Card ${c.id}`}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-tenue">
                <span className="numeri">{c.rarity}</span>
                <Tipo tipo={c.type} classe={c.class} />
                {!c.global && <span className="text-oro">JP only</span>}
              </span>
            </span>
          </>
        )
        const scatola = 'flex w-44 shrink-0 items-center gap-2 rounded-[var(--raggio)] border p-1.5'
        return (
          <li key={c.id} className="flex items-center gap-1.5">
            {i > 0 && <CaretRight size={14} weight="bold" aria-hidden className="shrink-0 text-tenue" />}
            {qui ? (
              <div aria-current="page" className={`${scatola} border-oro-linea bg-oro-tenue`}>{corpo}</div>
            ) : (
              <Link href={cardHref(c.id)} prefetch={false} className={`${scatola} border-linea bg-superficie hover:bg-superficie-2`}>
                {corpo}
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}
