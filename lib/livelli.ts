import type { StageRow } from '@/lib/queries'

// I nomi delle difficoltà come li scrive il gioco. Li usano la pagina
// dell'evento e il builder dei clear, che devono chiamarle allo stesso modo.
export const DIFFICOLTA: Record<string, string> = {
  normal: 'Normal', hard: 'Hard', z_hard: 'Z-Hard', super: 'Super', super2: 'Super 2',
  super3: 'Super 3', ultra: 'Ultra', dokkan: 'Dokkan', eza_level: 'Level',
}

/** "Level 30" per le EZA, "Stage 3 name, Super 2" per gli altri eventi. */
export function nomeTier(s: StageRow, eza: boolean): string {
  return eza
    ? `Level ${s.seq}`
    : `${s.name ?? `Stage ${s.seq}`}, ${DIFFICOLTA[s.difficulty] ?? s.difficulty}`
}
