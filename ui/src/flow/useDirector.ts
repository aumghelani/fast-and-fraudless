// The director moves the stage on real events (FLOW_DESIGN section 2).
// R1 a call from this screen starts a story; R2 foreign calls only light a dot;
// R3 Call -> Decision, R4 Decision -> Investigation, R5 Investigation -> Proof, each after a 6 s minimum dwell.
// It reads the store through one subscription, so it never re-renders the app.
import { useEffect, useRef } from 'react'
import { getState, subscribe, type State } from '../lib/store'
import type { CallMode } from '../lib/useCallControls'
import { useCtl } from './CtlProvider'
import { pickSar, storyCallOf, verdictOf, type Verdict } from './derive'
import type { SceneId } from './scenes'
import { cancelPending, goTo, hasPending, patchStory, schedule, type Story } from './story'

const DWELL_MS = 6000

type Rule = 'r3' | 'r4' | 'r5'

const mem = {
  storyKey: 0,
  fired: {} as Partial<Record<Rule, true>>,
  armed: null as Rule | null,
  activeCallId: undefined as string | undefined,
  lastVerdict: null as Verdict | null,
  calls: undefined as State['calls'] | undefined,
  sars: undefined as State['sars'] | undefined,
  cases: undefined as State['cases'] | undefined,
  egress: undefined as State['egress'] | undefined,
  knownCalls: null as Set<string> | null,
  knownSars: null as Set<string> | null,
  caseStatus: null as Map<string, string | undefined> | null,
  caseDrafted: false, // a case moved to sar_drafted while this page was open
  deniedKey: 0,
}

let pendingSeq = 0

/** R1: a new story for a call this screen started. Immediate, from any scene. */
function startStory(callId?: string) {
  cancelPending()
  mem.armed = null
  mem.storyKey++
  mem.fired = {}
  mem.lastVerdict = null
  patchStory({
    storyCallId: callId ?? `pending-${++pendingSeq}`,
    shownSarId: undefined,
    visited: {},
    dots: {},
    auto: true,
    enteredAt: Date.now(),
  })
  goTo('call', 'auto')
}

/** Arm the single pending timer for an auto move, respecting the minimum dwell. */
function arm(rule: Rule, from: SceneId, to: SceneId, extraMs: number) {
  if (mem.armed === rule && hasPending()) return
  const st = getState().story
  const delay = Math.max(0, st.enteredAt + DWELL_MS - Date.now()) + extraMs
  const key = mem.storyKey
  mem.armed = rule
  schedule(() => {
    mem.armed = null
    const now = getState().story
    if (mem.storyKey !== key || now.scene !== from || !now.auto || mem.fired[rule]) return
    mem.fired[rule] = true
    goTo(to, 'auto')
  }, delay)
}

function evaluate(s: State, mode: CallMode) {
  if (s.activeCallId && s.activeCallId !== mem.activeCallId) {
    mem.activeCallId = s.activeCallId
    startStory(s.activeCallId)
    return
  }
  if (!s.hydrated) return

  const story = s.story
  const dots: Story['dots'] = { ...story.dots }
  let dirty = false
  const light = (id: SceneId, v: 'new' | Verdict) => {
    if (story.scene !== id && dots[id] !== v) {
      dots[id] = v
      dirty = true
    }
  }

  // R2: a call started elsewhere lights the Call dot and never moves the stage
  if (s.calls !== mem.calls) {
    const first = !mem.knownCalls
    const known = (mem.knownCalls ??= new Set())
    for (const [id, c] of Object.entries(s.calls)) {
      if (known.has(id)) continue
      known.add(id)
      if (first || id === s.activeCallId || id === story.storyCallId || c?.ended || mode === 'starting') continue
      light('call', 'new')
    }
    mem.calls = s.calls
  }

  // a new SAR lights Investigation
  if (s.sars !== mem.sars) {
    const first = !mem.knownSars
    const known = (mem.knownSars ??= new Set())
    for (const id of Object.keys(s.sars)) {
      if (known.has(id)) continue
      known.add(id)
      if (!first) light('investigation', 'new')
    }
    mem.sars = s.sars
  }

  // a case moving to sar_drafted means a SAR is on its way (R4 may move before the sar event)
  if (s.cases !== mem.cases) {
    const first = !mem.caseStatus
    const seen = (mem.caseStatus ??= new Map())
    for (const [id, c] of Object.entries(s.cases)) {
      if (!first && c?.status === 'sar_drafted' && seen.get(id) !== 'sar_drafted') mem.caseDrafted = true
      seen.set(id, c?.status)
    }
    mem.cases = s.cases
  }

  // a DENIED row from this session lights Proof
  if (s.egress !== mem.egress) {
    const base = Math.max(s.egressBaseKey ?? Number.MAX_SAFE_INTEGER, mem.deniedKey)
    for (const r of s.egress) {
      if (r._k <= base) break
      if (r.verdict === 'DENIED') {
        light('proof', 'new')
        break
      }
    }
    if (s.egress[0]) mem.deniedKey = Math.max(mem.deniedKey, s.egress[0]._k)
    mem.egress = s.egress
  }

  // the story call's verdict colours the Decision dot
  const call = storyCallOf(s)
  const cv = verdictOf(call)
  const v = story.storyCallId ? cv : null
  if (v && v !== mem.lastVerdict) {
    mem.lastVerdict = v
    light('decision', v)
  }

  // the SAR on stage is chosen once per story, when Investigation is first shown with a SAR
  let shown = story.shownSarId
  let pinned: string | undefined
  if (story.scene === 'investigation' && !shown) {
    pinned = pickSar(s, call?.payee_check?.ring_id)
    shown = pinned
  }

  if (dirty || pinned) patchStory({ ...(dirty ? { dots } : {}), ...(pinned ? { shownSarId: pinned } : {}) })

  if (!story.auto) return
  if (story.scene === 'call' && !mem.fired.r3) {
    if (cv === 'HOLD' || cv === 'VERIFY' || (call?.ended && cv)) arm('r3', 'call', 'decision', 0)
  } else if (story.scene === 'decision' && !mem.fired.r4) {
    const sarReady = Object.keys(s.sars).length > 0 || mem.caseDrafted
    if (call?.banker_decision && call.ended && sarReady) arm('r4', 'decision', 'investigation', 3000)
  } else if (story.scene === 'investigation' && !mem.fired.r5) {
    if (shown && s.sars[shown]?.decision) arm('r5', 'investigation', 'proof', 2000)
  }
}

export function useDirector() {
  const { mode } = useCtl()
  const modeRef = useRef<CallMode>(mode)
  const prevMode = useRef<CallMode>(mode)

  // R1: the call controls leave idle (a replay or the mic is starting)
  useEffect(() => {
    const was = prevMode.current
    prevMode.current = mode
    modeRef.current = mode
    if (was === 'idle' && mode !== 'idle') startStory()
  }, [mode])

  useEffect(() => {
    const run = () => evaluate(getState(), modeRef.current)
    const unsub = subscribe(run)
    run()
    return unsub
  }, [])
}
