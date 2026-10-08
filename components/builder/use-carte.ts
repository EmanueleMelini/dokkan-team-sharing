'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CartaScelta } from '@/lib/clears/builder-stato'

export type Filtri = { q: string; type: string; class: string; rarity: string; category: string }
export const FILTRI_VUOTI: Filtri = { q: '', type: '', class: '', rarity: '', category: '' }

export type CartaTrovata = CartaScelta & { rarity: string }

type Risposta = { cards: (Omit<CartaTrovata, 'id'> & { id: string })[]; total: number; next: number | null }

export type Ricerca = {
  carte: CartaTrovata[]
  totale: number
  prossimo: number | null
  stato: 'attesa' | 'carica' | 'pronto' | 'errore'
}

const VUOTA: Ricerca = { carte: [], totale: 0, prossimo: null, stato: 'attesa' }

function query(f: Filtri, offset = 0): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v.trim()) qs.set(k, v.trim())
  if (offset) qs.set('offset', String(offset))
  return qs.toString()
}

async function chiedi(qs: string, signal?: AbortSignal): Promise<Risposta> {
  const r = await fetch(`/api/cards?${qs}`, { signal })
  if (!r.ok) throw new Error(`cards ${r.status}`)
  return r.json()
}

const converti = (r: Risposta) => r.cards.map((c) => ({ ...c, id: Number(c.id) }))

/**
 * La ricerca del picker su /api/cards. Il testo aspetta 250 ms dall'ultimo
 * tasto (debounce); i filtri partono subito. Una richiesta superata da una
 * nuova si annulla, così una risposta lenta non sovrascrive quella giusta.
 */
export function useCarte(filtri: Filtri, attivo: boolean) {
  const [ricerca, setRicerca] = useState<Ricerca>(VUOTA)
  const qs = query(filtri)

  useEffect(() => {
    if (!attivo) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setRicerca((r) => ({ ...r, stato: 'carica' }))
      try {
        const r = await chiedi(qs, ctrl.signal)
        setRicerca({ carte: converti(r), totale: r.total, prossimo: r.next, stato: 'pronto' })
      } catch {
        if (!ctrl.signal.aborted) setRicerca({ ...VUOTA, stato: 'errore' })
      }
    }, filtri.q.trim() ? 250 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [qs, attivo, filtri.q])

  const altre = useCallback(async () => {
    if (ricerca.prossimo == null) return
    setRicerca((r) => ({ ...r, stato: 'carica' }))
    try {
      const r = await chiedi(query(filtri, ricerca.prossimo))
      setRicerca((p) => ({ carte: [...p.carte, ...converti(r)], totale: r.total, prossimo: r.next, stato: 'pronto' }))
    } catch {
      setRicerca((p) => ({ ...p, stato: 'errore' }))
    }
  }, [filtri, ricerca.prossimo])

  return { ricerca, altre }
}
