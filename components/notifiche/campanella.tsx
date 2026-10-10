'use client'

import Link from 'next/link'
import { Bell } from '@phosphor-icons/react/dist/ssr'
import { NOTIFICATIONS_PATH } from '@/lib/notify/kinds'

/**
 * Il link a /notifications nell'header, con un pallino quando c'e'
 * qualcosa di nuovo. Solo un pallino, mai un numero: viene da user.unread
 * di /api/me, che lo legge dalla sessione senza query in piu'. Lo rende
 * UserMenu solo dopo /api/me, quindi non e' mai nell'HTML in cache.
 *
 * prefetch={false}: aprire la lista segna lette le notifiche, e un
 * prefetch lo farebbe senza che l'utente l'abbia vista.
 */
export function Campanella({ unread, className }: { unread: boolean; className?: string }) {
  return (
    <Link
      href={NOTIFICATIONS_PATH}
      prefetch={false}
      aria-label={unread ? 'Notifications, new' : 'Notifications'}
      className={`inline-flex items-center justify-center ${className ?? ''}`}
    >
      {/* Il pallino sta sull'icona, anche quando il link e' piu' grande (il bersaglio sul telefono) */}
      <span className="relative inline-flex">
        <Bell size={16} weight="bold" aria-hidden />
        {unread && (
          <span
            aria-hidden="true"
            data-pallino=""
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-oro ring-2 ring-sfondo"
          />
        )}
      </span>
    </Link>
  )
}
