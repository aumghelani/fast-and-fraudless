// Details drawer: everything raw for the current scene, on the right. Closes on Esc, D, outside click or scene change.
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../lib/store'
import { sceneLabel } from '../flow/scenes'
import { setDetails, useScene } from '../flow/story'
import { registry } from '../scenes/registry'
import { Eyebrow, Kbd } from '../ui/primitives'
import { DUR, EASE } from '../ui/tokens'

export function DetailsDrawer() {
  const current = useScene()
  const open = useStore((s) => s.story.details)
  const ref = useRef<HTMLElement>(null)
  // keep the scene the drawer opened on while it fades out after a scene change
  const opened = useRef(current)
  if (open) opened.current = current
  const scene = opened.current
  const Details = registry[scene].Details

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || ref.current?.contains(t) || t.closest?.('[data-details-toggle]')) return
      setDetails(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="details"
          ref={ref}
          aria-label={`${sceneLabel(scene)} details`}
          className="fixed top-18 right-0 bottom-0 z-30 flex w-150 flex-col border-l border-line bg-surface"
          initial={{ opacity: 0, x: '1.5rem' }}
          animate={{ opacity: 1, x: '0rem', transition: { duration: 0.32, ease: EASE } }}
          exit={{ opacity: 0, transition: { duration: DUR.fast } }}
        >
          <div className="flex shrink-0 items-center justify-between px-8 pt-8 pb-6">
            <Eyebrow>Details · {sceneLabel(scene)}</Eyebrow>
            <button
              className="inline-flex items-center gap-2 rounded-lg text-meta text-mute transition-colors duration-200 hover:text-ink-2"
              onClick={() => setDetails(false)}
            >
              Close <Kbd>Esc</Kbd>
            </button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-8 pb-8 text-body">
            <Details />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
