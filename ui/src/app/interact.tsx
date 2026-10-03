// Interaction helpers: sections that minimise into a summary bar, and cards that expand into a large view.
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Maximize2, X } from 'lucide-react'
import { cx } from '../lib/format'

export const EASE = [0.22, 1, 0.36, 1] as const

/** Remembered open/closed state (per viewer; falls back to open). */
export function useOpen(id: string, initial = true): [boolean, () => void] {
  const key = `ff.open.${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key)
      return v == null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1')
      } catch {
        /* private mode */
      }
      return !o
    })
  return [open, toggle]
}

export const BAR_H = 48

/** A section with a quiet label row. Closed, it becomes a white bar with a one-line summary. */
export function Section({ title, summary, open, onToggle, height, children }: {
  title: string
  summary?: ReactNode
  open: boolean
  onToggle: () => void
  height: number
  children: ReactNode
}) {
  const was = useRef(open)
  const toggled = was.current !== open
  useEffect(() => {
    was.current = open
  })
  return (
    <motion.section
      className="flex min-h-0 flex-col overflow-hidden"
      initial={false}
      animate={{ height }}
      transition={{ duration: toggled ? 0.42 : 0, ease: EASE }}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={cx(
          'group flex shrink-0 items-center gap-4 text-left transition-colors',
          open ? 'h-8 px-1' : 'card h-12 px-5 hover:bg-surface-2',
        )}
      >
        <span className="shrink-0 font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-ink-2">{title}</span>
        <AnimatePresence initial={false}>
          {!open && summary != null && (
            <motion.span
              key="sum"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="min-w-0 flex-1 truncate font-mono text-[14px] text-ink"
            >
              {summary}
            </motion.span>
          )}
        </AnimatePresence>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[13px] text-mute group-hover:text-ink">
          {open ? 'Minimise' : 'Expand'}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease: EASE }} className="inline-flex">
            <ChevronDown className="size-4" />
          </motion.span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            className="mt-1 min-h-0 flex-1 px-1 pb-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: 0.35, ease: EASE, delay: 0.08 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

/** A card slot you can click to open in a large view. Clicks on buttons inside the card still work. */
export function Expandable({ id, children }: { id: string; children: ReactNode }) {
  const [big, setBig] = useState(false)
  useEffect(() => {
    if (!big) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopPropagation()
        setBig(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [big])
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, kbd')) return
    setBig(true)
  }
  return (
    <>
      <motion.div
        layoutId={`card-${id}`}
        onClick={open}
        whileHover={{ y: -3 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="group relative h-full min-h-0 cursor-zoom-in"
        style={{ visibility: big ? 'hidden' : 'visible' }}
      >
        {children}
        <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-surface/90 px-2 py-1 font-mono text-[12px] text-mute opacity-0 shadow-card transition-opacity group-hover:opacity-100">
          <Maximize2 className="size-3" /> expand
        </span>
      </motion.div>
      <AnimatePresence>
        {big && (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-50 grid place-items-center bg-ink/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setBig(false)}
          >
            <motion.div
              layoutId={`card-${id}`}
              className="relative h-[620px] w-[min(980px,90vw)]"
              onClick={(e) => e.stopPropagation()}
              transition={{ duration: 0.4, ease: EASE }}
            >
              {children}
              <button
                onClick={() => setBig(false)}
                className="absolute -top-12 right-0 inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 font-mono text-[13px] text-ink-2 shadow-card hover:text-ink"
              >
                <X className="size-4" /> Close · Esc
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
