import Image from 'next/image'
import Link from 'next/link'
import { assetUrl } from '@/lib/db'
import { soloGiorno } from '@/lib/date'
import { FONTE_TESTI, paginaWiki } from '@/lib/legale'
import { eventHref } from '@/lib/urls'
import { skillTiers, skillsForTier, type CardClear, type CardDetail } from '@/lib/card-page'
import type { Region } from '@/lib/queries'
import { Tipo } from '@/components/tipo'
import { ArtToggle } from '@/components/cards/art-toggle'
import { TierTabs } from '@/components/cards/tier-tabs'
import { NOME_LIVELLO, SchedaSkill } from '@/components/cards/scheda-skill'
import { Catena } from '@/components/cards/catena'
import { ClearConCarta } from '@/components/cards/clear-con-carta'

// Il corpo della pagina di una carta. Solo dati in cache, mai la sessione:
// e' la stessa pagina per tutti. Il default dell'artwork di chi guarda
// arriva dopo, nell'isola ArtToggle, da /api/me.

const REGIONE: Record<Region, string> = { global: 'Global', japan: 'Japan' }

const fmt = (n: number | null) => (n == null ? '–' : n.toLocaleString('en-US'))

function Titolo({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-[13px] font-semibold text-inchiostro">{children}</h2>
}

function Segno({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded-[var(--raggio)] border border-oro-linea bg-oro-tenue text-oro">
      {children}
    </span>
  )
}

export function CardPage({ card, clears }: { card: CardDetail; clears: { rows: CardClear[]; total: number; reg: Region } }) {
  const nome = card.name ?? `Card ${card.id}`
  const globale = card.releases.some((r) => r.reg === 'global')
  const livelli = skillTiers(card.skills)
  // is_seza viene da un campo del wiki che alcune pagine con i testi
  // della Super EZA non hanno: i testi bastano a dirlo
  const superEza = card.is_seza || livelli.includes('seza')
  const icona = assetUrl(card.rarity_icon_key)
  const iconaTipo = assetUrl(card.type_icon_key)

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <header className="min-w-0 lg:col-start-2">
          <p className="flex items-center gap-2 text-[12px] text-tenue">
            {icona && <Image src={icona} alt="" width={28} height={28} className="h-5 w-auto" />}
            <span className="numeri">{card.rarity}</span>
            {iconaTipo && <Image src={iconaTipo} alt="" width={20} height={20} className="h-4 w-auto" />}
            <Tipo tipo={card.type} classe={card.class} />
            <span className="numeri">ID {card.id}</span>
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-inchiostro leading-tight text-balance break-words">
            {nome}
          </h1>
          {card.epithet && <p className="mt-1 text-[14px] text-testo break-words">{card.epithet}</p>}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-tenue">
            {card.releases.map((r) => (
              <span key={r.reg}>{REGIONE[r.reg]}: {soloGiorno(new Date(`${r.date}T00:00:00Z`))}</span>
            ))}
          </p>
          {!globale && <p className="mt-2 text-[13px] font-medium text-oro">Not released on Global yet.</p>}
          {(card.has_eza || superEza) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.has_eza && <Segno>Extreme Z-Awakened</Segno>}
              {superEza && <Segno>Super EZA</Segno>}
            </div>
          )}
          {card.ezaEvents.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px] text-testo">
              {card.ezaEvents.map((e) => (
                <li key={e.id}>
                  <Link href={eventHref({ id: e.id })} prefetch={false} className="underline decoration-oro-linea underline-offset-2 hover:text-inchiostro">
                    {e.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>

        {/* Ferma mentre si leggono le skill, ma solo se ci sta tutta: su uno
            schermo basso la parte sotto (scelta e statistiche) resterebbe
            irraggiungibile fino alla fine della pagina. */}
        <div className="mx-auto w-full max-w-[380px] min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2 lg:self-start [@media(min-width:64rem)_and_(min-height:60rem)]:sticky [@media(min-width:64rem)_and_(min-height:60rem)]:top-6">
          <ArtToggle
            cardId={card.id}
            name={nome}
            still={assetUrl(card.art_key)}
            stillW={card.art_w}
            stillH={card.art_h}
            animated={assetUrl(card.art_animated_key)}
            animatedBytes={card.art_animated_bytes}
            thumb={assetUrl(card.thumb_key)}
            type={card.type}
            class={card.class}
          />
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {([['Max HP', card.hp], ['Max ATK', card.atk], ['Max DEF', card.def]] as const).map(([k, v]) => (
              <div key={k} className="rounded-[var(--raggio)] border border-linea bg-superficie px-2 py-1.5">
                <dt className="text-[11px] text-tenue">{k}</dt>
                <dd className="numeri text-[14px] font-medium text-inchiostro">{fmt(v)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="min-w-0 space-y-8 lg:col-start-2">
          <section aria-labelledby="skills">
            <Titolo id="skills">Skills</Titolo>
            <div className="mt-2">
              {livelli.length ? (
                <TierTabs
                  iniziale={livelli[0]}
                  schede={[...livelli].reverse().map((t) => ({
                    key: t, label: NOME_LIVELLO[t], panel: <SchedaSkill sezioni={skillsForTier(card.skills, t)} />,
                  }))}
                />
              ) : (
                <p className="text-[13px] text-tenue">
                  Skill text not documented yet. This card comes from the game data and its wiki page isn&apos;t written yet.
                </p>
              )}
            </div>
          </section>

          {card.links.length > 0 && (
            <section aria-labelledby="links">
              <Titolo id="links">Link Skills</Titolo>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {card.links.map((l) => (
                  <li key={l.id} className="max-w-full">
                    {l.effect ? (
                      <details className="group rounded-[var(--raggio)] border border-linea bg-superficie text-[12px]">
                        <summary className="cursor-pointer list-none px-2 py-1 text-inchiostro group-open:border-b group-open:border-linea">
                          {l.name}
                        </summary>
                        <p className="px-2 py-1 text-testo">{l.effect}</p>
                      </details>
                    ) : (
                      <span className="block rounded-[var(--raggio)] border border-linea bg-superficie px-2 py-1 text-[12px] text-inchiostro">{l.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {card.categories.length > 0 && (
            <section aria-labelledby="categories">
              <Titolo id="categories">Categories</Titolo>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {card.categories.map((c) => (
                  <li key={c.id} className="rounded-[var(--raggio)] bg-superficie-2 px-2 py-1 text-[12px] text-testo">{c.name}</li>
                ))}
              </ul>
            </section>
          )}

          {card.chain.length > 1 && (
            <section aria-labelledby="awakening">
              <Titolo id="awakening">Dokkan Awakening</Titolo>
              <div className="mt-2"><Catena catena={card.chain} corrente={card.id} /></div>
            </section>
          )}

          <section aria-labelledby="clears">
            <Titolo id="clears">Clears with this card</Titolo>
            <div className="mt-2"><ClearConCarta clears={clears.rows} totale={clears.total} reg={clears.reg} /></div>
          </section>

          <p className="border-t border-linea pt-3 text-[11px] leading-relaxed text-tenue">
            Card texts from the{' '}
            {card.wiki_title ? (
              <a href={paginaWiki(card.wiki_title)} rel="noopener" className="underline underline-offset-2 hover:text-inchiostro">
                {FONTE_TESTI.nome} page
              </a>
            ) : (
              <a href={FONTE_TESTI.sito} rel="noopener" className="underline underline-offset-2 hover:text-inchiostro">{FONTE_TESTI.nome}</a>
            )}{' '}
            (<a href={FONTE_TESTI.licenzaUrl} rel="license noopener" className="underline underline-offset-2 hover:text-inchiostro">{FONTE_TESTI.licenza}</a>)
            {' '}and the game&apos;s data. Names, texts and images belong to their owners.
          </p>
        </div>
      </div>
    </div>
  )
}
