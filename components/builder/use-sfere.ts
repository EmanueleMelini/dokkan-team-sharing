'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SferaScelta } from '@/lib/clears/builder-stato'

export type SferaTrovata = SferaScelta & { effect: string | null }

type Risposta = { items: (Omit<SferaTrovata, 'id'> & { id: string })[]; total: number; next: number | null; hidden?: number }

export type RicercaSfere = {
  sfere: SferaTrovata[]
  totale: number
  prossimo: number | null
  /** le sfere della ricerca che la carta dello slot non puo' montare */
  nascoste: number
  stato: 'attesa' | 'carica' | 'pronto' | 'errore'
}

const VUOTA: RicercaSfere = { sfere: [], totale: 0, prossimo: null, nascoste: 0, stato: 'attesa' }

function query(q: string, tier: string, carta: number | null, offset = 0): string {
  const qs = new URLSearchParams()
  if (q.trim()) qs.set('q', q.trim())
  if (tier) qs.set('tier', tier)
  if (carta) qs.set('card', String(carta))
  if (offset) qs.set('offset', String(offset))
  return qs.toString()
}

async function chiedi(qs: string, signal?: AbortSignal): Promise<Risposta> {
  const r = await fetch(`/api/equipment?${qs}`, { signal })
  if (!r.ok) throw new Error(`equipment ${r.status}`)
  return r.json()
}

const converti = (r: Risposta) => r.items.map((x) => ({ ...x, id: Number(x.id) }))

/**
 * La ricerca delle Skill Orb su /api/equipment, come useCarte: il testo
 * aspetta 250 ms dall'ultimo tasto, una richiesta superata si annulla.
 * Con la carta dello slot arrivano solo le sfere che puo' montare.
 */
export function useSfere(q: string, tier: string, carta: number | null, attivo: boolean) {
  const [ricerca, setRicerca] = useState<RicercaSfere>(VUOTA)
  const qs = query(q, tier, carta)

  useEffect(() => {
    if (!attivo) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setRicerca((r) => ({ ...r, stato: 'carica' }))
      try {
        const r = await chiedi(qs, ctrl.signal)
        setRicerca({ sfere: converti(r), totale: r.total, prossimo: r.next, nascoste: r.hidden ?? 0, stato: 'pronto' })
      } catch {
        if (!ctrl.signal.aborted) setRicerca({ ...VUOTA, stato: 'errore' })
      }
    }, q.trim() ? 250 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [qs, attivo, q])

  const altre = useCallback(async () => {
    if (ricerca.prossimo == null) return
    setRicerca((r) => ({ ...r, stato: 'carica' }))
    try {
      const r = await chiedi(query(q, tier, carta, ricerca.prossimo))
      setRicerca((p) => ({
        sfere: [...p.sfere, ...converti(r)], totale: r.total, prossimo: r.next, nascoste: r.hidden ?? 0, stato: 'pronto',
      }))
    } catch {
      setRicerca((p) => ({ ...p, stato: 'errore' }))
    }
  }, [q, tier, carta, ricerca.prossimo])

  return { ricerca, altre }
}
