import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DatabaseBackup } from 'lucide-react'
import { useStore } from '../lib/store'

/** "STATE RESTORED FROM MONGODB" while health.restored is true, auto-hides after a few seconds. */
export function RestoredBanner() {
  const restored = useStore((s) => s.health?.restored)
  const uptime = useStore((s) => s.health?.uptime_s)
  const [show, setShow] = useState(false)
  const shownFor = useRef<boolean>(false)
  useEffect(() => {
    if (restored && !shownFor.current) {
      shownFor.current = true
      setShow(true)
      const t = setTimeout(() => setShow(false), 9000)
      return () => clearTimeout(t)
    }
    if (!restored) shownFor.current = false
  }, [restored])
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="pointer-events-none fixed top-[6.2rem] left-1/2 z-50 -translate-x-1/2"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-nv/60 bg-[#0b1206]/90 px-6 py-3 shadow-[0_0_50px_rgba(118,185,0,0.35)] backdrop-blur">
            <DatabaseBackup className="h-6 w-6 text-nv" />
            <div>
              <div className="text-[1.15rem] font-black tracking-[0.14em] text-nv">STATE RESTORED FROM MONGODB</div>
              <div className="text-[0.72rem] text-ink-2">backend restarted{uptime != null ? ` ${uptime}s ago` : ''}; rings, cases, SARs and calls reloaded, change streams resumed</div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Full-screen red edge flash when the box goes OFFLINE (one-shot, on the event only). */
export function OfflineFlash() {
  const at = useStore((s) => s.netChangedAt)
  const online = useStore((s) => s.net?.online)
  const [k, setK] = useState(0)
  useEffect(() => {
    if (at && online === false) setK((x) => x + 1)
  }, [at, online])
  return (
    <AnimatePresence>
      {k > 0 && online === false && (
        <motion.div
          key={k}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.35, 0.8, 0] }}
          transition={{ duration: 2.4, times: [0, 0.12, 0.35, 0.5, 1] }}
          className="pointer-events-none fixed inset-0 z-40"
          style={{ boxShadow: 'inset 0 0 0 4px #ff3b3b, inset 0 0 160px rgba(255,59,59,0.45)' }}
        />
      )}
    </AnimatePresence>
  )
}
