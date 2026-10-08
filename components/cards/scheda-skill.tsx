import { righeDi, type CardSkill, type SkillKind, type SkillSection, type SkillTier } from '@/lib/card-page'

// I testi delle skill di un livello. Testo del wiki reso sempre come
// testo React, mai come HTML.

const TITOLO: Record<SkillKind, string> = {
  leader: 'Leader Skill', super: 'Super Attack', ultra: 'Ultra Super Attack', passive: 'Passive Skill',
  active: 'Active Skill', standby: 'Standby Skill', domain: 'Domain', transform: 'Transformation',
  unit_super: 'Unit Super Attack', ex_super: 'EX Super Attack', finish: 'Finish Skill',
}

export const NOME_LIVELLO: Record<SkillTier, string> = { base: 'Base', eza: 'EZA', seza: 'Super EZA' }

/**
 * Le righe di una descrizione. I punti elenco vanno in una lista; una
 * riga semplice seguita da punti elenco e' il loro titoletto ("Basic
 * effect(s)"), altrimenti e' un paragrafo.
 */
function Descrizione({ testo }: { testo: string }) {
  const righe = righeDi(testo)
  const blocchi: React.ReactNode[] = []
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i]
    if (r.bullet) {
      const lista: string[] = []
      while (i < righe.length && righe[i].bullet) lista.push(righe[i++].text)
      i--
      blocchi.push(
        <ul key={i} className="list-disc pl-5 space-y-0.5 marker:text-linea-forte">
          {lista.map((t, k) => <li key={k}>{t}</li>)}
        </ul>,
      )
    } else if (righe[i + 1]?.bullet) {
      blocchi.push(<p key={i} className="mt-2 first:mt-0 font-medium text-inchiostro">{r.text}</p>)
    } else {
      blocchi.push(<p key={i}>{r.text}</p>)
    }
  }
  return <div className="space-y-1 text-[13px] leading-relaxed text-testo">{blocchi}</div>
}

function Riga({ s }: { s: CardSkill }) {
  return (
    <div className="space-y-1.5">
      {s.name && <p className="text-[13px] font-medium text-inchiostro">{s.name}</p>}
      {s.condition && (
        <p className="text-[12px] text-tenue">
          <span className="font-medium">{s.kind === 'transform' ? 'When' : 'Condition'}:</span> {s.condition}
        </p>
      )}
      <Descrizione testo={s.description} />
      {s.details.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] font-medium text-tenue">Exact values</p>
          <ol className="mt-0.5 list-decimal pl-5 space-y-0.5 text-[12px] leading-relaxed text-tenue">
            {s.details.map((d, k) => <li key={k}>{d}</li>)}
          </ol>
        </div>
      )}
    </div>
  )
}

/** Le sezioni di un livello, una per tipo di skill. */
export function SchedaSkill({ sezioni }: { sezioni: SkillSection[] }) {
  return (
    <div className="divide-y divide-linea border-y border-linea">
      {sezioni.map((sez) => (
        <section key={sez.kind} className="py-3.5">
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-inchiostro">
            {TITOLO[sez.kind]}
            {sez.from && (
              <span className="text-[11px] font-normal text-tenue">
                Unchanged from {NOME_LIVELLO[sez.from]}
              </span>
            )}
          </h3>
          <div className="mt-2 space-y-4">
            {sez.rows.map((s) => <Riga key={`${s.tier}-${s.seq}`} s={s} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
