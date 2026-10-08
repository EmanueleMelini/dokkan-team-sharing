import { Squadra } from '@/components/clears/squadra'
import type { VersionLineup } from '@/lib/clears'

/**
 * I cambi di squadra a metà evento, sotto la squadra di partenza. Ognuno
 * ha un nome scelto dall'autore ("From phase 3") e una nota opzionale.
 */
export function Cambi({ cambi, idBase }: { cambi: VersionLineup[]; idBase: string }) {
  if (!cambi.length) return null
  return (
    <ol aria-label="Team changes" className="mt-4 space-y-4">
      {cambi.map((l) => {
        const id = `${idBase}-l${l.seq}`
        return (
          <li key={l.seq} className="border-t border-linea pt-3">
            <h4 id={id} className="text-[12px] font-medium text-inchiostro">
              <span className="text-tenue font-normal">Change {l.seq - 1}: </span>
              {l.label ?? `Team ${l.seq}`}
            </h4>
            {l.note && (
              <p className="mt-1 text-[12px] leading-relaxed text-testo max-w-[70ch] whitespace-pre-line">{l.note}</p>
            )}
            <div className="mt-2.5">
              <Squadra carte={l.cards} idBase={id} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}
