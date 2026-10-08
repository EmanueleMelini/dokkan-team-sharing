'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { deleteAccountAction, type AccountState } from '@/lib/auth/actions'
import { handleMatches } from '@/lib/auth/account'

const bottone =
  'px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] border transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * La cancellazione dell'account: prima un bottone, poi il campo dove si
 * scrive il proprio handle. Il bottone finale resta spento finche'
 * l'handle non coincide; lo ricontrollano la Server Action e il database.
 */
export function DeleteAccount({ handle }: { handle: string }) {
  const [apre, setApre] = useState(false)
  const [scritto, setScritto] = useState('')
  const [stato, azione, inCorso] = useActionState<AccountState, FormData>(deleteAccountAction, {})
  const campo = useRef<HTMLInputElement>(null)
  const apri = useRef<HTMLButtonElement>(null)
  const primoGiro = useRef(true)
  const idCampo = useId()
  const idAiuto = useId()
  const giusto = handleMatches(scritto, handle)

  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (apre) campo.current?.focus()
    else apri.current?.focus()
  }, [apre])

  if (!apre) {
    return (
      <button
        ref={apri}
        type="button"
        onClick={() => setApre(true)}
        className={`${bottone} border-str bg-superficie text-str hover:bg-str hover:text-sfondo`}
      >
        Delete account
      </button>
    )
  }

  return (
    <form action={azione} className="space-y-3" aria-busy={inCorso}>
      <div>
        <label htmlFor={idCampo} className="block text-[12px] text-inchiostro">
          Type your handle <span className="font-semibold">{handle}</span> to confirm
        </label>
        <input
          ref={campo}
          id={idCampo}
          name="handle"
          type="text"
          value={scritto}
          onChange={(e) => setScritto(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby={idAiuto}
          aria-invalid={stato.error ? true : undefined}
          className="mt-1.5 w-full max-w-xs px-2.5 py-1.5 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro"
        />
        <p id={idAiuto} className="mt-1 text-[11px] text-tenue">This cannot be undone.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!giusto || inCorso}
          className={`${bottone} border-str bg-str text-sfondo hover:opacity-90`}
        >
          {inCorso ? 'Deleting…' : 'Delete my account'}
        </button>
        <button
          type="button"
          onClick={() => { setApre(false); setScritto('') }}
          className={`${bottone} border-linea bg-superficie text-testo hover:text-inchiostro`}
        >
          Cancel
        </button>
      </div>
      {stato.error && <p role="alert" className="text-[12px] text-str">{stato.error}</p>}
    </form>
  )
}
