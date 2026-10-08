import { GRADI, type SlotBuild } from '@/lib/clears/build'

/**
 * La build di una carta in un clear, sotto la carta: piccola e solo se
 * c'e'. Il nome delle sfere esclusive e' lungo e uguale per cento carte:
 * una riga ciascuna, troncata, con il nome intero al passaggio.
 */
export function BuildRiga({ build }: { build: SlotBuild }) {
  const testa = [
    build.hp_routes != null ? (build.hp_routes === 4 ? 'Rainbow HiPo' : `HiPo ${build.hp_routes}/4 routes`) : null,
    build.hp_path,
  ].filter(Boolean).join(' · ')
  return (
    // allineata al nome, dopo la miniatura da 48px e lo spazio di Carta
    <div className="mt-1 ml-[3.625rem] text-[11px] leading-snug text-tenue min-w-0">
      <span className="sr-only">Build: </span>
      {testa && <p className="text-testo">{testa}</p>}
      {build.equipment.length > 0 && (
        <ul aria-label="Skill Orbs">
          {build.equipment.map((e) => (
            <li key={e.slot} className="truncate" title={e.name ?? undefined}>
              <span className="text-testo">{GRADI[e.tier] ?? 'Orb'}</span> {e.name ?? `Skill Orb ${e.id}`}
            </li>
          ))}
        </ul>
      )}
      {build.note && <p className="whitespace-pre-line break-words">{build.note}</p>}
    </div>
  )
}
