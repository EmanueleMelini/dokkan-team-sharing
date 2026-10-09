'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { ReauthNotice } from '@/components/auth/reauth-notice'
import { useViewer } from '@/components/viewer/provider'
import { changeHandleAction, type HandleState } from '@/lib/auth/actions'
import { HANDLE, HANDLE_COOLDOWN_DAYS, soloMaiuscole } from '@/lib/auth/handle-change'

const bottone =
  'px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed'

type Props = {
  handle: string
  fresh: boolean
  /** da quando si puo' cambiare di nuovo ("November 7, 2026"), o null se si puo' gia' */
  nextChange: string | null
}

/**
 * Il cambio dell'handle in Settings: prima un bottone, poi il campo. Con
 * una sessione vecchia il campo non compare: prima si rientra, come per
 * scollegare un provider. Dopo un cambio riuscito fa rileggere /api/me,
 * cosi' l'header mostra subito il nome nuovo.
 */
export function ChangeHandle({ handle, fresh, nextChange }: Props) {
  const [stato, azione, inCorso] = useActionState<HandleState, FormData>(changeHandleAction, {})
  // Lo stato al momento dell'apertura: un risultato nuovo con changed
  // chiude il campo, un errore lo lascia aperto con il testo scritto.
  const [apertoDa, setApertoDa] = useState<HandleState | null>(null)
  const [scritto, setScritto] = useState(handle)
  const { reload } = useViewer()
  const campo = useRef<HTMLInputElement>(null)
  const apri = useRef<HTMLButtonElement>(null)
  const idCampo = useId()
  const idAiuto = useId()

  const aperto = apertoDa !== null && !(stato.changed && stato !== apertoDa)
  const valido = HANDLE.test(scritto.trim()) && scritto.trim() !== handle
  const inAttesa = nextChange !== null && scritto.trim() !== handle && !soloMaiuscole(handle, scritto.trim())

  // Il form sparisce col cambio riuscito: il fuoco torna al bottone, non
  // al body, e il messaggio role=status viene comunque letto.
  useEffect(() => {
    if (!stato.changed) return
    reload()
    apri.current?.focus()
  }, [stato, reload])

  useEffect(() => {
    if (aperto && fresh && !stato.reauth) campo.current?.focus()
  }, [aperto, fresh, stato.reauth])

  const chiudi = () => { setApertoDa(null); setScritto(handle) }

  return (
    <div className="space-y-3">
      {stato.changed && !aperto && (
        <p role="status" className="text-[12px] text-inchiostro bg-oro-tenue border border-oro-linea rounded-[var(--raggio)] px-3 py-2">
          Your handle is now <span className="font-semibold">{stato.changed}</span>. Links to your old handle
          keep working.
        </p>
      )}
      <p className="text-[12px] leading-relaxed text-tenue">
        3 to 24 letters, numbers or _. You can change it once every {HANDLE_COOLDOWN_DAYS} days; changing only
        capital letters is always allowed. Links to your old handle keep working, and nobody else can take it.
      </p>
      {nextChange && (
        <p className="text-[12px] text-testo">You can choose a new handle again on {nextChange}.</p>
      )}

      {!aperto ? (
        <button
          ref={apri}
          type="button"
          onClick={() => { setScritto(handle); setApertoDa(stato) }}
          className={`${bottone} border-campo bg-superficie text-inchiostro hover:bg-superficie-2`}
        >
          Change handle
        </button>
      ) : !fresh || stato.reauth ? (
        <ReauthNotice onCancel={chiudi} />
      ) : (
        <form action={azione} className="space-y-3" aria-busy={inCorso}>
          <div>
            <label htmlFor={idCampo} className="block text-[12px] text-inchiostro">New handle</label>
            <input
              ref={campo}
              id={idCampo}
              name="handle"
              type="text"
              value={scritto}
              onChange={(e) => setScritto(e.target.value)}
              maxLength={24}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={idAiuto}
              aria-invalid={stato.error && stato !== apertoDa ? true : undefined}
              className="mt-1.5 w-full max-w-xs px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro"
            />
            <p id={idAiuto} className="mt-1 text-[11px] text-tenue">
              {inAttesa ? `Only a change of capital letters is possible until ${nextChange}.` : `Your profile moves to /users/${scritto.trim() || handle}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!valido || inCorso}
              className={`${bottone} border-inchiostro bg-inchiostro text-sfondo hover:opacity-90`}
            >
              {inCorso ? 'Saving…' : 'Save handle'}
            </button>
            <button
              type="button"
              onClick={chiudi}
              className={`${bottone} border-linea bg-superficie text-testo hover:text-inchiostro`}
            >
              Cancel
            </button>
          </div>
          {stato.error && stato !== apertoDa && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
        </form>
      )}
    </div>
  )
}
