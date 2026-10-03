// The step rail: six scenes, one underline that glides to the active step, checks for visited, dots for news.
import { useLayoutEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { SCENES } from '../flow/scenes'
import { goTo, useStory } from '../flow/story'
import { cx } from '../lib/format'
import { VERDICT } from '../ui/tokens'

function dotColor(d: 'new' | 'HOLD' | 'VERIFY' | 'NO_HOLD') {
  return d === 'new' ? 'var(--color-accent)' : VERDICT[d].color
}

export function StepRail() {
  const story = useStory()
  const nav = useRef<HTMLElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null)
  const active = SCENES.findIndex((s) => s.id === story.scene)

  // measure the active step; again when fonts load or the window resizes
  useLayoutEffect(() => {
    const measure = () => {
      const el = items.current[active]
      if (!el) return
      setBar((b) => (b && b.x === el.offsetLeft && b.w === el.offsetWidth ? b : { x: el.offsetLeft, w: el.offsetWidth }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (nav.current) ro.observe(nav.current)
    document.fonts?.ready.then(measure).catch(() => {})
    return () => ro.disconnect()
  }, [active])

  return (
    <nav ref={nav} aria-label="Story steps" className="relative flex items-center">
      {SCENES.map((s, i) => {
        const on = i === active
        const seen = !on && !!story.visited[s.id]
        const dot = story.dots[s.id]
        return (
          <div key={s.id} className="flex items-center">
            {i > 0 && <span aria-hidden className="mx-4 h-px w-6 bg-line-2" />}
            <button
              ref={(el) => {
                items.current[i] = el
              }}
              aria-current={on ? 'step' : undefined}
              onClick={() => goTo(s.id)}
              className={cx(
                'relative flex h-12 items-center gap-2 rounded-lg px-1 text-body transition-colors duration-300',
                on ? 'text-ink' : seen ? 'text-ink-2 hover:text-ink' : 'text-mute hover:text-ink-2',
              )}
            >
              <span className="font-mono text-meta opacity-70">{i + 1}</span>
              <span className={on ? 'font-semibold' : undefined}>{s.label}</span>
              {seen && <Check aria-label="visited" className="h-3.5 w-3.5 text-mute" strokeWidth={2.5} />}
              {dot && !on && (
                <span
                  aria-label="new"
                  className="absolute top-1.5 -right-1.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: dotColor(dot) }}
                />
              )}
            </button>
          </div>
        )
      })}
      {bar && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left rounded-full bg-accent"
          style={{
            transform: `translateX(${bar.x}px) scaleX(${bar.w})`,
            transition: 'transform 400ms var(--ease-calm)',
          }}
        />
      )}
    </nav>
  )
}
