// La geometria del marchio "Anello Ki": cinque settori di anello, uno per
// tipo, con i bordi inclinati come una girandola, e un disco al centro.
//
// I tagli tra i settori hanno i lati paralleli (larghezza costante), non a
// spicchio: con un taglio ad angolo fisso lo spazio si stringe verso il
// centro e a 16px i settori si toccano. Cosi' la larghezza che si sceglie e'
// quella che si vede in ogni punto del taglio.

const arrotonda = (n) => Number(n.toFixed(2))

// Angolo 0 in alto, crescente in senso orario (in SVG la y va in giu').
const versore = (gradi) => {
  const t = ((gradi - 90) * Math.PI) / 180
  return [Math.cos(t), Math.sin(t)]
}

/**
 * Il punto in cui il bordo k, spostato di `s` lungo la sua normale, incontra
 * il cerchio di raggio `rho`. Il bordo va dal cerchio interno all'angolo
 * `theta` a quello esterno all'angolo `theta + inclinazione`.
 */
function incrocio({ c, R, r, inclinazione }, theta, s, rho) {
  const [ux, uy] = versore(theta)
  const [vx, vy] = versore(theta + inclinazione)
  const p = [c + r * ux, c + r * uy]
  const q = [c + R * vx, c + R * vy]
  const lung = Math.hypot(q[0] - p[0], q[1] - p[1])
  const d = [(q[0] - p[0]) / lung, (q[1] - p[1]) / lung]
  // La normale che punta verso gli angoli crescenti (il settore successivo).
  let n = [-d[1], d[0]]
  const [tx, ty] = versore(theta + 90)
  if (n[0] * tx + n[1] * ty < 0) n = [-n[0], -n[1]]
  const o = [p[0] + s * n[0] - c, p[1] + s * n[1] - c]
  const b = o[0] * d[0] + o[1] * d[1]
  const disc = b * b - (o[0] * o[0] + o[1] * o[1]) + rho * rho
  if (disc < 0) throw new Error('Taglio troppo largo per questo anello.')
  // Il bordo parte dal cerchio interno e va verso l'esterno: su entrambi i
  // cerchi il punto giusto e' la radice maggiore (l'altra sta dietro).
  const t = -b + Math.sqrt(disc)
  return [c + o[0] + t * d[0], c + o[1] + t * d[1]].map(arrotonda)
}

/** I cinque `d` dei settori, in senso orario dall'alto: AGL TEQ INT STR PHY. */
export function settori(g) {
  const { R, r, taglio } = g
  const out = []
  for (let i = 0; i < 5; i++) {
    const a = i * 72
    const b = (i + 1) * 72
    const e0 = incrocio(g, a, taglio / 2, R)
    const e1 = incrocio(g, b, -taglio / 2, R)
    const i1 = incrocio(g, b, -taglio / 2, r)
    const i0 = incrocio(g, a, taglio / 2, r)
    out.push(`M${e0.join(' ')}A${R} ${R} 0 0 1 ${e1.join(' ')}L${i1.join(' ')}A${r} ${r} 0 0 0 ${i0.join(' ')}Z`)
  }
  return out
}
