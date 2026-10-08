import Link from 'next/link'
import { ArrowSquareOut, Camera, Prohibit, ShieldCheck, VideoCamera } from '@phosphor-icons/react/dist/ssr'
import { Squadra } from '@/components/clears/squadra'
import { Cambi } from '@/components/clears/cambi'
import { Commenti } from '@/components/clears/commenti'
import { EliminaClear } from '@/components/clears/elimina'
import { VotoClear } from '@/components/clears/voto'
import { soloGiorno } from '@/lib/date'
import type { ClearComment, VersionLineup } from '@/lib/clears'
import type { Spettatore } from '@/lib/clears/vista'
import type { ClearProof, ClearRow } from '@/lib/queries'

type Props = {
  clear: ClearRow
  eventId: string
  spettatore: Spettatore
  cambi: VersionLineup[]
  commenti: ClearComment[]
}

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

export function Clear({ clear, eventId, spettatore, cambi, commenti }: Props) {
  const titolo = `clear-${clear.id}`
  const revisioni = clear.versions - 1

  return (
    <article aria-labelledby={titolo} className="border border-linea rounded-[var(--raggio)] bg-superficie p-4">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h3 id={titolo} className="scroll-mt-6 text-[13px] font-medium text-inchiostro">{clear.handle}</h3>
          {clear.has_proof && (
            <Segno icona={<Camera size={12} weight="bold" className="text-oro" aria-hidden />}>Proof</Segno>
          )}
          {clear.no_items && <Segno icona={<Prohibit size={12} weight="bold" aria-hidden />}>No items</Segno>}
          {clear.deathless && <Segno icona={<ShieldCheck size={12} weight="bold" aria-hidden />}>No KOs</Segno>}
        </div>
        <div className="flex items-start gap-4">
          {clear.turns != null && (
            <dl className="flex items-baseline gap-1 text-[11px] text-tenue pt-1">
              <dt>Turns</dt>
              <dd className="numeri text-[13px] text-inchiostro">{clear.turns}</dd>
            </dl>
          )}
          <VotoClear versionId={clear.version_id} score={clear.score} vote={spettatore.vote} modo={spettatore.modo} />
        </div>
      </header>

      <div className="mt-4">
        <Squadra carte={clear.cards} idBase={titolo} />
      </div>
      <Cambi cambi={cambi} idBase={titolo} />

      {clear.note && (
        <p lang={clear.note_lang ?? undefined} className="mt-4 text-[13px] leading-relaxed text-testo max-w-[70ch] whitespace-pre-line">
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

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-tenue">
        <p>
          <time dateTime={clear.created_at.toISOString()}>{soloGiorno(clear.created_at)}</time>
          {revisioni > 0 && (
            <span className="ml-3">
              Revised {revisioni} time{revisioni === 1 ? '' : 's'}, lifetime votes{' '}
              <span className="numeri">{clear.lifetime_score}</span>
            </span>
          )}
        </p>
        {spettatore.modo === 'own' && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/events/${eventId}/clears/${clear.id}/edit`}
              className="px-2 py-1 text-[12px] rounded-[var(--raggio)] border border-linea bg-superficie text-testo hover:text-inchiostro hover:border-linea-forte transition-colors"
            >
              Edit<span className="sr-only"> your clear</span>
            </Link>
            <EliminaClear clearId={clear.id} />
          </div>
        )}
      </footer>

      <Commenti
        versionId={clear.version_id}
        idBase={titolo}
        commenti={commenti}
        totale={clear.comments}
        modo={spettatore.modo}
        accesso={spettatore.accesso}
      />
    </article>
  )
}
