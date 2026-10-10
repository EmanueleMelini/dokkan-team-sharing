import type { Icon } from '@phosphor-icons/react'
import { ChatCircle, Eye, EyeSlash, Flag, Prohibit, Pulse, ShieldCheck } from '@phosphor-icons/react/dist/ssr'
import type { NotificationRow } from '@/lib/notify/kinds'
import { notificationLink, notificationText } from '@/lib/notify/vista'

const ICONE: Record<string, Icon> = {
  clear_comment: ChatCircle,
  content_hidden: EyeSlash,
  content_unhidden: Eye,
  suspended: Prohibit,
  suspension_lifted: ShieldCheck,
  reports_open: Flag,
  site_activity: Pulse,
}

const quando = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})

/**
 * Una notifica della lista. Il link e' un <a> semplice verso
 * /notifications/<id>, non un <Link>: quella rotta segna letta e
 * reindirizza, e un prefetch o una navigazione RSC la farebbero passare
 * per un'altra cosa. Il clic carica la pagina di arrivo per intero.
 */
export function RigaNotifica({ n, nuova }: { n: NotificationRow; nuova: boolean }) {
  const { title, detail } = notificationText(n)
  const Icona = ICONE[n.kind] ?? Flag
  const iso = n.updated_at.toISOString()
  const ora = `${quando.format(n.updated_at)} UTC`
  return (
    <li>
      <a
        href={notificationLink(n.id)}
        className="flex items-start gap-3 px-4 py-3 hover:bg-superficie-2 transition-colors"
      >
        <Icona size={16} weight="bold" aria-hidden className={`mt-0.5 shrink-0 ${nuova ? 'text-oro' : 'text-tenue'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] ${nuova ? 'font-medium text-inchiostro' : 'text-testo'}`}>
            {title}
          </span>
          {detail && <span className="mt-0.5 block text-[12px] leading-relaxed text-tenue break-words">{detail}</span>}
          {/* sul telefono l'ora va sotto: a destra ruberebbe meta' della riga */}
          <time dateTime={iso} className="mt-1 block text-[11px] text-tenue numeri sm:hidden">{ora}</time>
        </span>
        <time dateTime={iso} className="hidden sm:block shrink-0 text-[11px] text-tenue numeri">{ora}</time>
      </a>
    </li>
  )
}
