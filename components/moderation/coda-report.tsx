import Link from 'next/link'
import { AzioniReport } from '@/components/moderation/azioni-report'
import { soloGiorno } from '@/lib/date'
import { REASON_LABELS, type ReportReason } from '@/lib/moderation/reasons'
import type { GruppoReport } from '@/lib/moderation/queries'
import { adminUserHref } from '@/lib/urls'

// La coda delle segnalazioni: una riga per bersaglio. Server component;
// i bottoni sono l'isola AzioniReport. Ogni testo che arriva dagli utenti
// (nota del clear, commento, spiegazioni) resta testo React, mai un href.

const etichetta = (r: string) => REASON_LABELS[r as ReportReason] ?? r

export const utenteHref = adminUserHref

function Badge({ children, tono = 'neutro' }: { children: React.ReactNode; tono?: 'neutro' | 'allarme' }) {
  const c = tono === 'allarme' ? 'border-str text-str' : 'border-linea-forte text-tenue'
  return <span className={`px-1 py-px text-[11px] rounded-[var(--raggio)] border ${c}`}>{children}</span>
}

/** Cosa e' stato segnalato, in poche righe. */
function Bersaglio({ g }: { g: GruppoReport }) {
  if (g.kind === 'comment' && g.comment) {
    return (
      <>
        <p className="text-[11px] text-tenue">
          Comment{g.posto && <> on a clear in <Link href={g.posto.href} prefetch={false} className="underline decoration-linea-forte underline-offset-2 hover:text-inchiostro">{g.posto.eventName}, {g.posto.tier}</Link></>}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-testo whitespace-pre-line break-words line-clamp-6">{g.comment.body}</p>
        <p className="mt-1 flex flex-wrap gap-1.5">
          {g.clear?.status !== 'published' && <Badge tono="allarme">Its clear is hidden</Badge>}
          {!g.comment.onCurrent && <Badge>On an older version</Badge>}
        </p>
      </>
    )
  }
  if (g.kind === 'clear' && g.clear) {
    return (
      <>
        <p className="text-[11px] text-tenue">Clear</p>
        {g.posto && (
          <p className="text-[13px] text-inchiostro">
            <Link href={g.posto.href} prefetch={false} className="underline decoration-linea-forte underline-offset-2 hover:decoration-oro">
              {g.posto.eventName}, {g.posto.tier}
            </Link>
            {g.posto.reg === 'japan' && <span className="ml-1.5 text-[11px] text-tenue">Japan</span>}
          </p>
        )}
        {g.clear.note && <p className="mt-1 text-[13px] leading-relaxed text-testo whitespace-pre-line break-words line-clamp-4">{g.clear.note}</p>}
      </>
    )
  }
  if (g.kind === 'tip' && g.tip) {
    return (
      <>
        <p className="text-[11px] text-tenue">
          Tip{g.posto && <> in <Link href={g.posto.href} prefetch={false} className="underline decoration-linea-forte underline-offset-2 hover:text-inchiostro">{g.posto.eventName}, {g.posto.tier}</Link></>}
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-testo whitespace-pre-line break-words line-clamp-6">{g.tip.body}</p>
        {/* il link come testo, mai come href: lo vede solo chi modera, e decide se aprirlo */}
        {g.tip.link && <p className="mt-1 text-[12px] text-tenue break-all">Link: {g.tip.link}</p>}
      </>
    )
  }
  return <p className="text-[13px] text-tenue">This {g.kind} no longer exists.</p>
}

export function CodaReport({ gruppi }: { gruppi: GruppoReport[] }) {
  return (
    <ol className="border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
      {gruppi.map((g) => {
        const nascosto = g.kind === 'comment' ? g.comment?.status !== 'published'
          : g.kind === 'tip' ? g.tip?.status !== 'published' : g.clear?.status !== 'published'
        const esiste = g.kind === 'comment' ? !!g.comment : g.kind === 'clear' ? !!g.clear : g.kind === 'tip' ? !!g.tip : false
        return (
          <li key={`${g.kind}:${g.targetId}`} className="px-4 py-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="min-w-0">
              <Bersaglio g={g} />
              <p className="mt-2 text-[12px] text-tenue">
                {g.author ? (
                  <>
                    By <Link href={utenteHref(g.author.handle)} prefetch={false} className="font-medium text-inchiostro underline decoration-linea-forte underline-offset-2">{g.author.handle}</Link>
                    {g.author.suspended && <span className="ml-1.5"><Badge tono="allarme">Suspended</Badge></span>}
                  </>
                ) : 'Author unknown'}
              </p>
              {g.details.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-l-2 border-linea pl-3">
                  {g.details.map((d, i) => (
                    <li key={i} className="text-[12px] leading-relaxed">
                      <span className="text-tenue">{d.handle}, {etichetta(d.reason)}:</span>{' '}
                      <span className="text-testo whitespace-pre-line break-words">{d.details}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-[13px] text-inchiostro">
                <span className="numeri font-semibold">{g.n}</span> {g.n === 1 ? 'open report' : 'open reports'}
              </p>
              <ul className="text-[12px] text-testo space-y-0.5">
                {Object.entries(g.reasons).map(([r, n]) => (
                  <li key={r}><span className="numeri">{n}</span> {etichetta(r)}</li>
                ))}
              </ul>
              <p className="text-[11px] text-tenue">
                First <time dateTime={g.firstAt.toISOString()}>{soloGiorno(g.firstAt)}</time>
                {g.n > 1 && <>, last <time dateTime={g.lastAt.toISOString()}>{soloGiorno(g.lastAt)}</time></>}
              </p>
              <AzioniReport kind={g.kind} targetId={g.targetId} n={g.n} canHide={esiste && !nascosto} />
              {g.author && (
                <Link href={utenteHref(g.author.handle)} prefetch={false} className="inline-block text-[12px] text-tenue underline decoration-linea-forte underline-offset-2 hover:text-inchiostro">
                  View user
                </Link>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
