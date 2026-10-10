import type { Metadata } from 'next'
import Link from 'next/link'
import { RigaNotifica } from '@/components/notifiche/riga'
import { SegnaViste } from '@/components/notifiche/segna-viste'
import { requireOnboardedUser } from '@/lib/dal'
import { LEGALE } from '@/lib/legale'
import { NOTIFICATIONS_PATH, type NotificationRow } from '@/lib/notify/kinds'
import { LIST_LIMIT, listNotifications, markListRead } from '@/lib/notify/queries'

export const metadata: Metadata = { title: 'Notifications', robots: { index: false } }

// Per utente, come /settings: legge la sessione in cima, fuori da ogni
// <Suspense>, e instant = false la toglie dalla verifica dello shell
// statico, cosi' il redirect a /login resta un 307 vero. Nessuna pagina
// pubblica cambia: il pallino arriva da /api/me nelle isole client.
export const instant = false

/**
 * nuove: tutta la sezione e' nuova (New), o lo dice ogni riga (il feed
 * degli admin). nota: una riga sotto la lista.
 */
function Sezione({ id, titolo, righe, nuove, nota }: {
  id: string
  titolo: string
  righe: NotificationRow[]
  nuove: boolean | ((n: NotificationRow) => boolean)
  nota?: string | null
}) {
  if (righe.length === 0) return null
  return (
    <section className="mt-8 max-w-2xl" aria-labelledby={id}>
      <h2 id={id} className="text-[13px] font-semibold text-inchiostro">
        {titolo} <span className="numeri font-normal text-tenue">{righe.length}</span>
      </h2>
      <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea overflow-hidden">
        {righe.map((n) => <RigaNotifica key={n.id} n={n} nuova={typeof nuove === 'function' ? nuove(n) : nuove} />)}
      </ul>
      {nota && <p className="mt-2 text-[12px] leading-relaxed text-tenue">{nota}</p>}
    </section>
  )
}

/** Le azioni del feed segnate lette senza essere mostrate (mark_list_read): mai in silenzio. */
const nonMostrate = (n: number) =>
  n <= 0 ? null : `${n === 1 ? '1 older action' : `${n} older actions`} did not fit in this list and ${n === 1 ? 'was' : 'were'} marked as read.`

export default async function NotificationsPage() {
  const user = await requireOnboardedUser(NOTIFICATIONS_PATH)
  const righe = await listNotifications(user.id, LIST_LIMIT)

  // Aprire la lista segna lette le non lette che ha appena letto, anche
  // quelle che non si mostrano piu' (un clear nascosto dopo), e quelle
  // oltre le LIST_LIMIT di ogni famiglia (mark_list_read, 0032): l'utente
  // non le potrebbe aprire, e terrebbero acceso il pallino per sempre.
  // Quante azioni del feed sono finite cosi' lo dice la sezione Site
  // activity. New ed Earlier si dividono con lo stato di prima della lettura.
  const nonLette = righe.filter((n) => n.read_at === null)
  const { unread, unseenActions } = await markListRead(user.id, nonLette.map((n) => n.id))

  // Il feed degli admin (site_activity, 0032) in una sezione sua, sotto:
  // le notifiche personali restano in New ed Earlier come prima. Nel feed
  // le non lette sono in grassetto.
  const visibili = righe.filter((n) => n.visible)
  const personali = visibili.filter((n) => n.kind !== 'site_activity')
  const attivita = visibili.filter((n) => n.kind === 'site_activity')
  const nuove = personali.filter((n) => n.read_at === null)
  const prima = personali.filter((n) => n.read_at !== null)
  const admin = user.role === 'admin'

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <SegnaViste unread={unread} />
      <h1 className="text-2xl font-semibold tracking-tight text-inchiostro">Notifications</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-testo">
        Comments on your clears and moderator actions on your posts
        {admin ? ', plus new reports to review, and site activity if you turned it on' : ''}.{' '}
        {admin ? `The latest ${LIST_LIMIT} of each are shown.` : `The latest ${LIST_LIMIT} are shown.`}
      </p>

      {visibili.length === 0 ? (
        <p className="mt-8 max-w-2xl border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-6 text-[13px] text-tenue">
          Nothing yet. When someone comments on one of your clears, it shows up here.
        </p>
      ) : (
        <>
          <Sezione id="new" titolo="New" righe={nuove} nuove />
          <Sezione id="earlier" titolo="Earlier" righe={prima} nuove={false} />
          <Sezione id="site-activity" titolo="Site activity" righe={attivita} nuove={(n) => n.read_at === null}
            nota={nonMostrate(unseenActions)} />
        </>
      )}

      <p className="mt-8 max-w-2xl text-[12px] leading-relaxed text-tenue">
        Read notifications are deleted after {LEGALE.giorniNotificheLette} days, unread ones after{' '}
        {LEGALE.giorniNotificheNonLette} days.{' '}
        <Link href="/settings#notifications" prefetch={false} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
          Notification settings
        </Link>
      </p>
    </div>
  )
}
