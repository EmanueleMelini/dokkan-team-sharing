import { useSyncExternalStore } from 'react'
import { TEMA_KEY, TEMI, coloreBarra, isTemaId, type TemaId } from '@/lib/tema/temi'

// Il tema nel browser: lo stato vero e' l'attributo data-theme di <html>
// (lo mette lo script del <head> prima del primo paint), localStorage lo
// ricorda. Solo per le isole client: sul server non c'e' niente da leggere.

const ascoltatori = new Set<() => void>()
const avvisa = () => ascoltatori.forEach((f) => f())

/** Il tema applicato ora; senza attributo e' System. */
export function temaAttuale(): TemaId {
  const v = document.documentElement.getAttribute('data-theme')
  return isTemaId(v) ? v : 'system'
}

/** Quello salvato su questo dispositivo; senza (o illeggibile) e' System. */
export function temaLocale(): TemaId {
  try {
    const v = localStorage.getItem(TEMA_KEY)
    return isTemaId(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Applica il tema subito (attributo e theme-color, come lo script del
 * <head>) e lo ricorda su questo dispositivo. System toglie entrambi: i
 * colori tornano a seguire il sistema operativo.
 */
export function applicaTema(id: TemaId) {
  const root = document.documentElement
  if (id === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', id)
  document.head.querySelectorAll('meta[name="theme-color"][data-tema]').forEach((m) => m.remove())
  const sfondo = TEMI.find((t) => t.id === id)?.sfondo
  if (sfondo) {
    const m = document.createElement('meta')
    m.name = 'theme-color'
    m.content = coloreBarra(sfondo)
    m.setAttribute('data-tema', '')
    document.head.insertBefore(m, document.head.firstChild)
  }
  try {
    if (id === 'system') localStorage.removeItem(TEMA_KEY)
    else localStorage.setItem(TEMA_KEY, id)
  } catch {
    // senza localStorage il tema vale per questa pagina, e sull'account se c'e'
  }
  avvisa()
}

// Un cambio in un'altra scheda arriva come evento storage: anche questa si
// adegua, cosi' due schede aperte non restano con due temi diversi.
function daAltraScheda(e: StorageEvent) {
  if (e.key !== TEMA_KEY && e.key !== null) return
  const id = temaLocale()
  if (id !== temaAttuale()) applicaTema(id)
}

function iscrivi(f: () => void) {
  if (ascoltatori.size === 0) window.addEventListener('storage', daAltraScheda)
  ascoltatori.add(f)
  return () => {
    ascoltatori.delete(f)
    if (ascoltatori.size === 0) window.removeEventListener('storage', daAltraScheda)
  }
}

/**
 * Il tema applicato, per i selettori. Sul server e durante l'idratazione
 * e' null (sconosciuto): l'HTML resta uguale per tutti, e il valore vero
 * arriva al render dopo.
 */
export const useTema = (): TemaId | null => useSyncExternalStore(iscrivi, temaAttuale, () => null)
