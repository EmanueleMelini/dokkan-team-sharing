// La sequenza dell'import, per la produzione: la stessa di npm run db:import,
// dalle cache locali (db/import/.cache), con in piu' le righe in asset.
//
// fetch-assets --offline sta dopo il datamine e PRIMA degli eventi del
// gioco e delle missioni, non in fondo come in db:refresh: load-game-events
// sceglie le copertine preferendo le carte con miniatura, e load-missions
// aggancia le icone ai premi per nome di reward_item. Su un database nuovo,
// con le immagini in fondo, il primo giro uscirebbe diverso dal secondo.
//
// Niente fixture, niente demo, niente reset: solo dati di gioco.
export const PIPELINE = [
  ['db/import/load-cards.mjs', []],
  ['db/import/load-game-cards.mjs', []],
  ['db/import/load-events.mjs', []],
  ['db/import/load-datamine.mjs', []],
  ['db/import/fetch-assets.mjs', ['--offline']],
  ['db/import/load-game-events.mjs', []],
  ['db/import/load-windows.mjs', []],
  ['db/import/load-missions.mjs', []],
  ['db/import/load-equipment.mjs', []],
]

export const stepNames = (list) => list.map(([s, a]) => [s.split('/').pop().replace(/\.mjs$/, ''), ...a].join(' '))
