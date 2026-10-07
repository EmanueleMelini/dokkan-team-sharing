/*
 * Il tipo e la classe di una carta.
 *
 * I cinque colori sono codifica SEMANTICA, non l'accento della pagina:
 * in Dokkan il tipo è il dato con cui si scorre tutto, e un giocatore lo
 * riconosce dal colore prima di leggere le lettere. L'accento della
 * pagina resta uno solo ed è l'oro (Color Consistency Lock).
 */
const COLORE: Record<string, string> = {
  AGL: 'text-agl', TEQ: 'text-teq', INT: 'text-int', STR: 'text-str', PHY: 'text-phy',
}

export function Tipo({ tipo, classe }: { tipo: string; classe?: string | null }) {
  return (
    <span className={`numeri text-[11px] font-semibold tracking-wide ${COLORE[tipo] ?? 'text-tenue'}`}>
      {classe ? `${classe === 'Super' ? 'S' : 'E'}${tipo}` : tipo}
    </span>
  )
}
