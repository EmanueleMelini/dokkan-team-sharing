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
 * Le variabili --marchio-N stanno in app/globals.css, sotto .marchio e
 * .colori-marchio: le stesse per i segnaposto delle carte senza miniatura
 * (components/segnaposto.tsx), con la stessa variante chiara o scura. La
 * scura vale con un data-theme scuro su <html>, oppure con il sistema
 * scuro quando data-theme manca o e' "system". Un id sconosciuto resta
 * chiaro. Stanno li' e non in uno <style> qui: ogni segnaposto ne metteva
 * una copia nel payload delle pagine.
 *
 * I `d` vengono da scripts/brand/svg/, come i colori di globals.css:
 * genera.mjs controlla che coincidano.
 */

const SETTORI = [
  'M40.86 3.34A30 30 0 0 1 61.76 28.23L47.47 24.94A17 17 0 0 0 33.81 15.1Z',
  'M62 31.57A30 30 0 0 1 44.78 59.14L43.49 44.53A17 17 0 0 0 48.63 28.5Z',
  'M41.68 60.39A30 30 0 0 1 10.14 52.55L23.63 46.8A17 17 0 0 0 40.47 46.74Z',
  'M7.99 49.98A30 30 0 0 1 5.7 17.56L15.34 28.62A17 17 0 0 0 20.6 44.61Z',
  'M7.48 14.72A30 30 0 0 1 37.61 2.53L30.07 15.11A17 17 0 0 0 16.48 25.06Z',
]

export function Marchio({ className = 'size-6' }: { className?: string }) {
  return (
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
  )
}
