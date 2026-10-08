import Link from 'next/link'
import { utenteHref } from '@/components/moderation/coda-report'
import { dataOra } from '@/components/moderation/fine-sospensione'
import type { VoceRegistro } from '@/lib/moderation/queries'

// Le righe del registro (moderation_action), per /admin/log e per la
// scheda di un utente. Il registro non tiene il contenuto: solo id,
// handle e le note dei moderatori.

const AZIONE: Record<string, string> = {
  hide: 'Hid', unhide: 'Unhid', dismiss: 'Dismissed reports on', suspend: 'Suspended',
  unsuspend: 'Lifted the suspension of', set_role: 'Changed the role of',
}

const link = 'underline decoration-linea-forte underline-offset-2 hover:text-inchiostro'

/** 'infinity' o una data ISO, dal jsonb del dettaglio. */
function fine(v: unknown): string {
  if (v === 'infinity') return 'indefinitely'
  const d = typeof v === 'string' ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? `until ${dataOra(d)}` : ''
}

/** Il dettaglio di una riga come testo, o '' se non c'e' niente da dire. */
function dettaglio(v: VoceRegistro): string {
  const d = v.detail
  if (v.action === 'suspend') {
    const motivo = typeof d.reason === 'string' && d.reason ? `. Reason shown to the user: “${d.reason}”` : ''
    return `${fine(d.until)}${motivo}`
  }
  if (v.action === 'unsuspend') return fine(d.was_until) && `It ran ${fine(d.was_until)}`
  if (v.action === 'set_role') return `${String(d.from ?? '?')} to ${String(d.role ?? '?')}`
  return ''
}

function Bersaglio({ v }: { v: VoceRegistro }) {
  const chi = v.targetHandle
    ? <Link href={utenteHref(v.targetHandle)} prefetch={false} className={link}>{v.targetHandle}</Link>
    : 'a deleted account'
  if (v.targetKind === 'user') return chi
  const cosa = v.targetKind === 'clear' ? 'a clear' : v.targetKind === 'comment' ? 'a comment' : `a ${v.targetKind}`
  return (
    <>
      {cosa} by {chi}
      {v.posto && <> in <Link href={v.posto.href} prefetch={false} className={link}>{v.posto.eventName}, {v.posto.tier}</Link></>}
    </>
  )
}

export function Registro({ voci, vuoto = 'Nothing in the log yet.' }: { voci: VoceRegistro[]; vuoto?: string }) {
  if (voci.length === 0) {
    return <p className="border border-linea rounded-[var(--raggio)] bg-superficie px-4 py-4 text-[13px] text-tenue">{vuoto}</p>
  }
  return (
    <ol className="border border-linea rounded-[var(--raggio)] bg-superficie divide-y divide-linea">
      {voci.map((v) => (
        <li key={v.id} className="px-4 py-2.5 text-[13px] leading-relaxed">
          <p className="text-testo">
            <span className="font-medium text-inchiostro">{v.moderator ?? 'Script'}</span>{' '}
            {(AZIONE[v.action] ?? v.action).toLowerCase()} <Bersaglio v={v} />
            {v.reportsClosed > 0 && <span className="text-tenue"> · {v.reportsClosed} {v.reportsClosed === 1 ? 'report' : 'reports'} closed</span>}
          </p>
          <p className="text-[12px] text-tenue break-words">
            <time dateTime={v.at.toISOString()}>{dataOra(v.at)}</time>
            {dettaglio(v) && <> · {dettaglio(v)}</>}
            {v.note && <> · Note: <span className="text-testo whitespace-pre-line">{v.note}</span></>}
          </p>
        </li>
      ))}
    </ol>
  )
}
