import Image from 'next/image'
import Link from 'next/link'
import { Camera, Prohibit, ShieldCheck } from '@phosphor-icons/react/dist/ssr'
import { assetUrl } from '@/lib/db'
import { CorniceCarta, SegnapostoCarta } from '@/components/segnaposto'
import { soloGiorno } from '@/lib/date'
import { DIFFICOLTA } from '@/lib/livelli'
import { clearAnchor, eventHref } from '@/lib/urls'
import type { ProfileClear } from '@/lib/profiles'

/** "Stage name, Super 2", o "Level 30" per gli EZA: come la pagina dell'evento. */
function dove(c: ProfileClear): string {
  if (c.difficulty === 'eza_level') return `Level ${c.stage_seq}`
  return `${c.stage_name ?? `Stage ${c.stage_seq}`}, ${DIFFICOLTA[c.difficulty] ?? c.difficulty}`
}

const chip = 'inline-flex items-center gap-1 text-[11px] text-testo px-1.5 py-0.5 rounded-[var(--raggio)] border border-linea bg-superficie-2'

/**
 * Un clear nella lista del profilo, compatto: evento, stage, la squadra di
 * partenza in miniatura, i segni e il punteggio. Il link porta alla pagina
 * del tier dove la lista dell'evento mostra il clear, e al clear stesso.
 * Senza prefetch: venti righe per pagina.
 */
export function RigaClear({ c }: { c: ProfileClear }) {
  const href = eventHref({ id: c.event_id, reg: c.reg, tier: c.tier_id, page: c.page }) + clearAnchor(c.id)
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <Link
          href={href}
          prefetch={false}
          className="min-w-0 text-[13px] font-medium text-inchiostro underline-offset-2 decoration-oro-linea hover:underline"
        >
          {c.event_name}
        </Link>
        <time dateTime={c.created_at.toISOString()} className="text-[11px] text-tenue">{soloGiorno(c.created_at)}</time>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-tenue">
        <span>{dove(c)}</span>
        {c.reg === 'japan' && <span className={chip}>Japan</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {c.cards.length > 0 && (
          <ul aria-label="Starting team" className="flex flex-wrap gap-1">
            {c.cards.map((k) => {
              const src = assetUrl(k.thumb_key)
              const nome = k.name ?? `Card ${k.card_id}`
              return (
                <li key={`${k.rot}-${k.pos}`}>
                  {src && k.thumb_bare ? (
                    // il solo personaggio: la cornice disegnata, l'alt resta all'immagine
                    <CorniceCarta type={k.type} size={32}>
                      <Image src={src} alt={nome} title={nome} width={32} height={32} className="rounded-[var(--raggio)] bg-superficie-2" />
                    </CorniceCarta>
                  ) : src ? (
                    <Image src={src} alt={nome} title={nome} width={32} height={32} className="rounded-[var(--raggio)] bg-superficie-2" />
                  ) : (
                    // qui il riquadro e' l'unica cosa che dice la carta: porta il nome
                    <SegnapostoCarta name={k.name} type={k.type} size={32} etichetta={nome} />
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-tenue">
          {c.has_proof && <span className={chip}><Camera size={12} weight="bold" className="text-oro" aria-hidden />Proof</span>}
          {c.no_items && <span className={chip}><Prohibit size={12} weight="bold" aria-hidden />No items</span>}
          {c.deathless && <span className={chip}><ShieldCheck size={12} weight="bold" aria-hidden />No KOs</span>}
          {c.turns != null && <span>Turns <span className="numeri text-inchiostro">{c.turns}</span></span>}
          <span>
            <span className="numeri text-inchiostro">{c.score}</span> {Math.abs(c.score) === 1 ? 'vote' : 'votes'}
          </span>
          {c.versions > 1 && <span className="px-1 py-px rounded-[var(--raggio)] border border-linea-forte">Revised</span>}
        </div>
      </div>
    </li>
  )
}
