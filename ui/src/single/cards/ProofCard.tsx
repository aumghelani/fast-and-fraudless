// Proof: nothing about the customer leaves the box. Counted from the OpenShell egress log, plus the live leak test.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { runExfil } from '../../flow/story'
import { useStore } from '../../lib/store'
import { DASH, num, toDate } from '../../lib/format'
import { egressSummary } from '../../scenes/proof/egressSummary'
import { EASE, usePrefersReducedMotion } from '../../ui/tokens'
import { BTN_GHOST, Card, KeyHint } from './kit'

function hhmm(t?: string | number | null): string {
  const d = toDate(t)
  return d ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : DASH
}

/** One line: the live DENIED row, or where the leak test stands. Same states as scenes/proof/LeakTest.tsx. */
function LeakResult() {
  const reduced = usePrefersReducedMotion()
  const egress = useStore((s) => s.egress)
  const base = useStore((s) => s.egressBaseKey)
  const exfil = useStore((s) => s.exfil)
  const { deniedLive } = useMemo(() => egressSummary(egress, base), [egress, base])

  if (exfil.status === 'running') return <span className="text-[0.8125rem] text-ink-2">Trying…</span>
  if (deniedLive) {
    const why = [deniedLive.policy, deniedLive.reason].filter(Boolean).join(' · ') || 'Logged by OpenShell'
    return (
      <motion.span
        key={deniedLive._k}
        title={why}
        className="flex min-w-0 items-baseline gap-2 font-mono text-[0.8125rem]"
        initial={reduced ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <span className="shrink-0 font-semibold text-hold">DENIED</span>
        <span className="truncate text-ink">{deniedLive.dest ?? DASH}</span>
      </motion.span>
    )
  }
  if (exfil.status === 'error') {
    return (
      <span className="truncate text-[0.8125rem] text-ink-2" title={exfil.message}>
        Could not reach the sandbox. Try again.
      </span>
    )
  }
  if (exfil.status === 'done' && exfil.blocked === true) {
    return <span className="truncate text-[0.8125rem] text-ink-2">Blocked · waiting for the log line…</span>
  }
  if (exfil.status === 'done' && exfil.blocked === false) {
    return <span className="truncate text-[0.8125rem] text-hold">The request was not blocked</span>
  }
  return <span className="truncate text-[0.8125rem] text-mute">The sandboxed agent tries to send data out</span>
}

export function ProofCard() {
  const counters = useStore((s) => s.counters)
  const watchdog = useStore((s) => s.watchdog)
  const running = useStore((s) => s.exfil.status === 'running')
  const rec = watchdog?.recoveries
  const last = watchdog?.last_recovery

  const healing = `automatic ${rec === 1 ? 'recovery' : 'recoveries'}${last?.ts ? ` · last ${hhmm(last.ts)}` : ''}`

  return (
    <Card title="Nothing leaves the box">
      <div className="flex shrink-0 items-end gap-4">
        <span className="tnum font-mono text-[3.25rem] font-medium leading-[0.85] text-ink">{num(counters?.customer_data_out)}</span>
        <span className="pb-0.5 text-sm text-ink-2">customer records sent out</span>
      </div>

      <div className="mt-4 flex shrink-0 flex-col gap-1.5 text-[0.8125rem] text-ink-2">
        <div className="flex items-baseline gap-2">
          <span className="tnum w-12 shrink-0 font-mono text-ink">{num(counters?.denied_total)}</span>
          <span>outbound attempts denied</span>
        </div>
        <div className="flex items-baseline gap-2" title={last ? [last.target, last.action, last.reason].filter(Boolean).join(' · ') : undefined}>
          <span className="tnum w-12 shrink-0 font-mono text-ink">{num(rec)}</span>
          <span className="truncate">{healing}</span>
        </div>
      </div>

      <div className="mt-auto flex shrink-0 items-center gap-3 border-t border-line pt-3">
        <button type="button" className={BTN_GHOST} disabled={running} onClick={() => void runExfil()}>
          Leak test <KeyHint>E</KeyHint>
        </button>
        <div className="flex min-w-0 flex-1" aria-live="polite">
          <LeakResult />
        </div>
      </div>
    </Card>
  )
}
