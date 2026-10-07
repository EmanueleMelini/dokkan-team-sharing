import { Trophy } from '@phosphor-icons/react/dist/ssr'

/*
 * Il numero di clear accanto al trofeo. A schermo basta l'icona; per chi
 * usa un lettore di schermo l'icona non dice niente, e un "4" accanto a
 * "Super" si leggerebbe "Super 4". Il testo nascosto lo rende "Super, 4 clears".
 */
export function ConteggioClear({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`numeri inline-flex items-center gap-0.5 ${className}`}>
      <span className="sr-only">, </span>
      <Trophy size={11} weight="fill" aria-hidden />
      {n}
      <span className="sr-only">{n === 1 ? ' clear' : ' clears'}</span>
    </span>
  )
}
