// The stage: the map underneath, then one scene at a time. Scenes slide along the rail direction.
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../lib/store'
import { useScene } from '../flow/story'
import { registry } from '../scenes/registry'
import { MapLayer } from '../scenes/watching/MapLayer'
import { DUR, EASE, usePrefersReducedMotion } from '../ui/tokens'
import { cx } from '../lib/format'

export function Stage() {
  const scene = useScene()
  const dir = useStore((s) => s.story.dir)
  const details = useStore((s) => s.story.details)
  const reduced = usePrefersReducedMotion()
  const Scene = registry[scene].Stage

  const enter = reduced
    ? { opacity: 1, transition: { duration: 0.15 } }
    : { opacity: 1, x: '0rem', transition: { duration: DUR.base, ease: EASE, delay: 0.08 } }
  const exit = { opacity: 0, transition: { duration: reduced ? 0.15 : DUR.fast } }

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
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
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: `${dir * 2}rem` }}
            animate={enter}
            exit={exit}
          >
            <Scene />
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </main>
  )
}
