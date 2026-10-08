'use client'

import { useActionState, useOptimistic, useState } from 'react'
import { ThumbsUp } from '@phosphor-icons/react/dist/ssr'
import { voteTip } from '@/lib/tips/actions'
import type { TipActionState } from '@/lib/tips/validate'
import { useViewer, useViewerTier } from '@/components/viewer/provider'
import { canWrite } from '@/lib/viewer/types'

type Props = {
  tipId: string
  /** il punteggio della copia in cache: /api/me porta quello vivo */
  score: number
}

type Stato = { score: number; voted: boolean }

/**
 * "Helpful": un bottone solo, che si accende e si spegne. Come VotoClear,
 * la pagina in cache e' quella anonima: il proprio voto e il punteggio
 * vivo arrivano da /api/me (tier.tipVotes, tier.tipScores), e il voto non
 * rigenera la pagina, quindi dopo l'azione vale quello che torna.
 */
export function TipVoto({ tipId, score: inCache }: Props) {
  const { mode, user } = useViewer()
  const tier = useViewerTier()
  const [confermato, setConfermato] = useState<Stato | null>(null)
  const base: Stato = confermato ?? {
    score: tier?.tipScores?.[tipId] ?? inCache,
    voted: tier?.tipVotes?.includes(tipId) ?? false,
  }
  const [ottimista, applica] = useOptimistic(base, (cur, voto: 0 | 1) => ({
    voted: voto === 1,
    score: cur.score - (cur.voted ? 1 : 0) + voto,
  }))
  const [stato, azione, inCorso] = useActionState<TipActionState, FormData>(async (prev, form) => {
    const voto = form.get('value') === '1' ? 1 : 0
    applica(voto)
    const r = await voteTip(prev, form)
    if (r.ok && r.score !== undefined) setConfermato({ score: r.score, voted: voto === 1 })
    return r
  }, {})

  const conteggio = (
    <>
      <span className="numeri">{ottimista.score}</span>
      <span className="sr-only"> {ottimista.score === 1 ? 'person found' : 'people found'} this helpful</span>
    </>
  )

  // Da anonimi, sospesi, sulla propria tip e finche' /api/me non risponde: solo il numero
  const mia = tier?.ownTips?.includes(tipId) ?? false
  if (mode !== 'ready' || !canWrite(user) || !tier || mia) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-tenue">
        <ThumbsUp size={12} weight="bold" aria-hidden />
        {conteggio}
      </span>
    )
  }

  const acceso = ottimista.voted
  return (
    <form action={azione} aria-busy={inCorso} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="tip" value={tipId} />
      <button
        type="submit"
        name="value"
        value={acceso ? 0 : 1}
        aria-pressed={acceso}
        title={acceso ? 'Remove helpful mark' : 'Mark as helpful'}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px] rounded-[var(--raggio)] border transition-colors active:scale-[0.98] ${
          acceso ? 'bg-oro-tenue border-oro text-oro' : 'bg-superficie border-campo text-testo hover:text-inchiostro'
        }`}
      >
        <ThumbsUp size={12} weight={acceso ? 'fill' : 'bold'} aria-hidden />
        Helpful
        <span className="text-inchiostro">{conteggio}</span>
      </button>
      {stato.error && !inCorso && <p role="alert" className="text-[11px] text-str">{stato.error}</p>}
    </form>
  )
}
