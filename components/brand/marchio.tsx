/*
 * Il marchio "Anello Ki": cinque settori, uno per tipo (AGL TEQ INT STR
 * PHY in senso orario dall'alto), e il disco oro del leader al centro.
 *
 * I colori sono FISSI e non seguono i token del tema: un tema colorato
 * potrebbe rendere due settori uguali, o un settore uguale allo sfondo.
 * Ci sono due varianti, per i fondi chiari e per quelli scuri, e la scelta
 * la fa solo il CSS: niente sessione, niente stato, quindi l'HTML del
 * server resta uguale per tutti (layout e pagine pubbliche in cache).
 *
 * La variante scura vale con un data-theme scuro su <html>, oppure con il
 * sistema scuro quando data-theme manca o e' "system". Un id sconosciuto
 * resta chiaro.
 *
 * I `d` e i colori vengono da scripts/brand/svg/: genera.mjs controlla che
 * coincidano con questi.
 */

const SETTORI = [
  'M40.86 3.34A30 30 0 0 1 61.76 28.23L47.47 24.94A17 17 0 0 0 33.81 15.1Z',
  'M62 31.57A30 30 0 0 1 44.78 59.14L43.49 44.53A17 17 0 0 0 48.63 28.5Z',
  'M41.68 60.39A30 30 0 0 1 10.14 52.55L23.63 46.8A17 17 0 0 0 40.47 46.74Z',
  'M7.99 49.98A30 30 0 0 1 5.7 17.56L15.34 28.62A17 17 0 0 0 20.6 44.61Z',
  'M7.48 14.72A30 30 0 0 1 37.61 2.53L30.07 15.11A17 17 0 0 0 16.48 25.06Z',
]

const SCURO =
  '--marchio-1:#6fa8e8;--marchio-2:#5fc79a;--marchio-3:#a98bdb;--marchio-4:#e8836f;--marchio-5:#e0a651;--marchio-0:#f8da5e'

// Gli id dei temi scuri: se ne arriva uno nuovo va aggiunto qui.
const TEMI_SCURI = ['dark', 'notte-agl', 'nebulosa-int', 'brace-str', 'lr-oro', 'oled']

const CSS =
  '.marchio{--marchio-1:#2f6fc4;--marchio-2:#2e7d5b;--marchio-3:#6b4b9e;--marchio-4:#b03a2e;--marchio-5:#a85414;--marchio-0:#7a5c00}' +
  `@media (prefers-color-scheme:dark){:root:not([data-theme]) .marchio,:root[data-theme=system] .marchio{${SCURO}}}` +
  `:root:is(${TEMI_SCURI.map((t) => `[data-theme=${t}]`).join(',')}) .marchio{${SCURO}}`

export function Marchio({ className = 'size-6' }: { className?: string }) {
  return (
    <>
      {/* React 19 sposta lo stile nell'<head> e lo mette una volta sola,
          anche con piu' marchi nella pagina. */}
      <style href="marchio" precedence="default">
        {CSS}
      </style>
      <svg
        viewBox="0 0 64 64"
        className={`marchio ${className}`}
        aria-hidden="true"
        focusable="false"
      >
        {SETTORI.map((d, i) => (
          <path key={i} d={d} style={{ fill: `var(--marchio-${i + 1})` }} />
        ))}
        <circle cx="32" cy="32" r="8" style={{ fill: 'var(--marchio-0)' }} />
      </svg>
    </>
  )
}
