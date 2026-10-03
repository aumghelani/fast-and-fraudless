// Proof: nothing about the customer leaves the bank, counted from the OpenShell egress log, plus a live leak test.
import { useMemo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '../lib/store'
import { DASH, cx, num, toDate } from '../lib/format'
import { Button, Card, Kbd } from './kit'
import { runExfil } from './controls'
import { usePrefersReducedMotion } from './selectors'
import { egressSummary } from './agent/egress'

const EASE = [0.22, 1, 0.36, 1] as const

function hhmm(t?: string | number | null): string {
  const d = toDate(t)
  return d ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : DASH
}

export function ProofCard() {
  const counters = useStore((s) => s.counters)
  const watchdog = useStore((s) => s.watchdog)
  const egress = useStore((s) => s.egress)
  const base = useStore((s) => s.egressBaseKey)
  const hydrated = useStore((s) => s.hydrated)
  const running = useStore((s) => s.exfil.status === 'running')
  const { denied, deniedLive } = useMemo(() => egressSummary(egress, base), [egress, base])

  const out = counters?.customer_data_out
  const deniedTotal = counters?.denied_total ?? (hydrated ? denied : undefined)
  const rec = watchdog?.recoveries
  const lastRec = watchdog?.last_recovery?.ts

  return (
    <Card title="Nothing leaves the box" right="OpenShell" className="h-full" bodyClassName="flex min-h-0 flex-col px-5 pb-3 pt-2">
      <div className="flex shrink-0 items-center gap-5">
        <span
          className={cx(
            'tnum font-mono text-[52px] font-semibold leading-none tracking-tight',
            out == null ? 'text-faint' : out === 0 ? 'text-clear' : 'text-hold',
          )}
        >
          {num(out)}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[16px] text-ink">customer records sent out</span>
          <span className="truncate text-[13px] text-mute">counted from the egress log on the box</span>
        </div>
      </div>

      <div className="mt-3 grid shrink-0 grid-cols-2 gap-4 border-t border-line pt-2.5">
        <Stat value={num(deniedTotal)} label="denied attempts" />
        <Stat value={num(rec)} aside={lastRec ? `last ${hhmm(lastRec)}` : undefined} label={`automatic ${rec === 1 ? 'recovery' : 'recoveries'}`} />
      </div>

      <div className="mt-auto flex shrink-0 flex-col gap-2 rounded-xl bg-surface-2 px-3 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" className="shrink-0" disabled={running} onClick={() => void runExfil()}>
            Leak test <Kbd>E</Kbd>
          </Button>
          <LeakResult destLive={deniedLive} />
        </div>
      </div>
    </Card>
  )
}

function Stat({ value, label, aside }: { value: ReactNode; label: string; aside?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-baseline gap-2">
        <span className="tnum font-mono text-[22px] font-medium leading-tight text-ink">{value}</span>
        {aside && <span className="tnum truncate font-mono text-[13px] text-mute">{aside}</span>}
      </span>
      <span className="truncate font-mono text-[12px] uppercase tracking-[0.06em] text-mute">{label}</span>
    </div>
  )
}

/** One calm line for the leak test result, from store.exfil and the newest live DENIED egress row. */
function LeakResult({ destLive }: { destLive?: { _k: number; dest?: string | null; policy?: string | null } }) {
  const exfil = useStore((s) => s.exfil)
  const reduced = usePrefersReducedMotion()

  let key: string
  let body: ReactNode
  if (exfil.status === 'running') {
    key = 'running'
    body = <span className="text-ink-2">Trying to send data out…</span>
  } else if ((exfil.status === 'done' && exfil.blocked !== false) || (exfil.status === 'idle' && destLive)) {
    const denied = exfil.blocked === true || !!destLive
    key = `done-${destLive?._k ?? 'x'}-${denied}`
    body = denied ? (
      <span className="flex min-w-0 flex-col">
        <span className="font-mono text-[14px] font-medium text-clear">DENIED by OpenShell policy</span>
        {destLive?.dest && <span className="truncate font-mono text-[12px] text-mute">{destLive.dest}</span>}
      </span>
    ) : (
      <span className="text-ink-2">Finished · no block reported yet</span>
    )
  } else if (exfil.status === 'done') {
    key = 'leak'
    body = <span className="font-medium text-hold">The request was not blocked</span>
  } else if (exfil.status === 'error') {
    key = 'error'
    body = (
      <span className="text-ink-2" title={exfil.message}>
        Could not reach the sandbox · try again
      </span>
    )
  } else {
    key = 'idle'
    body = <span className="text-mute">The sandbox tries to send data out</span>
  }

  return (
    <div className="min-w-0 flex-1 text-[14px]" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          className="truncate"
          initial={{ opacity: 0, y: reduced ? 0 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.25, ease: EASE }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
