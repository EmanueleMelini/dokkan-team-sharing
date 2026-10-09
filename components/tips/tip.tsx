'use client'

import { useState } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr'
import type { TipRow } from '@/lib/tips'
import { soloGiorno } from '@/lib/date'
import { PROVIDER_LABELS, hostDi } from '@/lib/tips/validate'
import { reportTip } from '@/lib/tips/actions'
import { Segnala } from '@/components/moderation/segnala'
import { useViewer, useViewerTier } from '@/components/viewer/provider'
import { canWrite } from '@/lib/viewer/types'
import { TipVoto } from '@/components/tips/tip-voto'
import { TipForm } from '@/components/tips/tip-form'
import { TipElimina } from '@/components/tips/tip-elimina'
import { HandleLink } from '@/components/handle-link'

/**
 * Una tip. Il testo e' testo React (niente markdown, niente HTML); il
 * link porta fuori con rel="ugc nofollow": e' di un utente, non nostro.
 * Cosa si puo' fare lo dice /api/me: sulla propria Edit e Delete, sulle
 * altre Helpful e Report. Finche' non risponde, la versione anonima.
 */
export function Tip({ tip }: { tip: TipRow }) {
  const { mode, user } = useViewer()
  const tier = useViewerTier()
  const [modifica, setModifica] = useState(false)
  const mia = tier?.ownTips?.includes(tip.id) ?? false
  const scrive = canWrite(user)
  const host = tip.linkUrl ? hostDi(tip.linkUrl) : null
  const fonte = (tip.linkProvider && PROVIDER_LABELS[tip.linkProvider]) || host

  return (
    <article id={`tip-${tip.id}`} className="py-3 scroll-mt-6">
      {modifica && mia ? (
        <TipForm
          modo="edit"
          tipId={tip.id}
          body={tip.body}
          link={tip.linkUrl}
          onDone={() => setModifica(false)}
          onCancel={() => setModifica(false)}
        />
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-testo whitespace-pre-line break-words">{tip.body}</p>
          {tip.linkUrl && fonte && (
            <p className="mt-1 text-[12px]">
              <a
                href={tip.linkUrl}
                target="_blank"
                rel="ugc nofollow noopener noreferrer"
                className="inline-flex items-center gap-1 text-testo underline decoration-oro-linea underline-offset-2 hover:text-inchiostro break-all"
              >
                {fonte}
                <ArrowSquareOut size={11} weight="bold" aria-hidden />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          )}
        </>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-tenue">
        <TipVoto tipId={tip.id} score={tip.score} />
        <HandleLink handle={tip.handle} className="font-medium text-inchiostro" />
        <time dateTime={tip.createdAt.toISOString()}>{soloGiorno(tip.createdAt)}</time>
        {tip.editedAt && (
          <span
            title={`Edited ${soloGiorno(tip.editedAt)}`}
            className="px-1 py-px rounded-[var(--raggio)] border border-linea-forte text-tenue"
          >
            edited
          </span>
        )}
        {mia && mode === 'ready' && !modifica && (
          <>
            {/* chi e' sospeso non modifica, ma cancella (come i clear) */}
            {scrive && (
              <button
                type="button"
                onClick={() => setModifica(true)}
                className="px-2 py-0.5 text-[12px] rounded-[var(--raggio)] border border-linea bg-superficie text-testo hover:text-inchiostro hover:border-linea-forte transition-colors active:scale-[0.98]"
              >
                Edit
              </button>
            )}
            <TipElimina tipId={tip.id} />
          </>
        )}
        {!mia && scrive && tier && <Segnala kind="tip" target={tip.id} azione={reportTip} />}
      </div>
    </article>
  )
}
