// The leak test: the sandboxed agent tries to send data out, and the live DENIED line shows the result.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { runExfil } from '../../flow/story'
import { useStore } from '../../lib/store'
import { DASH, num } from '../../lib/format'
import { Button } from '../../ui/primitives'
import { EASE } from '../../ui/tokens'
import { egressSummary } from './egressSummary'

export function LeakTest() {
  const egress = useStore((s) => s.egress)
  const base = useStore((s) => s.egressBaseKey)
  const exfil = useStore((s) => s.exfil)
  const hydrated = useStore((s) => s.hydrated)
  const { polls, otherAllowed, deniedLive } = useMemo(() => egressSummary(egress, base), [egress, base])
  const running = exfil.status === 'running'

  let result
  if (running) {
    result = <div className="text-lead text-ink-2">Trying…</div>
  } else if (deniedLive) {
    const why = [deniedLive.policy, deniedLive.reason].filter(Boolean).join(' · ') || 'Logged by OpenShell'
    result = (
      <motion.div
        key={deniedLive._k}
        className="flex flex-col gap-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <div className="flex items-baseline gap-4">
          <span className="font-num text-title font-bold leading-none text-hold">DENIED</span>
          <span className="min-w-0 truncate font-mono text-lead text-ink">{deniedLive.dest ?? DASH}</span>
        </div>
        <div className="truncate text-body text-ink-2" title={why}>
          {why}
        </div>
      </motion.div>
    )
  } else if (exfil.status === 'error') {
    result = (
      <div className="text-body text-ink-2" title={exfil.message}>
        The leak test could not reach the sandbox. Try again.
      </div>
    )
  } else if (exfil.status === 'done' && exfil.blocked === true) {
    result = <div className="text-body text-ink-2">Blocked by the sandbox · waiting for the log line…</div>
  } else if (exfil.status === 'done' && exfil.blocked === false) {
    result = <div className="text-body text-hold">The request was not blocked</div>
  } else {
    result = <div className="text-body text-ink-2">No leak attempt yet in this session. Press E to try one.</div>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-8 rounded-xl border border-line bg-surface p-8">
        <p className="text-body text-ink">The sandboxed agent tries to send data to the internet.</p>
        <div>
          <Button variant="primary" size="lg" kbd="E" disabled={running} onClick={() => void runExfil()}>
            Simulate exfiltration
          </Button>
        </div>
        <div className="h-24 overflow-hidden" aria-live="polite">
          {result}
        </div>
      </div>
      <div className="flex flex-col gap-1 px-1 text-meta text-mute">
        <span>Telegram long-poll · {hydrated ? num(polls) : DASH} allowed · content-free</span>
        <span>Other allowed events · {hydrated ? num(otherAllowed) : DASH}</span>
      </div>
    </div>
  )
}
