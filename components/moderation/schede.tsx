'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SCHEDE = [
  { href: '/admin', label: 'Reports' },
  { href: '/admin/hidden', label: 'Hidden' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/log', label: 'Log' },
] as const

/** Le schede dell'area admin. Client solo per sapere quale e' aperta. */
export function SchedeAdmin() {
  const path = usePathname()
  const attiva = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`))
  return (
    <nav aria-label="Moderation" className="mt-4 -mx-5 px-5 overflow-x-auto border-b border-linea">
      <ul className="flex gap-5 text-[13px]">
        {SCHEDE.map((s) => {
          const on = attiva(s.href)
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                prefetch={false}
                aria-current={on ? 'page' : undefined}
                className={`inline-block py-2 border-b-2 -mb-px transition-colors ${
                  on ? 'border-oro text-inchiostro font-medium' : 'border-transparent text-tenue hover:text-inchiostro'
                }`}
              >
                {s.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
