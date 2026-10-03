// Tiny external store: hydrate from GET /api/state, then apply SSE `GET /api/events` messages.
// Components subscribe with a selector (useStore). Selectors must return stored values, never new objects.
// Notifications are coalesced to one per animation frame, so bursts of events cost one render.
import { useSyncExternalStore } from 'react'
import type {
  Bench, Branding, Call, Case, Counters, Egress, EvalData, Health, Integration, Net, Ring, Sar, SseMessage,
  Telemetry, Tick, Watchdog,
} from './types'
import type { ExfilState, Story } from './story'
import { loadBranding } from './branding'

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
  watchdog?: Watchdog
  integration?: Integration // latest screened payment message
  integrations: Integration[] // newest first, max 10
  branding?: Branding
  rings: Record<string, Ring>
  ringOrder: string[] // ring ids, oldest found first
  cases: Record<string, Case>
  sars: Record<string, Sar>
  calls: Record<string, Call>
  egress: EgressRow[] // newest first
  egressBaseKey?: number // largest egress _k after the first hydrate; rows above it arrived in this session
  txHistory: { t: number; v: number }[] // tx/s per tick
  tickTotalHistory: { t: number; v: number }[]
  sse: 'connecting' | 'live' | 'reconnecting'
  hydrated: boolean
  netChangedAt?: number
  activeCallId?: string // the call this screen started or is following
  story: Story
  exfil: ExfilState
}

const EGRESS_MAX = 200
const HIST_MAX = 120
const INTEGRATIONS_MAX = 10
const BUFFER_MAX = 5000

let state: State = {
  integrations: [], rings: {}, ringOrder: [], cases: {}, sars: {}, calls: {}, egress: [], txHistory: [],
  tickTotalHistory: [], sse: 'connecting', hydrated: false,
  story: {
    scene: 'watching', dir: 1, auto: true, enteredAt: Date.now(), visited: { watching: true }, dots: {},
    details: false, help: false,
  },
  exfil: { status: 'idle' },
}
const listeners = new Set<() => void>()
let egressKey = 0

// --- notifications, one per frame (a timer while the tab is hidden, where rAF does not run)
let queued = false

function flush() {
  queued = false
  for (const l of Array.from(listeners)) l()
}

function emit() {
  if (queued) return
  queued = true
  if (typeof document !== 'undefined' && document.hidden) window.setTimeout(flush, 16)
  else requestAnimationFrame(flush)
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  emit()
}

/** Called once per frame after any change. */
export function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getState() {
  return state
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}

// --- rings, ordered by found_at (cached in ms so the comparator never parses dates)
const foundMs = new Map<string, number>()

function byFound(a: string, b: string) {
  return (foundMs.get(a) ?? 0) - (foundMs.get(b) ?? 0) || a.localeCompare(b)
}

function addRings(list: Ring[], base: State): Pick<State, 'rings' | 'ringOrder'> {
  let rings = base.rings
  let order = base.ringOrder
  let copied = false
  let resort = false
  const fresh: string[] = []
  for (const r of list) {
    if (!r || !r.ring_id) continue
    if (!copied) {
      rings = { ...rings }
      copied = true
    }
    const id = r.ring_id
    const ms = r.found_at ? Date.parse(r.found_at) || 0 : 0
    if (id in rings) {
      if (foundMs.get(id) !== ms) resort = true
    } else fresh.push(id)
    foundMs.set(id, ms)
    rings[id] = r
  }
  if (!copied) return { rings, ringOrder: order }
  if (fresh.length === 1 && !resort && (!order.length || byFound(order[order.length - 1], fresh[0]) <= 0)) {
    order = [...order, fresh[0]]
  } else if (fresh.length || resort) {
    order = Object.keys(rings).sort(byFound)
  }
  return { rings, ringOrder: order }
}

function pushTick(t: Tick, base: State): Partial<State> {
  const now = Date.now()
  const out: Partial<State> = { tick: t }
  const last = base.tickTotalHistory[base.tickTotalHistory.length - 1]
  // only record a point when the worker actually advanced (ticks can be re-sent on hydrate)
  if (t.tx_per_sec != null && (!last || last.v !== t.tx_total)) {
    out.txHistory = [...base.txHistory, { t: now, v: t.tx_per_sec }].slice(-HIST_MAX)
    out.tickTotalHistory = [...base.tickTotalHistory, { t: now, v: t.tx_total ?? 0 }].slice(-HIST_MAX)
  }
  return out
}

function sameEgress(a: Egress, b: Egress) {
  return a.ts === b.ts && a.verdict === b.verdict && a.dest === b.dest && a.process === b.process
}

