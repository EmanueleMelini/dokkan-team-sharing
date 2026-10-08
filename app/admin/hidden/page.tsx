import Link from 'next/link'
import { notFound } from 'next/navigation'
import { utenteHref } from '@/components/moderation/coda-report'
import { Ripristina } from '@/components/moderation/ripristina'
import { Paginazione } from '@/components/paginazione'
import { soloGiorno } from '@/lib/date'
import { metadataAdmin, requireAdmin } from '@/lib/moderation/guard'
import { pagina } from '@/lib/moderation/pagina'
import { listHidden, PER_PAGINA } from '@/lib/moderation/queries'

export const generateMetadata = () => metadataAdmin('Hidden')

// Per utente, come le altre pagine admin (vedi app/admin/page.tsx).
export const instant = false

const link = 'underline decoration-linea-forte underline-offset-2 hover:text-inchiostro'

const NOMI = { clear: 'Clears', comment: 'Comments', tip: 'Tips' } as const

export default async function NascostiPage({ searchParams }: PageProps<'/admin/hidden'>) {
  await requireAdmin()
  const sp = await searchParams
  const kind = sp.kind === 'comment' || sp.kind === 'tip' ? sp.kind : sp.kind === undefined || sp.kind === 'clear' ? 'clear' : null
  const page = pagina(sp.page)
  if (!kind || page === null) notFound()
  const { righe, totale } = await listHidden(kind, page)
  const ultima = Math.max(1, Math.ceil(totale / PER_PAGINA))
  const href = (k: string, n = 1) => {
    const p = new URLSearchParams({ ...(k !== 'clear' ? { kind: k } : {}), ...(n > 1 ? { page: String(n) } : {}) })
    const s = p.toString()
    return s ? `/admin/hidden?${s}` : '/admin/hidden'
  }

  return (
    <section aria-labelledby="nascosti">
      <h2 id="nascosti" className="text-[13px] font-semibold text-inchiostro">
        Hidden {NOMI[kind].toLowerCase()} <span className="numeri font-normal text-tenue">{totale}</span>
      </h2>
      <div className="mt-2 flex gap-2 text-[12px]" role="group" aria-label="Kind">
        {(['clear', 'comment', 'tip'] as const).map((k) => (
          <Link key={k} href={href(k)} prefetch={false} aria-current={k === kind ? 'page' : undefined}
            className={`px-2 py-1 rounded-[var(--raggio)] border transition-colors ${
              k === kind ? 'border-inchiostro bg-inchiostro text-sfondo' : 'border-linea bg-superficie text-testo hover:border-linea-forte'
            }`}>
            {NOMI[k]}
          </Link>
        ))}
      </div>

      {righe.length === 0 ? (
        <p className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-6 text-[13px] text-tenue">
          No hidden {NOMI[kind].toLowerCase()}.
        </p>
      ) : (
        <ul className="mt-3 border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
          {righe.map((r) => (
            <li key={r.id} className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[12px] text-tenue">
                  {r.posto ? <Link href={r.posto.href} prefetch={false} className={link}>{r.posto.eventName}, {r.posto.tier}</Link> : 'Event unknown'}
                  {r.kind === 'comment' && r.clearStatus !== 'published' && <span className="ml-1.5 text-str">(its clear is hidden too)</span>}
                </p>
                {r.text && <p className="mt-1 text-[13px] leading-relaxed text-testo whitespace-pre-line break-words line-clamp-4">{r.text}</p>}
                <p className="mt-1 text-[11px] text-tenue">
                  By {r.author ? <Link href={utenteHref(r.author)} prefetch={false} className={link}>{r.author}</Link> : 'a deleted account'}
                  {r.hiddenAt && <> · hidden <time dateTime={r.hiddenAt.toISOString()}>{soloGiorno(r.hiddenAt)}</time>{r.hiddenBy && <> by {r.hiddenBy}</>}</>}
                </p>
              </div>
              <div className="shrink-0"><Ripristina kind={r.kind} id={r.id} /></div>
            </li>
          ))}
        </ul>
      )}
      <Paginazione pagina={page} ultima={ultima} href={(n) => href(kind, n)} etichetta="Hidden pages" />
    </section>
  )
}
