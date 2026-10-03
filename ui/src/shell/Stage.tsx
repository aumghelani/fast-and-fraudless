// The stage: the map underneath, then one scene at a time.
// A scene change is a quick speed-streak wipe along the rail direction (about 320 ms, once, nothing after).
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../lib/store'
import { useScene } from '../flow/story'
import { registry } from '../scenes/registry'
import { MapLayer } from '../scenes/watching/MapLayer'
import { DUR, EASE, usePrefersReducedMotion } from '../ui/tokens'
import { cx } from '../lib/format'

const STREAK_S = 0.32

// a slanted light band with a bright leading edge and a few faint speed lines
function streakStyle(dir: 1 | -1) {
  const a = dir > 0 ? 90 : 270
  return {
    background: [
      `linear-gradient(${a}deg, transparent 0%, color-mix(in srgb, var(--color-accent) 5%, transparent) 35%,` +
        ` color-mix(in srgb, var(--color-accent) 20%, transparent) 86%, rgb(230 234 239 / 0.5) 98.5%, transparent 100%)`,
      'repeating-linear-gradient(180deg, transparent 0 3.25rem, rgb(215 220 227 / 0.08) 3.25rem calc(3.25rem + 1px))',
    ].join(', '),
    maskImage: `linear-gradient(${a}deg, transparent 0%, #000 55%)`,
  }
}

export function Stage() {
  const scene = useScene()
  const dir = useStore((s) => s.story.dir)
  const details = useStore((s) => s.story.details)
  const reduced = usePrefersReducedMotion()
  const Scene = registry[scene].Stage

  const [streak, setStreak] = useState<{ id: number; dir: 1 | -1 } | null>(null)
  const last = useRef(scene)
  useEffect(() => {
    if (last.current === scene) return
    last.current = scene
    if (!reduced) setStreak({ id: Date.now(), dir })
  }, [scene, dir, reduced])

  const enter = reduced
    ? { opacity: 1, transition: { duration: 0.15 } }
    : { opacity: 1, x: '0rem', transition: { duration: 0.3, ease: EASE, delay: 0.06 } }
  const exit = { opacity: 0, transition: { duration: 0.15 } }

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={{ opacity: details ? 0.35 : 1 }}
        transition={{ duration: DUR.fast }}
      >
        <MapLayer active={scene === 'watching'} />
        <AnimatePresence initial={false}>
          <motion.div
            key={scene}
            // in Watching, empty parts of the stage let the pointer through to the map
            className={cx('absolute inset-0', scene === 'watching' && 'pointer-events-none')}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: `${dir * 1.5}rem` }}
            animate={enter}
            exit={exit}
          >
            <Scene />
          </motion.div>
        </AnimatePresence>
        {streak && (
          <motion.div
            key={streak.id}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-[45%]"
            initial={{ x: streak.dir > 0 ? '-100%' : '222%', opacity: 0 }}
            animate={{ x: streak.dir > 0 ? '222%' : '-100%', opacity: [0, 1, 1, 0] }}
            transition={{ duration: STREAK_S, ease: [0.4, 0, 0.2, 1], opacity: { duration: STREAK_S, times: [0, 0.12, 0.75, 1] } }}
            onAnimationComplete={() => setStreak((s) => (s && s.id === streak.id ? null : s))}
          >
            <div className="decal h-full w-full" style={streakStyle(streak.dir)} />
          </motion.div>
        )}
      </motion.div>
    </main>
  )
}
