'use client'

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Export, X } from '@phosphor-icons/react/dist/ssr'
import { Marchio } from '@/components/brand/marchio'
import {
  chiudiInvito, installa, iscriviInstalla, leggiContesto, leggiStato, type Contesto, type StatoInstalla,
} from '@/lib/pwa/installa'
import { rottaSenzaInvito } from '@/lib/pwa/piattaforma'

const nessunCambio = () => () => {}

/**
 * L'invito a installare l'app, in fondo allo schermo. Solo sui telefoni e
 * sui tablet, mai nell'app gia' installata, mai dopo la X (localStorage,
 * lib/pwa/installa.ts). Su Chromium compare solo dopo beforeinstallprompt,
 * con un bottone Install; su Safari per iOS spiega i due tocchi, perche'
 * li' non c'e' un prompt da chiamare.
 *
 * E' un'isola: sul server e all'idratazione non rende niente, quindi
 * l'HTML delle pagine resta uguale per tutti (e in cache).
 */
export function InvitoInstalla() {
  const pathname = usePathname()
  const contesto = useSyncExternalStore<Contesto | null>(nessunCambio, leggiContesto, () => null)
  const stato = useSyncExternalStore<StatoInstalla | null>(iscriviInstalla, leggiStato, () => null)

  if (!contesto || !stato || rottaSenzaInvito(pathname)) return null
  if (!contesto.mobile || contesto.standalone || stato.chiuso || stato.installata) return null
  const android = stato.pronto
  if (!android && !contesto.iosSafari) return null

  return (
    <>
      {/* Lo spazio sotto il footer: il banner e' fisso e altrimenti
          coprirebbe l'ultima riga della pagina. */}
      <div aria-hidden="true" className="h-24 shrink-0" />
      <section
        aria-label="Install the app"
        className="fixed inset-x-0 bottom-0 z-40 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
      >
        <div className="pointer-events-auto mx-auto max-w-md flex items-center gap-3 border border-linea rounded-[var(--raggio)] bg-superficie pl-3 pr-1.5 py-2.5 shadow-lg">
          <Marchio className="size-8 shrink-0" />
          {android ? (
            <p className="flex-1 min-w-0 text-[13px] leading-snug text-testo">
              <span className="font-medium text-inchiostro">Install Dokkan Team Sharing</span> for quick access from your home screen.
            </p>
          ) : (
            <p className="flex-1 min-w-0 text-[13px] leading-snug text-testo">
              <span className="font-medium text-inchiostro">Install Dokkan Team Sharing:</span> tap Share{' '}
              <Export size={15} weight="bold" aria-hidden className="inline-block align-[-2px] text-inchiostro" />
              , then Add to Home Screen.
            </p>
          )}
          {android && (
            <button
              type="button"
              onClick={() => void installa()}
              className="shrink-0 px-3 py-1.5 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity"
            >
              Install
            </button>
          )}
          <button
            type="button"
            onClick={chiudiInvito}
            aria-label="Close and don't show again"
            className="inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-[var(--raggio)] text-tenue hover:text-inchiostro"
          >
            <X size={16} weight="bold" aria-hidden />
          </button>
        </div>
      </section>
    </>
  )
}
