// The same frame for every scene: headline top-left, a 12-column body, and a quiet bottom bar.
import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { SCENES, sceneIndex } from '../flow/scenes'
import { next, setAuto, toggleDetails } from '../flow/story'
import { Kbd } from '../ui/primitives'

export function SceneFrame({ headline, subline, actions, children }: {
  headline: ReactNode; subline?: ReactNode; actions?: ReactNode; children?: ReactNode
}) {
  const auto = useStore((s) => s.story.auto)
  const scene = useStore((s) => s.story.scene)
  const upNext = SCENES[sceneIndex(scene) + 1]
  return (
    <div className="flex h-full min-h-0 flex-col px-12 pt-10 pb-6">
      <header className="mb-10 shrink-0">
        {typeof headline === 'string' ? (
          <h1 className="font-race text-title text-ink">{headline}</h1>
        ) : (
          headline
        )}
        {subline != null && <p className="mt-2 text-body text-ink-2">{subline}</p>}
      </header>
      <div className="grid-12 min-h-0 flex-1 [&>*]:pointer-events-auto">{children}</div>
      <footer className="mt-6 flex h-10 shrink-0 items-center gap-6 text-meta text-mute [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <button
          className="rounded-lg px-1 transition-colors duration-200 hover:text-ink-2"
          onClick={() => setAuto(!auto)}
          title="Auto-advance between scenes on real events"
        >
          {auto ? 'Auto' : 'Manual'} · A
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">{actions}</div>
        {upNext && (
          <button className="rounded-lg px-1 transition-colors duration-200 hover:text-ink-2" onClick={next}>
            Next: {upNext.label} →
          </button>
        )}
        <button
          data-details-toggle
          className="inline-flex items-center gap-2 rounded-lg px-1 transition-colors duration-200 hover:text-ink-2"
          onClick={toggleDetails}
        >
          Details <Kbd>D</Kbd>
        </button>
      </footer>
    </div>
  )
}
