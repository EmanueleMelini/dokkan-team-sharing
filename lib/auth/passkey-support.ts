'use client'

import { useSyncExternalStore } from 'react'

const nessunCambio = () => () => {}

/**
 * Se il browser sa usare le passkey (WebAuthn). null sul server e al primo
 * render, dove i bottoni si mostrano come per tutti; poi false in un
 * browser senza WebAuthn (certi browser dentro le app), dove il bottone
 * non farebbe niente.
 */
export function usePasskeySupport(): boolean | null {
  return useSyncExternalStore(nessunCambio, () => typeof window.PublicKeyCredential === 'function', () => null)
}
