// Story state: which scene is on stage, auto-advance, rail dots, the details drawer, the leak test.
// It lives in the store; the director's one pending timer lives here in module scope.
import { api } from '../lib/api'
import { getState, patchLocal, useStore } from '../lib/store'
import { SCENES, sceneIndex, type SceneId } from './scenes'

export interface Story {
  scene: SceneId
  dir: 1 | -1
  auto: boolean
  enteredAt: number
  storyCallId?: string
  shownSarId?: string
  visited: Partial<Record<SceneId, true>>
  dots: Partial<Record<SceneId, 'new' | 'HOLD' | 'VERIFY' | 'NO_HOLD'>>
  details: boolean
  help: boolean
}

export interface ExfilState {
  status: 'idle' | 'running' | 'done' | 'error'
  at?: number
  blocked?: boolean | null
  message?: string
}

export function initialStory(): Story {
  return {
    scene: 'watching', dir: 1, auto: true, enteredAt: Date.now(), visited: { watching: true }, dots: {},
    details: false, help: false,
  }
}

export function useStory(): Story {
  return useStore((s) => s.story)
}

export function useScene(): SceneId {
  return useStore((s) => s.story.scene)
}

export function patchStory(p: Partial<Story>) {
  patchLocal({ story: { ...getState().story, ...p } })
}

// --- the director's single pending timer
let pending: number | undefined

export function schedule(fn: () => void, ms: number) {
  cancelPending()
  pending = window.setTimeout(() => {
    pending = undefined
    fn()
  }, Math.max(0, ms))
}

export function cancelPending() {
  if (pending !== undefined) {
    window.clearTimeout(pending)
    pending = undefined
  }
}

export function hasPending() {
  return pending !== undefined
}

/** Move the stage. A manual move turns auto-advance off and cancels any pending auto move. */
export function goTo(id: SceneId, how: 'manual' | 'auto' = 'manual') {
  if (sceneIndex(id) < 0) return
  if (how === 'manual') cancelPending()
  const s = getState().story
  const dots = { ...s.dots }
  delete dots[id]
  const moved = id !== s.scene
  patchStory({
    scene: id,
    dir: moved ? (sceneIndex(id) >= sceneIndex(s.scene) ? 1 : -1) : s.dir,
    enteredAt: moved ? Date.now() : s.enteredAt,
    visited: { ...s.visited, [id]: true },
    dots,
    details: false,
    ...(how === 'manual' ? { auto: false } : {}),
  })
}

export function next() {
  const i = sceneIndex(getState().story.scene)
  if (i < SCENES.length - 1) goTo(SCENES[i + 1].id)
}

export function prev() {
  const i = sceneIndex(getState().story.scene)
  if (i > 0) goTo(SCENES[i - 1].id)
}

export function setAuto(on: boolean) {
  if (!on) cancelPending()
  patchStory({ auto: on })
}

export function setDetails(open: boolean) {
  if (getState().story.details !== open) patchStory({ details: open })
}

export function toggleDetails() {
  patchStory({ details: !getState().story.details })
}

export function setHelp(open: boolean) {
  if (getState().story.help !== open) patchStory({ help: open })
}

/** Ask the sandboxed agent to send data out; the DENIED line arrives on the egress stream. */
export async function runExfil() {
  if (getState().exfil.status === 'running') return
  patchLocal({ exfil: { status: 'running', at: Date.now() } })
  try {
    const r = await api.exfil()
    patchLocal({ exfil: { status: 'done', at: Date.now(), blocked: r?.blocked ?? null, message: r?.error } })
  } catch (e) {
    patchLocal({ exfil: { status: 'error', at: Date.now(), message: String((e as Error)?.message || e) } })
  }
}

if (import.meta.env.DEV) (window as any).__ffGo = (id: SceneId) => goTo(id)
