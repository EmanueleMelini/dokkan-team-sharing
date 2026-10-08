import { Lightbulb } from '@phosphor-icons/react/dist/ssr'
import type { EventTips } from '@/lib/tips'
import { TipsPannello } from '@/components/tips/pannello'

type Props = {
  eventId: string
  tierId: string
  /** il nome del tier come lo dice il pannello: "Stage name, Super 2" o "Level 30" */
  nomeTier: string
  eza: boolean
  tips: EventTips
  /** la pagina di questo tier con #tips, per tornarci dopo l'accesso */
  ritorno: string
}

/**
 * Il blocco delle tip nella pagina di un evento, tra l'intestazione del
 * tier e la lista dei clear. Server component con dati in cache, uguale
 * per tutti: ordine, "Show all" e tutto cio' che dipende da chi guarda
 * stanno nell'isola TipsPannello. Le tip valgono per Global e Japan: gli
 * stage non hanno regione.
 */
export function Tips({ eventId, tierId, nomeTier, eza, tips, ritorno }: Props) {
  return (
    <section id="tips" aria-labelledby="titolo-tips" className="mt-4 pb-4 border-b border-linea scroll-mt-6">
      <h3 id="titolo-tips" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-inchiostro">
        <Lightbulb size={14} weight="bold" aria-hidden className="text-oro" />
        Tips
      </h3>
      <p className="mt-0.5 text-[12px] text-tenue">Short advice from players. Mark what helped you.</p>
      {/* key: cambiare tier riparte dall'ordine Top e dai gruppi chiusi */}
      <TipsPannello
        key={tierId}
        eventId={eventId}
        tierId={tierId}
        titoloTier={eza ? `For ${nomeTier.replace(/^Level/, 'level')}` : `For ${nomeTier}`}
        etichettaTier={eza ? 'This level' : 'This stage'}
        nomeTier={eza ? 'level' : 'stage'}
        // su un EZA lo stesso consiglio vale quasi sempre per ogni livello
        scopeIniziale={eza ? 'event' : 'stage'}
        stage={tips.stage}
        event={tips.event}
        ritorno={ritorno}
      />
    </section>
  )
}
