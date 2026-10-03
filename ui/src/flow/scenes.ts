// The six scenes in rail order. The rail key for a scene is its index + 1.
export type SceneId = 'watching' | 'call' | 'decision' | 'investigation' | 'proof' | 'results'

export const SCENES: readonly { id: SceneId; label: string }[] = [
  { id: 'watching', label: 'Watching' },
  { id: 'call', label: 'Call' },
  { id: 'decision', label: 'Decision' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'proof', label: 'Proof' },
  { id: 'results', label: 'Results' },
]

export function sceneIndex(id: SceneId): number {
  return SCENES.findIndex((s) => s.id === id)
}

export function sceneLabel(id: SceneId): string {
  return SCENES[sceneIndex(id)]?.label ?? id
}
