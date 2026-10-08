'use client'

import { useEffect, useRef, useState } from 'react'
import { ReauthNotice } from '@/components/auth/reauth-notice'
import { authClient } from '@/lib/auth/client'

/**
 * Collega un altro provider all'account aperto. E' l'unico modo di
 * collegarne uno: il collegamento implicito per email e' spento.
 * Chiede una sessione fresca come scollegare: lo impone l'hook su
 * /link-social (config.ts); `fresh` serve solo a dirlo prima del giro.
 */
export function LinkProvider({ id, label, fresh }: { id: string; label: string; fresh: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reauth, setReauth] = useState(false)
  const bottone = useRef<HTMLButtonElement>(null)
  const primoGiro = useRef(true)

  // Annullato l'invito a rientrare, il focus torna al bottone.
  useEffect(() => {
    if (primoGiro.current) { primoGiro.current = false; return }
    if (!reauth) bottone.current?.focus()
  }, [reauth])

  async function link() {
    if (!fresh) { setReauth(true); return }
    setPending(true)
    setError(null)
    const res = await authClient.linkSocial({
      provider: id,
      callbackURL: '/settings?linked=' + encodeURIComponent(id),
      errorCallbackURL: '/settings',
    })
    if (res.error) {
      setPending(false)
      // La pagina era fresca quando si e' aperta, la sessione nel frattempo no.
      if (res.error.code === 'SESSION_NOT_FRESH') setReauth(true)
      else setError("Couldn't reach the provider. Please try again.")
    }
  }

  if (reauth) return <ReauthNotice className="w-full" onCancel={() => setReauth(false)} />

  return (
    <>
      <button
        ref={bottone}
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
