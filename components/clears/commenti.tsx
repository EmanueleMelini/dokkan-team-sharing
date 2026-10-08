import Link from 'next/link'
import { ChatCircle } from '@phosphor-icons/react/dist/ssr'
import { CommentoForm } from '@/components/clears/commento-form'
import { soloGiorno } from '@/lib/date'
import type { ClearComment } from '@/lib/clears'

type Props = {
  versionId: string
  idBase: string
  commenti: ClearComment[]
  /** quanti sono in tutto: la lista ne porta al massimo 100 */
  totale: number
  modo: 'ready' | 'own' | 'anon' | 'setup'
  /** dove porta "Sign in" o "Finish setup" per chi non può ancora scrivere */
  accesso: string
}

/**
 * I commenti della versione corrente, chiusi di default: la lista dei
 * clear resta corta da scorrere. <details> si apre da tastiera senza JS
 * e resta aperto quando l'azione rinfresca la pagina.
 */
export function Commenti({ versionId, idBase, commenti, totale, modo, accesso }: Props) {
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
                  <span className="font-medium text-inchiostro">{m.handle}</span>
                  {m.by_author && (
                    <span className="ml-1.5 px-1 py-px rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue text-oro">Author</span>
                  )}
                  <time dateTime={m.created_at.toISOString()} className="ml-2">{soloGiorno(m.created_at)}</time>
                </p>
                <p lang={m.lang ?? undefined} className="mt-0.5 text-[13px] leading-relaxed text-testo whitespace-pre-line break-words">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
        )}
        {modo === 'ready' || modo === 'own' ? (
          <CommentoForm versionId={versionId} idBase={idBase} />
        ) : (
          <p className="mt-2 text-[12px] text-tenue">
            <Link href={accesso} className="text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
              {modo === 'setup' ? 'Finish setting up your account' : 'Sign in'}
            </Link>{' '}
            to comment.
          </p>
        )}
      </div>
    </details>
  )
}
