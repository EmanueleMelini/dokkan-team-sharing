'use client'

import { useActionState, useOptimistic, useState } from 'react'
import { ArrowFatDown, ArrowFatUp } from '@phosphor-icons/react/dist/ssr'
import { voteClear, type ClearActionState } from '@/lib/clears/actions'
import { useViewer, useViewerTier } from '@/components/viewer/provider'

type Voto = -1 | 1 | null

type Props = {
  versionId: string
  clearId: string
  /** il punteggio della copia in cache: /api/me porta quello vivo */
  score: number
}

const bottone =
  'inline-flex items-center justify-center w-7 h-7 rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

/**
 * Su e giù sulla versione corrente. La pagina in cache e' quella anonima:
 * il voto di chi guarda e il punteggio vivo arrivano da /api/me
 * (useViewerTier). Il punteggio cambia subito (useOptimistic) e poi resta
 * quello che restituisce l'azione: il voto non rigenera la pagina (costa
 * CPU a ogni clic), quindi le props non cambiano.
 */
export function VotoClear({ versionId, clearId, score: inCache }: Props) {
  const { mode, user } = useViewer()
  const tier = useViewerTier()
  // legato alla versione: dopo una revisione il voto riparte da zero
  const [confermato, setConfermato] = useState<{ v: string; score: number; vote: Voto } | null>(null)
  const base = (confermato?.v === versionId ? confermato : null) ?? { score: tier?.scores[versionId] ?? inCache, vote: tier?.votes[versionId] ?? null }
  const [ottimista, applica] = useOptimistic(
    base,
    (cur, nuovo: -1 | 0 | 1) => ({
      vote: nuovo === 0 ? null : nuovo,
      score: cur.score - (cur.vote ?? 0) + nuovo,
    }),
  )
  const [stato, azione, inCorso] = useActionState<ClearActionState, FormData>(async (prev, form) => {
    const nuovo = Number(form.get('value')) as -1 | 0 | 1
    applica(nuovo)
    const r = await voteClear(prev, form)
    if (r.ok && r.score !== undefined) setConfermato({ v: versionId, score: r.score, vote: nuovo === 0 ? null : nuovo })
    return r
  }, {})

  // Sul proprio clear, da anonimi, da sospesi e finche' /api/me non risponde: solo il punteggio
  if (mode !== 'ready' || user?.suspended || tier?.own.includes(clearId)) {
    return (
      <div className="flex items-baseline gap-1 text-[11px] text-tenue">
        <span>Votes</span>
        <span className="numeri text-[13px] text-inchiostro">{base.score}</span>
      </div>
    )
  }

  const su = ottimista.vote === 1
  const giu = ottimista.vote === -1
  return (
    <form action={azione} aria-busy={inCorso} className="flex flex-col items-end gap-1">
      <input type="hidden" name="version" value={versionId} />
      <div role="group" aria-label="Vote on this clear" className="flex items-center gap-1.5">
        <button
          type="submit"
          name="value"
          value={su ? 0 : 1}
          aria-pressed={su}
          aria-label="Upvote"
          className={`${bottone} ${su ? 'bg-oro-tenue border-oro text-oro' : 'bg-superficie border-campo text-testo hover:text-inchiostro'}`}
        >
          <ArrowFatUp size={14} weight={su ? 'fill' : 'bold'} aria-hidden />
        </button>
        <span className="numeri min-w-[2ch] text-center text-[13px] text-inchiostro">
          <span className="sr-only">Score </span>
          {ottimista.score}
        </span>
        <button
          type="submit"
          name="value"
          value={giu ? 0 : -1}
          aria-pressed={giu}
          aria-label="Downvote"
          className={`${bottone} ${giu ? 'bg-superficie-2 border-inchiostro text-inchiostro' : 'bg-superficie border-campo text-testo hover:text-inchiostro'}`}
        >
          <ArrowFatDown size={14} weight={giu ? 'fill' : 'bold'} aria-hidden />
        </button>
      </div>
      {/* Il punteggio nuovo e gli errori si annunciano: il focus resta sul bottone */}
      <p aria-live="polite" className="sr-only">
        {!inCorso && stato.ok ? `Score ${base.score}` : ''}
      </p>
      {stato.error && !inCorso && (
        <p role="alert" className="text-[11px] text-str max-w-[24ch] text-right">{stato.error}</p>
      )}
    </form>
  )
}
