'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth/client'

/**
 * Collega un altro provider all'account aperto. E' l'unico modo di
 * collegarne uno: il collegamento implicito per email e' spento.
 */
export function LinkProvider({ id, label }: { id: string; label: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function link() {
    setPending(true)
    setError(null)
    const res = await authClient.linkSocial({
      provider: id,
      callbackURL: '/settings?linked=' + encodeURIComponent(id),
      errorCallbackURL: '/settings',
    })
    if (res.error) {
      setPending(false)
      setError("Couldn't reach the provider. Please try again.")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={link}
        disabled={pending}
        className="px-2.5 py-1 text-[12px] font-medium rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro hover:bg-superficie-2 transition-colors disabled:opacity-60"
      >
        {pending ? 'Opening…' : `Link ${label}`}
      </button>
      {error && <span role="alert" className="ml-2 text-[12px] text-str">{error}</span>}
    </>
  )
}
