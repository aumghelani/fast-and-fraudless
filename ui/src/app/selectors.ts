// Small read helpers over the live store.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useActiveCall, useStore } from '../lib/store'
import { toDate } from '../lib/format'
import type { Call, Case, Ring, Sar } from '../lib/types'
import type { Tone } from './kit'

export { useActiveCall }

export type Verdict = 'HOLD' | 'VERIFY' | 'NO_HOLD'

/** True once speech from this call has been transcribed (nothing is shown as decided before that). */
export function heardOf(c?: Call): boolean {
  return !!(c?.transcript_final || c?.transcript || c?.partial || '').trim()
}

/** Transcribed sentences so far. */
export function sentencesOf(c?: Call): number {
  const t = (c?.transcript_final || c?.transcript || '').trim()
  return t ? t.split(/(?<=[.!?])\s+/).filter(Boolean).length : 0
}

const textOf = (c?: Call) => `${c?.transcript_final || ''} ${c?.transcript || ''} ${c?.partial || ''}`
const hasCue = (c: Call | undefined, k: string) => (c?.cues ?? []).some((q) => String(q?.cue).toUpperCase() === k)
const WIRE_RE = /\b(wire|send|sending|transfer|pay)\b/i
const AMOUNT_RE = /(\$\s?\d|\d[\d,.]*\s*(dollars|usd|k)\b|\b(hundred|thousand|million)\b)/i

/** The customer has asked for a payment (heard in the words). */
export function wireAskedOf(c?: Call): boolean {
  return !!c && (hasCue(c, 'AMOUNT_STATED') || WIRE_RE.test(textOf(c)))
}

/** The amount has been said out loud. */
export function amountHeardOf(c?: Call): boolean {
  return !!c && (hasCue(c, 'AMOUNT_STATED') || AMOUNT_RE.test(textOf(c)))
}

/** The rules' verdict, shown only once the call has been heard and the payment asked for. */
export function verdictOf(c?: Call): Verdict | null {
  if (!heardOf(c)) return null
  if (!c?.ended && !wireAskedOf(c)) return null
  const r = c?.recommendation
  return r === 'HOLD' || r === 'VERIFY' || r === 'NO_HOLD' ? r : null
}

export const VERDICT_TONE: Record<Verdict, Tone> = { HOLD: 'hold', VERIFY: 'verify', NO_HOLD: 'clear' }
export const VERDICT_LABEL: Record<Verdict, string> = { HOLD: 'Hold', VERIFY: 'Verify', NO_HOLD: 'Clear' }

/** Calls, newest started first. */
export function useCallsNewestFirst(): Call[] {
  const calls = useStore((s) => s.calls)
  return useMemo(
    () => Object.values(calls).sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || ''))),
    [calls],
  )
}

const ms = (t: number | string | null | undefined) => toDate(t)?.getTime() ?? 0

/** The SAR to show: the active call's payee ring first, else the newest undecided, else the newest. */
export function useShownSar(): { sar?: Sar; kase?: Case; linked: boolean } {
  const sars = useStore((s) => s.sars)
  const cases = useStore((s) => s.cases)
  const call = useActiveCall()
  const payeeRing = call?.payee_check?.ring_id ?? null
  return useMemo(() => {
    const all = Object.values(sars)
    const t = (x: Sar) => {
      let best = 0
      for (const e of cases[x.ring_id]?.timeline || []) best = Math.max(best, ms(e?.ts))
      return best
    }
    const newest = (list: Sar[]) => list.reduce<Sar | undefined>((b, x) => (!b || t(x) > t(b) ? x : b), undefined)
    let sar: Sar | undefined
    if (payeeRing) sar = newest(all.filter((x) => x.ring_id === payeeRing))
    if (!sar) {
      const open = all.filter((x) => !x.decision)
      sar = newest(open.length ? open : all)
    }
    return { sar, kase: sar ? cases[sar.ring_id] : undefined, linked: !!sar && !!payeeRing && sar.ring_id === payeeRing }
  }, [sars, cases, payeeRing])
}

// rings not in the store (e.g. the payee's ring) are fetched once into a module cache
const ringCache = new Map<string, Ring | null>()
const inflight = new Set<string>()
const cacheSubs = new Set<() => void>()

function fetchRing(id: string) {
  if (ringCache.has(id) || inflight.has(id)) return
  inflight.add(id)
  fetch(`/api/rings/${encodeURIComponent(id)}`, { cache: 'no-store' })
    .then(async (r) => {
      if (r.status === 404) ringCache.set(id, null)
      else if (r.ok) {
        const j = await r.json()
        ringCache.set(id, j && j.ring_id ? (j as Ring) : null)
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight.delete(id)
      for (const l of Array.from(cacheSubs)) l()
    })
}

export function useRing(id?: string | null): Ring | undefined {
  const stored = useStore((s) => (id ? s.rings[id] : undefined))
  const cached = useSyncExternalStore(
    (l) => {
      cacheSubs.add(l)
      return () => cacheSubs.delete(l)
    },
    () => (id ? ringCache.get(id) : undefined),
  )
  useEffect(() => {
    if (id && !stored) fetchRing(id)
  }, [id, stored])
  return id ? (stored ?? cached ?? undefined) : undefined
}

export function usePrefersReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)'
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setR(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return r
}
