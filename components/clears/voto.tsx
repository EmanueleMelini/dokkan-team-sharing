'use client'

import { useActionState, useOptimistic } from 'react'
import { ArrowFatDown, ArrowFatUp } from '@phosphor-icons/react/dist/ssr'
import { voteClear, type ClearActionState } from '@/lib/clears/actions'

type Voto = -1 | 1 | null

type Props = {
  versionId: string
  score: number
  vote: Voto
  /** ready: può votare; own: è il suo clear; anon/setup: solo il punteggio */
  modo: 'ready' | 'own' | 'anon' | 'setup'
}

const bottone =
  'inline-flex items-center justify-center w-7 h-7 rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-60'

/**
 * Su e giù sulla versione corrente. Il punteggio cambia subito
 * (useOptimistic) e poi arriva quello vero: l'azione rivalida la pagina,
 * che torna con il punteggio e il voto letti dal database.
 */
export function VotoClear({ versionId, score, vote, modo }: Props) {
  const [ottimista, applica] = useOptimistic(
    { score, vote },
    (cur, nuovo: -1 | 0 | 1) => ({
      vote: nuovo === 0 ? null : nuovo,
      score: cur.score - (cur.vote ?? 0) + nuovo,
    }),
  )
  const [stato, azione, inCorso] = useActionState<ClearActionState, FormData>(async (prev, form) => {
    applica(Number(form.get('value')) as -1 | 0 | 1)
    return voteClear(prev, form)
  }, {})

  if (modo !== 'ready') {
    return (
      <div className="flex items-baseline gap-1 text-[11px] text-tenue">
        <span>Votes</span>
        <span className="numeri text-[13px] text-inchiostro">{score}</span>
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
        {!inCorso && stato.ok ? `Score ${score}` : ''}
      </p>
      {stato.error && !inCorso && (
        <p role="alert" className="text-[11px] text-str max-w-[24ch] text-right">{stato.error}</p>
      )}
    </form>
  )
}
