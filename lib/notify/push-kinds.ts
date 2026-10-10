import type { NotificationKind } from '@/lib/notify/kinds'

// I gruppi delle push in Settings: un interruttore per riga, come le righe
// della lista delle notifiche sopra. Ogni gruppo accende o spegne tutti i
// suoi tipi insieme (notification_pref(kind, 'push'), 0028): la
// moderazione e' un argomento solo per chi la riceve, quattro caselle
// sarebbero rumore. Modulo puro: lo usano la pagina, l'isola e i test, che
// controllano che i gruppi coprano NOTIFICATION_KINDS una volta sola.

export type PushGroupId = 'comments' | 'moderation' | 'reports'

export type PushGroup = {
  id: PushGroupId
  label: string
  kinds: readonly NotificationKind[]
  /** solo per gli admin (reports_open, set_notification_pref lo rifiuta agli altri) */
  admin?: boolean
}

export const PUSH_GROUPS: readonly PushGroup[] = [
  { id: 'comments', label: 'Comments on your clears', kinds: ['clear_comment'] },
  {
    id: 'moderation',
    label: 'Moderation of your posts and account',
    kinds: ['content_hidden', 'content_unhidden', 'suspended', 'suspension_lifted'],
  },
  { id: 'reports', label: 'New reports', kinds: ['reports_open'], admin: true },
]

/**
 * I tipi che non stanno in nessun gruppo: la loro push segue un
 * interruttore suo. site_activity (0032) e' il feed degli admin, che
 * l'interruttore "All site activity" di Settings accende insieme nella
 * lista e sui dispositivi: non si accende mai da solo col primo "Turn on",
 * e non conta per decidere se quel clic e' il primo. I test controllano
 * che gruppi e tipi a parte coprano NOTIFICATION_KINDS una volta sola.
 */
export const PUSH_SEPARATE: readonly NotificationKind[] = ['site_activity']

export const pushGroup = (id: unknown): PushGroup | undefined => PUSH_GROUPS.find((g) => g.id === id)

/** I gruppi che questo utente vede. */
export const pushGroupsFor = (admin: boolean) => PUSH_GROUPS.filter((g) => !g.admin || admin)

/** Un gruppo e' acceso se tutti i suoi tipi lo sono (le righe le scrive solo l'interruttore). */
export const pushGroupsOn = (kindsOn: Iterable<string>, admin: boolean): PushGroupId[] => {
  const on = new Set(kindsOn)
  return pushGroupsFor(admin).filter((g) => g.kinds.every((k) => on.has(k))).map((g) => g.id)
}

/**
 * Il primo "Turn on for this device": nessun tipo dei gruppi e' acceso (i
 * tipi a parte non contano). Allora si accendono tutti i gruppi che
 * l'utente vede, e solo quelli.
 */
export const primaIscrizione = (kindsOn: Iterable<string>): boolean => {
  const aParte = new Set<string>(PUSH_SEPARATE)
  return [...kindsOn].every((k) => aParte.has(k))
}

/** I tipi che il primo "Turn on" accende: quelli dei gruppi visibili, mai un tipo a parte. */
export const kindsPrimaIscrizione = (admin: boolean): NotificationKind[] =>
  pushGroupsFor(admin).flatMap((g) => g.kinds).filter((k) => !PUSH_SEPARATE.includes(k))
