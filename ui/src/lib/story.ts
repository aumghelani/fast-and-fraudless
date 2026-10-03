// Local UI state types kept by the store (the page itself no longer has scenes).
export type SceneId = 'watching' | 'call' | 'decision' | 'investigation' | 'proof' | 'results'

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
