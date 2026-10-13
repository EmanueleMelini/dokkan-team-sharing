'use client'

import { LIMITS, type ProofKind } from '@/lib/clears/validate'
import type { Azione, ProvaStato } from '@/lib/clears/builder-stato'
import { OPZIONI_PROVA } from '@/lib/clears/builder-opzioni'
import { Scelta } from '@/components/scelta/scelta'
import { BOTTONE_DITO, CAMPO_DITO } from '@/components/scelta/stile'

// col dito alti quanto il menu Kind accanto (CAMPO_DITO, BOTTONE_DITO)
const campo = `block w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro ${CAMPO_DITO}`

/** Fino a tre link di prova, ognuno screenshot o video. */
export function Prove({ prove, dispatch }: { prove: ProvaStato[]; dispatch: (a: Azione) => void }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold text-inchiostro">Proof</legend>
      <p id="b-prove-aiuto" className="mt-0.5 text-[12px] text-tenue">
        Optional, and clears with proof are shown first. Full https:// links, no link shorteners.
      </p>
      {prove.length > 0 && (
        <ol className="mt-2 space-y-2">
          {prove.map((p, i) => (
            <li key={i} className="grid gap-2 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-end">
              <div>
                <label htmlFor={`b-prova-${i}-kind`} className="block text-[11px] text-tenue">Kind</label>
                <Scelta
                  id={`b-prova-${i}-kind`}
                  etichetta="Kind"
                  opzioni={OPZIONI_PROVA}
                  valore={p.kind}
                  // arriva solo dalle opzioni: video o screenshot
                  onCambia={(v) => dispatch({ t: 'prova', i, kind: v as ProofKind })}
                  className="mt-1"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`b-prova-${i}-url`} className="block text-[11px] text-tenue">Link {i + 1}</label>
                <input
                  id={`b-prova-${i}-url`}
                  type="url"
                  inputMode="url"
                  value={p.url}
                  maxLength={LIMITS.proofUrl}
                  onChange={(e) => dispatch({ t: 'prova', i, url: e.target.value })}
                  aria-describedby="b-prove-aiuto"
                  placeholder="https://"
                  className={`${campo} mt-1 placeholder:text-tenue`}
                />
              </div>
              <button
                type="button"
                onClick={() => dispatch({ t: 'togli_prova', i })}
                className={`px-2 py-1.5 text-[12px] ${BOTTONE_DITO} rounded-[var(--raggio)] border border-linea bg-superficie text-testo hover:text-str`}
              >
                Remove<span className="sr-only"> link {i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {prove.length < LIMITS.proofs && (
        <button
          type="button"
          onClick={() => dispatch({ t: 'aggiungi_prova' })}
          className="mt-2 px-3 py-1.5 text-[12px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:border-linea-forte"
        >
          Add a proof link
        </button>
      )}
    </fieldset>
  )
}