function applyMessage(m: SseMessage) {
  const d = m?.data
  const s = state
  switch (m?.type) {
    case 'tick':
      if (d) set(pushTick(d, s))
      return
    case 'bench':
    case 'counters':
    case 'telemetry':
    case 'health':
    case 'watchdog':
      set({ [m.type]: d } as Partial<State>)
      return
    case 'integration':
      if (d) set({ integration: d, integrations: [d, ...s.integrations].slice(0, INTEGRATIONS_MAX) })
      return
    case 'eval':
      set({ eval: { ...(s.eval || {}), ...d } })
      return
    case 'net': {
      const changed = s.net?.online !== undefined && s.net.online !== d?.online
      set({ net: d, netChangedAt: changed ? Date.now() : s.netChangedAt })
      return
    }
    case 'ring':
      if (d) set(addRings([d], s))
      return
    case 'case':
      if (d?.ring_id) set({ cases: { ...s.cases, [d.ring_id]: d } })
      return
    case 'sar':
      if (d?.sar_id) set({ sars: { ...s.sars, [d.sar_id]: d } })
      return
    case 'call':
      if (d?.call_id) set({ calls: { ...s.calls, [d.call_id]: d } })
      return
    case 'egress':
      if (!d) return
      // a row can arrive both in the snapshot and on the stream around a hydrate
      for (let i = 0; i < Math.min(20, s.egress.length); i++) if (sameEgress(s.egress[i], d)) return
      set({ egress: [{ ...d, _k: ++egressKey }, ...s.egress].slice(0, EGRESS_MAX) })
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

function applySnapshot(snap: any) {
  const s = state
  const patch: Partial<State> = { hydrated: true }
  for (const t of ['bench', 'counters', 'telemetry', 'health', 'net', 'watchdog'] as const) {
    if (snap[t]) (patch as any)[t] = snap[t]
  }
  if (Array.isArray(snap.integrations)) {
    patch.integrations = snap.integrations.slice(0, INTEGRATIONS_MAX)
    if (snap.integrations[0]) patch.integration = snap.integrations[0]
  }
  if (snap.integration && typeof snap.integration === 'object' && !Array.isArray(snap.integration)) {
    patch.integration = snap.integration
    if (!patch.integrations && !s.integrations.length) patch.integrations = [snap.integration]
  }
  if (snap.eval) patch.eval = { ...(s.eval || {}), ...snap.eval }
  if (snap.tick) Object.assign(patch, pushTick(snap.tick, s))
  Object.assign(patch, addRings(Array.isArray(snap.rings) ? snap.rings : [], s))
  patch.cases = { ...s.cases, ...byKey<Case>(snap.cases, 'ring_id') }
  patch.sars = { ...s.sars, ...byKey<Sar>(snap.sars, 'sar_id') }
  patch.calls = { ...s.calls, ...byKey<Call>(snap.calls, 'call_id') }
  if (Array.isArray(snap.egress) && s.egress.length === 0) {
    // snapshot list is oldest-first
    patch.egress = [...snap.egress].reverse().slice(0, EGRESS_MAX).map((e: Egress) => ({ ...e, _k: ++egressKey }))
  }
  if (s.egressBaseKey == null) patch.egressBaseKey = egressKey
  set(patch)
}

// --- hydrate: SSE messages that arrive while a snapshot is in flight are buffered, then replayed on top of it
let hydrating = false
let hydrateAgain = false
let buffered: SseMessage[] = []

async function hydrate() {
  if (hydrating) {
    hydrateAgain = true
    return
  }
  hydrating = true
  let ok = false
  try {
    const r = await fetch('/api/state', { cache: 'no-store' })
    if (r.ok) {
      applySnapshot(await r.json())
      ok = true
    }
  } catch (e) {
    console.warn('[ui] hydrate failed', e)
  } finally {
    hydrating = false
    const b = buffered
    buffered = []
    for (const m of b) applyMessage(m)
    if (hydrateAgain) {
      hydrateAgain = false
      hydrate()
    } else if (!ok && !state.hydrated) window.setTimeout(hydrate, 3000) // first load failed: keep trying
  }
}

let es: EventSource | null = null
let retryTimer: number | undefined

export function connect() {
  if (es) return
  hydrate()
  loadBranding()
  open()
}

function open() {
  es = new EventSource('/api/events')
  es.onopen = () => {
    if (state.sse === 'reconnecting') hydrate() // catch up on anything missed while away
    set({ sse: 'live' })
  }
  es.onmessage = (ev) => {
    let m: SseMessage
    try {
      m = JSON.parse(ev.data)
    } catch {
      return // ignore malformed
    }
    if (hydrating) {
      if (buffered.length < BUFFER_MAX) buffered.push(m)
    } else applyMessage(m)
  }
  es.onerror = () => {
    if (state.sse !== 'reconnecting') set({ sse: 'reconnecting' })
    if (es && es.readyState === EventSource.CLOSED) {
      es.close()
      es = null
      window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(open, 2000)
    }
  }
}

// --- local UI state that is not backend data
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

// dev-only hooks so visual states can be checked from a headless browser; stripped from builds
if (import.meta.env.DEV) {
  const w = window as any
  w.__ffInject = (m: SseMessage) => applyMessage(m)
  w.__ffLocal = (p: Partial<State>) => patchLocal(p)
  w.__ffState = () => state
}
