// Derived data for scenes: the story call, its verdict, the shown SAR, a ring by id, plain-word errors.
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { getState, useStore, type State } from '../lib/store'
import { toDate } from '../lib/format'
import type { Call, Case, Ring, Sar } from '../lib/types'
import type { Verdict } from '../ui/tokens'

export type { Verdict } from '../ui/tokens'

function newestCall(calls: Record<string, Call>): Call | undefined {
  let best: Call | undefined
  for (const c of Object.values(calls)) {
    if (!best || String(c.started_at || '') > String(best.started_at || '')) best = c
  }
  return best
}

/** The story call: calls[storyCallId], else (no story yet) the newest call by started_at.
 *  While a call this screen started is still connecting, storyCallId is a pending id and this is undefined. */
export function storyCallOf(s: Pick<State, 'calls' | 'story'>): Call | undefined {
  const id = s.story.storyCallId
  return id ? s.calls[id] : newestCall(s.calls)
}

export function useStoryCall(): Call | undefined {
  const calls = useStore((s) => s.calls)
  const id = useStore((s) => s.story.storyCallId)
  return useMemo(() => (id ? calls[id] : newestCall(calls)), [calls, id])
}

export function verdictOf(c?: Call): Verdict | null {
  const r = c?.recommendation
  return r === 'HOLD' || r === 'VERIFY' || r === 'NO_HOLD' ? r : null
}

function ms(t: number | string | null | undefined): number {
  return toDate(t)?.getTime() ?? 0
}

/** Last timeline time of the SAR's case, for "newest" ordering. */
function sarTime(s: Pick<State, 'cases'>, sar: Sar): number {
  const tl = s.cases[sar.ring_id]?.timeline
  let best = 0
  if (tl) for (const e of tl) best = Math.max(best, ms(e?.ts))
  return best
}

/** The payee ring's SAR, else the newest undecided SAR, else the newest SAR. Returns its id. */
export function pickSar(s: Pick<State, 'sars' | 'cases'>, payeeRing?: string | null): string | undefined {
  const all = Object.values(s.sars)
  if (!all.length) return undefined
  const newest = (list: Sar[]) => {
    let best: Sar | undefined
    let bt = -1
    for (const x of list) {
      const t = sarTime(s, x)
      if (!best || t > bt) {
        best = x
        bt = t
      }
    }
    return best?.sar_id
  }
  if (payeeRing) {
    const linked = all.filter((x) => x.ring_id === payeeRing)
    if (linked.length) return newest(linked)
  }
  const open = all.filter((x) => !x.decision)
  return newest(open.length ? open : all)
}

export function useShownSar(): { sar?: Sar; kase?: Case; linked: boolean } {
  const sars = useStore((s) => s.sars)
  const cases = useStore((s) => s.cases)
  const shownId = useStore((s) => s.story.shownSarId)
  const call = useStoryCall()
  const payeeRing = call?.payee_check?.ring_id ?? null
  return useMemo(() => {
    const id = shownId && sars[shownId] ? shownId : pickSar({ sars, cases }, payeeRing)
    const sar = id ? sars[id] : undefined
    return {
      sar,
      kase: sar ? cases[sar.ring_id] : undefined,
      linked: !!sar && !!payeeRing && sar.ring_id === payeeRing,
    }
  }, [sars, cases, shownId, payeeRing])
}

// --- rings that are not in the store (e.g. the payee's ring), fetched once into a module cache
const ringCache = new Map<string, Ring | null>()
const inflight = new Set<string>()
const cacheSubs = new Set<() => void>()

function subscribeCache(l: () => void) {
  cacheSubs.add(l)
  return () => {
    cacheSubs.delete(l)
  }
}

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
    .catch(() => {
      /* network error: a later mount may retry */
    })
    .finally(() => {
      inflight.delete(id)
      for (const l of Array.from(cacheSubs)) l()
    })
}

export function useRing(id?: string | null): Ring | undefined {
  const stored = useStore((s) => (id ? s.rings[id] : undefined))
  const cached = useSyncExternalStore(subscribeCache, () => (id ? ringCache.get(id) : undefined))
  useEffect(() => {
    if (id && !stored) fetchRing(id)
  }, [id, stored])
  if (!id) return undefined
  return stored ?? cached ?? undefined
}

/** Raw agent errors never go on stage; this is the plain-word line. */
export function summariseError(msg?: string): string {
  return msg && /no SAR submitted/i.test(msg) ? 'No report submitted · will retry' : 'Agent run failed · will retry'
}

/** Current store snapshot helper for non-React code (director, fixtures). */
export function storyCallNow(): Call | undefined {
  return storyCallOf(getState())
}
