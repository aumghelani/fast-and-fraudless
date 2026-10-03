// The step rail: six slanted decal steps. One highlight glides to the active step (transform only),
// visited steps get a check, and news for another scene shows as a small dot.
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
      {bar && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-0 w-px origin-left rounded-sm border-b-2 border-accent bg-accent/15"
          style={{
            transform: `translateX(${bar.x}px) skewX(-8deg) scaleX(${bar.w})`,
            transition: 'transform 400ms var(--ease-calm)',
          }}
        />
      )}
      {SCENES.map((s, i) => {
        const on = i === active
        const seen = !on && !!story.visited[s.id]
        const dot = story.dots[s.id]
        return (
          <div key={s.id} className="flex items-center">
            {i > 0 && <span aria-hidden className="decal mx-1 h-4 w-px bg-line-2" />}
            <button
              ref={(el) => {
                items.current[i] = el
              }}
              aria-current={on ? 'step' : undefined}
              onClick={() => goTo(s.id)}
              className={cx(
                'relative flex h-11 items-center rounded-sm px-4 font-num text-lead uppercase leading-none tracking-[0.06em] transition-colors duration-300',
                on ? 'text-ink' : seen ? 'text-ink-2 hover:text-ink' : 'text-mute hover:text-ink-2',
              )}
            >
              <span className="decal flex items-center gap-2 pt-1">
                <span className={on ? 'font-bold text-accent' : 'font-semibold opacity-70'}>{i + 1}</span>
                <span className={on ? 'font-bold' : 'font-semibold'}>{s.label}</span>
                {seen && <Check aria-label="visited" className="-mt-1 h-3.5 w-3.5 text-mute" strokeWidth={2.5} />}
              </span>
              {dot && !on && (
                <span
                  aria-label="new"
                  className="absolute top-1.5 right-1 h-1.5 w-1.5 rounded-full"
                  style={{ background: dotColor(dot) }}
                />
              )}
            </button>
          </div>
        )
      })}
    </nav>
  )
}
