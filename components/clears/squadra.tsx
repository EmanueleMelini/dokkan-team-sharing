import { Carta } from '@/components/carta'

// La forma della squadra è quella del gioco: due unità che ruotano, altre
// due che ruotano, tre che restano fuori dalla rotazione.
export const GRUPPI: { rot: number; etichetta: string }[] = [
  { rot: 1, etichetta: 'Rotation 1' },
  { rot: 2, etichetta: 'Rotation 2' },
  { rot: 3, etichetta: 'Floaters' },
]

export type CartaSquadra = {
  rotation_index: number
  pos: number
  role: 'leader' | 'member' | 'friend'
  card_id: string
  // null se la carta non ha ancora un testo inglese: si mostra l'id
  name: string | null
  epithet: string | null
  type: string
  class: string | null
  thumb_key: string | null
}

/** Le sette carte di una squadra nei tre gruppi della rotazione. */
export function Squadra({ carte, idBase }: { carte: CartaSquadra[]; idBase: string }) {
  return (
    /*
     * minmax(0, …) e non 1fr: una traccia 1fr vale minmax(auto, 1fr), e
     * auto è la larghezza del nome più lungo. Con quella un nome lungo
     * allargava la colonna oltre la scheda e la pagina scorreva di lato.
     */
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
      {GRUPPI.map((g) => {
        const gruppo = carte.filter((c) => c.rotation_index === g.rot)
        if (!gruppo.length) return null
        const id = `${idBase}-r${g.rot}`
        // Un gruppo e non una section: con una section ogni clear
        // aggiungerebbe tre landmark con gli stessi tre nomi.
        return (
          <div key={g.rot} role="group" aria-labelledby={id} className="min-w-0">
            <h4 id={id} className="text-[11px] text-tenue mb-2">{g.etichetta}</h4>
            <ul className="space-y-2.5">
              {gruppo.map((c) => (
                <li key={`${c.rotation_index}-${c.pos}`}>
                  <Carta
                    name={c.name ?? `Card ${c.card_id}`}
                    epithet={c.epithet}
                    type={c.type}
                    class={c.class}
                    thumbKey={c.thumb_key}
                    ruolo={c.role}
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
