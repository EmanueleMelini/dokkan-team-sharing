'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth/client'

type Provider = { id: string; label: string }

/**
 * Un bottone per provider attivo. better-auth crea state e PKCE e
 * risponde con l'URL del provider; il browser ci va da solo.
 * callbackURL passa sempre da /welcome, che rimanda subito a next chi ha
 * gia' scelto l'handle: cosi' nessuno salta la prima entrata. Gli errori
 * tornano a `errorPath` (/login, o /settings/sign-in per chi rientra).
 */
export function ProviderButtons({ providers, next, errorPath = '/login' }: {
  providers: Provider[]
  next: string
  errorPath?: string
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (providers.length === 0) return null

  async function start(id: string) {
    setPending(id)
    setError(null)
    const res = await authClient.signIn.social({
      provider: id,
      callbackURL: `/welcome?next=${encodeURIComponent(next)}`,
      errorCallbackURL: `${errorPath}?next=${encodeURIComponent(next)}`,
    })
    // Se tutto va bene la pagina e' gia' altrove; qui si resta solo per un errore.
    if (res.error) {
      setPending(null)
      setError(res.error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : "Couldn't reach the provider. Please try again.")
    }
  }

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => start(p.id)}
          disabled={pending !== null}
          className="w-full px-3 py-2 text-[13px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-60"
        >
          {pending === p.id ? `Opening ${p.label}…` : `Continue with ${p.label}`}
        </button>
      ))}
      {error && <p role="alert" className="text-[12px] text-str">{error}</p>}
    </div>
  )
}
