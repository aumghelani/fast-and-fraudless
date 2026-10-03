// System overlays: a steady red frame while offline, and a queue of white toasts (restored, self-healed).
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../lib/store'
import { EASE } from '../ui/tokens'

interface Toast {
  id: number
  text: string
}

let toastSeq = 0

function OfflineFrame() {
  const online = useStore((s) => s.net?.online)
  return (
    <AnimatePresence>
      {online === false && (
        <motion.div
          key="offline"
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 border-2 border-hold"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.3 } }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        />
      )}
    </AnimatePresence>
  )
}

function Toasts() {
  const [queue, setQueue] = useState<Toast[]>([])
  const push = (text: string) => setQueue((q) => [...q, { id: ++toastSeq, text }])

  // restored: health.restored turns true, or a new process (uptime drops) that restored again
  const hydrated = useStore((s) => s.hydrated)
  const restored = useStore((s) => s.health?.restored)
  const uptime = useStore((s) => s.health?.uptime_s)
  const seen = useRef<{ restored?: boolean; uptime?: number } | null>(null)
  useEffect(() => {
    if (!hydrated) return
    const prev = seen.current
    seen.current = { restored, uptime }
    if (!prev) return // first value is the baseline
    const restarted = prev.uptime != null && uptime != null && uptime < prev.uptime
    if (restored && (!prev.restored || restarted)) {
      push('Restored from MongoDB after a restart · rings, cases, SARs and calls reloaded')
    }
  }, [hydrated, restored, uptime])

  // self-healed: recoveries rise above the last value seen
  const recoveries = useStore((s) => s.watchdog?.recoveries)
  const last = useStore((s) => s.watchdog?.last_recovery)
  const lastSeen = useRef<number | null>(null)
  useEffect(() => {
    if (recoveries == null) return
    const prev = lastSeen.current
    lastSeen.current = recoveries
    if (prev == null || recoveries <= prev) return
    const target = (last?.target || '').trim()
    const action = (last?.action || '').trim()
    const what = target && action && !action.includes(target) ? `${target} ${action}` : action || target || 'a service restarted'
    push(`Self-healed · ${what}`)
  }, [recoveries, last])

  // one toast at a time, 6 s each
  const current = queue[0]
  useEffect(() => {
    if (!current) return
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), 6000)
    return () => window.clearTimeout(t)
  }, [current])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center" role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={current.id}
            className="card flex items-center gap-3 px-5 py-3 border border-line font-mono text-meta text-ink"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.3 } }}
          >
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            {current.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SystemOverlays() {
  return (
    <>
      <OfflineFrame />
      <Toasts />
    </>
  )
}
