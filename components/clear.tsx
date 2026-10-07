import { ArrowSquareOut, Camera, Prohibit, ShieldCheck, VideoCamera } from '@phosphor-icons/react/dist/ssr'
import { Carta } from '@/components/carta'
import { soloGiorno } from '@/lib/date'
import type { ClearCard, ClearProof, ClearRow } from '@/lib/queries'

// La forma della squadra è quella del gioco: due unità che ruotano, altre
// due che ruotano, tre che restano fuori dalla rotazione.
const GRUPPI: { rot: number; etichetta: string }[] = [
  { rot: 1, etichetta: 'Rotation 1' },
  { rot: 2, etichetta: 'Rotation 2' },
  { rot: 3, etichetta: 'Floaters' },
]

function Segno({ icona, children }: { icona: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-testo px-1.5 py-0.5 rounded-[var(--raggio)] border border-linea bg-superficie-2">
      {icona}
      {children}
    </span>
  )
}

const PROVIDER: Record<string, string> = { youtube: 'YouTube', imgur: 'Imgur' }

/*
 * La prova è un link che ha incollato l'utente: si apre fuori dal sito, e
 * rel dice ai motori di ricerca che è contenuto degli utenti (ugc) e che
 * il sito non lo garantisce (nofollow). Gli URL javascript: li blocca già
 * un vincolo dello schema.
 */
function Prova({ prova }: { prova: ClearProof }) {
  const Icona = prova.kind === 'video' ? VideoCamera : Camera
  const dove = (prova.provider && PROVIDER[prova.provider]) ?? prova.provider
  return (
    <a
      href={prova.url}
      target="_blank"
      rel="ugc nofollow noopener noreferrer"
      className="inline-flex items-center gap-1 text-[12px] text-testo hover:text-inchiostro underline decoration-oro-linea underline-offset-2"
    >
      <Icona size={13} weight="bold" className="text-oro" aria-hidden />
      {prova.kind === 'video' ? 'Video' : 'Screenshot'}
      {dove && <span className="text-tenue">on {dove}</span>}
      <ArrowSquareOut size={11} weight="bold" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

export function Clear({ clear }: { clear: ClearRow }) {
  const perRotazione = (rot: number): ClearCard[] => clear.cards.filter((c) => c.rotation_index === rot)
  const titolo = `clear-${clear.id}`

  return (
    <article aria-labelledby={titolo} className="border border-linea rounded-[var(--raggio)] bg-superficie p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h3 id={titolo} className="text-[13px] font-medium text-inchiostro">{clear.handle}</h3>
          {clear.has_proof && (
            <Segno icona={<Camera size={12} weight="bold" className="text-oro" aria-hidden />}>Proof</Segno>
          )}
          {clear.no_items && <Segno icona={<Prohibit size={12} weight="bold" aria-hidden />}>No items</Segno>}
          {clear.deathless && <Segno icona={<ShieldCheck size={12} weight="bold" aria-hidden />}>No KOs</Segno>}
        </div>
        <dl className="flex items-baseline gap-4 text-[11px] text-tenue">
          {clear.turns != null && (
            <div className="flex items-baseline gap-1">
              <dt>Turns</dt>
              <dd className="numeri text-[13px] text-inchiostro">{clear.turns}</dd>
            </div>
          )}
          <div className="flex items-baseline gap-1">
            <dt>Votes</dt>
            <dd className="numeri text-[13px] text-inchiostro">{clear.score}</dd>
          </div>
        </dl>
      </header>

      {/*
       * minmax(0, …) e non 1fr: una traccia 1fr vale minmax(auto, 1fr), e
       * auto è la larghezza del nome più lungo. Con quella un nome lungo
       * allargava la colonna oltre la scheda e la pagina scorreva di lato.
       */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        {GRUPPI.map((g) => {
          const carte = perRotazione(g.rot)
          if (!carte.length) return null
          const id = `${titolo}-r${g.rot}`
          // Un gruppo e non una section: con una section ogni clear
          // aggiungerebbe tre landmark con gli stessi tre nomi.
          return (
            <div key={g.rot} role="group" aria-labelledby={id} className="min-w-0">
              <h4 id={id} className="text-[11px] text-tenue mb-2">{g.etichetta}</h4>
              <ul className="space-y-2.5">
                {carte.map((c) => (
                  <li key={`${c.rotation_index}-${c.pos}`}>
                    <Carta
                      name={c.name}
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

      {clear.note && (
        <p lang={clear.note_lang ?? undefined} className="mt-4 text-[13px] leading-relaxed text-testo max-w-[70ch]">
          {clear.note}
        </p>
      )}

      {clear.proofs.length > 0 && (
        <ul aria-label="Proof" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {clear.proofs.map((p) => (
            <li key={p.url}>
              <Prova prova={p} />
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 text-[11px] text-tenue">
        <time dateTime={clear.created_at.toISOString()}>{soloGiorno(clear.created_at)}</time>
        {clear.versions > 1 && (
          <span className="ml-3">
            Revised {clear.versions - 1} time{clear.versions - 1 === 1 ? '' : 's'}, lifetime votes{' '}
            <span className="numeri">{clear.lifetime_score}</span>
          </span>
        )}
      </footer>
    </article>
  )
}
