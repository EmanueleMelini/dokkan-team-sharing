import {
  cookieVersione, gemello, isVersione, type CookieVersione, type Versione,
} from '@/lib/versione/versione'

// Il cambio di versione dell'interruttore, senza Next: setVersionAction
// (lib/auth/actions.ts) gli passa la sessione, il verbo SQL, l'invalidazione
// e il cookie della risposta, e fa il redirect che questo decide. Cosi' i
// test lo provano con il database vero e senza next/headers.

export type UtenteVersione = { id: string; handle: string; onboarded: boolean } | null

export type DipendenzeVersione = {
  utente: UtenteVersione
  /** set_region (0035): true se l'account e' cambiato. Lancia gli errori di Postgres. */
  salva: (userId: string, v: Versione) => Promise<boolean>
  /** il profilo pubblico mostra "Plays Global/Japan" */
  invalida: (handle: string) => void
  /** il Set-Cookie della risposta */
  scrivi: (c: CookieVersione) => void
  /** se l'errore di salva e' "utente inesistente o senza onboarding" */
  utenteSparito: (e: unknown) => boolean
}

export type EsitoVersione =
  | { error: string }
  | { saved: 'account' | 'device'; vai: string | null }

/**
 * Valida la scelta, la salva sull'account se ha finito l'onboarding (anche
 * da sospeso: e' una preferenza), scrive il cookie (japan, o lo toglie per
 * Global) e dice dove andare: il gemello della pagina da cui si parte, o
 * null se la pagina e' la stessa per le due versioni.
 *
 * L'ordine conta. Prima l'account, poi il cookie: Next mette il Set-Cookie
 * nella risposta appena lo si scrive, e lo tiene anche nel 500 di
 * un'azione che lancia; con l'account rimasto com'era, il dispositivo
 * cambierebbe lo stesso dietro "Couldn't change the version". E il cookie
 * prima del redirect, perche' il redirect di un'azione prende la pagina nuova
 * con i cookie della risposta. La destinazione e' gia' quella della
 * versione nuova (marcata per Japan, senza cookie per Global): nessun URL
 * che il routing rimanderebbe altrove.
 */
export async function cambiaVersione(
  v: unknown, qui: unknown, baseURL: string, d: DipendenzeVersione,
): Promise<EsitoVersione> {
  if (!isVersione(v)) return { error: 'Choose Global or Japan.' }
  let saved: 'account' | 'device' = 'device'
  if (d.utente?.onboarded) {
    try {
      if (await d.salva(d.utente.id, v)) d.invalida(d.utente.handle)
      saved = 'account'
    } catch (e) {
      // l'account e' appena stato cancellato: la scelta resta sul dispositivo
      if (!d.utenteSparito(e)) throw e
    }
  }
  d.scrivi(cookieVersione(v, baseURL))
  return { saved, vai: gemello(qui, v) }
}
