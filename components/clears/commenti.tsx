import { ChatCircle } from '@phosphor-icons/react/dist/ssr'
import { CommentoSpazio } from '@/components/clears/commento-spazio'
import { SegnalaCommento } from '@/components/moderation/segnala-isole'
import { HandleLink } from '@/components/handle-link'
import { soloGiorno } from '@/lib/date'
import type { ClearComment } from '@/lib/clears'

type Props = {
  versionId: string
  idBase: string
  commenti: ClearComment[]
  /** quanti sono in tutto: la lista ne porta al massimo 100 */
  totale: number
  /** la pagina a cui tornare dopo l'accesso, per chi non può ancora scrivere */
  ritorno: string
}

/**
 * I commenti della versione corrente, chiusi di default: la lista dei
 * clear resta corta da scorrere. <details> si apre da tastiera senza JS
 * e resta aperto quando l'azione rinfresca la pagina.
 */
export function Commenti({ versionId, idBase, commenti, totale, ritorno }: Props) {
  const n = Math.max(totale, commenti.length)
  return (
    <details className="mt-3 group">
      <summary className="inline-flex items-center gap-1.5 text-[12px] text-testo hover:text-inchiostro cursor-pointer select-none">
        <ChatCircle size={13} weight="bold" aria-hidden className="text-tenue" />
        {n === 0 ? 'Comments' : `${n} ${n === 1 ? 'comment' : 'comments'}`}
      </summary>
      <div className="mt-2 border-t border-linea pt-2">
        {n === 0 ? (
          <p className="text-[12px] text-tenue">No comments on this version yet.</p>
        ) : (
          <ol className="divide-y divide-linea">
            {commenti.map((m) => (
              <li key={m.id} className="py-2">
                <p className="text-[11px] text-tenue">
                  <HandleLink handle={m.handle} className="font-medium text-inchiostro" />
                  {m.by_author && (
                    <span className="ml-1.5 px-1 py-px rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue text-oro">Author</span>
                  )}
                  <time dateTime={m.created_at.toISOString()} className="ml-2">{soloGiorno(m.created_at)}</time>
                </p>
                <p lang={m.lang ?? undefined} className="mt-0.5 text-[13px] leading-relaxed text-testo whitespace-pre-line break-words">
                  {m.body}
                </p>
                {/* Report sui commenti degli altri: quali sono i propri lo dice /api/me (tier.ownComments) */}
                <div className="mt-1 flex flex-wrap empty:hidden">
                  <SegnalaCommento commentId={m.id} />
                </div>
              </li>
            ))}
          </ol>
        )}
        {/* chi guarda lo sa solo il browser (/api/me): un'isola client */}
        <CommentoSpazio versionId={versionId} idBase={idBase} ritorno={ritorno} />
      </div>
    </details>
  )
}
