// Tiny external store: hydrate from GET /api/state, then apply SSE `GET /api/events` messages.
// Components subscribe with a selector (useStore) so a 1 Hz telemetry event does not re-render the map.
import { useSyncExternalStore } from 'react'
import type {
  Bench, Call, Case, Counters, Egress, EvalData, Health, Net, Ring, Sar, SseMessage, Telemetry, Tick,
} from './types'

export interface EgressRow extends Egress {
  _k: number // stable key, newest has the largest
}

export interface State {
  tick?: Tick
  bench?: Bench
  eval?: EvalData
  counters?: Counters
  telemetry?: Telemetry
  net?: Net
  health?: Health
  rings: Record<string, Ring>
  ringOrder: string[] // ring ids, oldest found first
  cases: Record<string, Case>
  sars: Record<string, Sar>
  calls: Record<string, Call>
  egress: EgressRow[] // newest first
  txHistory: { t: number; v: number }[] // tx/s per tick, for the sparkline
  tickTotalHistory: { t: number; v: number }[]
  sse: 'connecting' | 'live' | 'reconnecting'
  hydrated: boolean
  lastEventAt?: number
  netChangedAt?: number
  activeCallId?: string // the call this screen started or is following
}

const EGRESS_MAX = 200
const HIST_MAX = 120

let state: State = {
  rings: {}, ringOrder: [], cases: {}, sars: {}, calls: {}, egress: [], txHistory: [], tickTotalHistory: [],
  sse: 'connecting', hydrated: false,
}
const listeners = new Set<() => void>()
let egressKey = 0

function emit() {
  for (const l of listeners) l()
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  emit()
}

export function getState() {
  return state
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => sel(state),
  )
}

function foundKey(r: Ring) {
  return r.found_at ? Date.parse(r.found_at) || 0 : 0
}

function addRings(list: Ring[], base: State): Pick<State, 'rings' | 'ringOrder'> {
  const rings = { ...base.rings }
  let order = base.ringOrder
  let added = false
  for (const r of list) {
    if (!r || !r.ring_id) continue
    if (!rings[r.ring_id]) added = true
    rings[r.ring_id] = r
  }
  if (added || list.length) {
    order = Object.keys(rings).sort((a, b) => foundKey(rings[a]) - foundKey(rings[b]) || a.localeCompare(b))
  }
  return { rings, ringOrder: order }
}

function pushTick(t: Tick, base: State): Partial<State> {
  const now = Date.now()
  const out: Partial<State> = { tick: t }
  const last = base.tickTotalHistory[base.tickTotalHistory.length - 1]
  // only record a sparkline point when the worker actually advanced (ticks can be re-sent on hydrate)
  if (t.tx_per_sec != null && (!last || last.v !== t.tx_total)) {
    out.txHistory = [...base.txHistory, { t: now, v: t.tx_per_sec }].slice(-HIST_MAX)
    out.tickTotalHistory = [...base.tickTotalHistory, { t: now, v: t.tx_total ?? 0 }].slice(-HIST_MAX)
  }
  return out
}

function applyMessage(m: SseMessage) {
  const d = m.data
  const s = state
  switch (m.type) {
    case 'tick':
      set({ ...pushTick(d, s), lastEventAt: Date.now() })
      return
    case 'bench':
    case 'counters':
    case 'telemetry':
    case 'health':
      set({ [m.type]: d, lastEventAt: Date.now() } as Partial<State>)
      return
    case 'eval':
      set({ eval: { ...(s.eval || {}), ...d }, lastEventAt: Date.now() })
      return
    case 'net': {
      const changed = s.net?.online !== undefined && s.net.online !== d.online
      set({ net: d, netChangedAt: changed ? Date.now() : s.netChangedAt, lastEventAt: Date.now() })
      return
    }
    case 'ring':
      set({ ...addRings([d], s), lastEventAt: Date.now() })
      return
    case 'case':
      if (d?.ring_id) set({ cases: { ...s.cases, [d.ring_id]: d }, lastEventAt: Date.now() })
      return
    case 'sar':
      if (d?.sar_id) set({ sars: { ...s.sars, [d.sar_id]: d }, lastEventAt: Date.now() })
      return
    case 'call':
      if (d?.call_id) set({ calls: { ...s.calls, [d.call_id]: d }, lastEventAt: Date.now() })
      return
    case 'egress':
      set({ egress: [{ ...d, _k: ++egressKey }, ...s.egress].slice(0, EGRESS_MAX), lastEventAt: Date.now() })
      return
    default:
      return // ping and unknown types
  }
}

function byKey<T>(arr: unknown, key: string): Record<string, T> {
  const out: Record<string, T> = {}
  if (Array.isArray(arr)) for (const x of arr) if (x && (x as any)[key] != null) out[String((x as any)[key])] = x as T
  return out
}

async function hydrate() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' })
    if (!r.ok) return
    const snap = await r.json()
    const s = state
    const patch: Partial<State> = { hydrated: true }
    for (const t of ['bench', 'counters', 'telemetry', 'health', 'net'] as const) {
      if (snap[t]) (patch as any)[t] = snap[t]
    }
    if (snap.eval) patch.eval = { ...(s.eval || {}), ...snap.eval }
    if (snap.tick) Object.assign(patch, pushTick(snap.tick, s))
    Object.assign(patch, addRings(snap.rings || [], s))
    patch.cases = { ...s.cases, ...byKey<Case>(snap.cases, 'ring_id') }
    patch.sars = { ...s.sars, ...byKey<Sar>(snap.sars, 'sar_id') }
    patch.calls = { ...s.calls, ...byKey<Call>(snap.calls, 'call_id') }
    if (Array.isArray(snap.egress) && s.egress.length === 0) {
      // snapshot list is oldest-first
      patch.egress = [...snap.egress].reverse().slice(0, EGRESS_MAX).map((e: Egress) => ({ ...e, _k: ++egressKey }))
    }
    set(patch)
  } catch (e) {
    console.warn('[ui] hydrate failed', e)
  }
}

let es: EventSource | null = null
let retryTimer: number | undefined

export function connect() {
  if (es) return
  hydrate()
  open()
}

function open() {
  es = new EventSource('/api/events')
  es.onopen = () => {
    if (state.sse === 'reconnecting') hydrate() // catch up on anything missed while away
    set({ sse: 'live' })
  }
  es.onmessage = (ev) => {
    try {
      applyMessage(JSON.parse(ev.data))
    } catch {
      /* ignore malformed */
    }
  }
  es.onerror = () => {
    set({ sse: 'reconnecting' })
    if (es && es.readyState === EventSource.CLOSED) {
      es.close()
      es = null
      window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(open, 2000)
    }
  }
}

// --- local UI state that should survive re-renders but is not backend data
export function patchLocal(p: Partial<State>) {
  set(p)
}

/** The call on screen: the one this UI started, else the most recently started call. */
export function useActiveCall() {
  const calls = useStore((s) => s.calls)
  const id = useStore((s) => s.activeCallId)
  if (id && calls[id]) return calls[id]
  let best: (typeof calls)[string] | undefined
  for (const c of Object.values(calls)) {
    if (!best || String(c.started_at || '') > String(best.started_at || '')) best = c
  }
  return best
}

// dev-only hook so visual states (e.g. OFFLINE) can be checked from a headless browser; stripped from builds
if (import.meta.env.DEV) (window as any).__ffInject = (m: SseMessage) => applyMessage(m)
