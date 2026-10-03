// Why this decision: the wire queue, the proof that nothing leaves the box, and the decision.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { Landmark, PhoneCall } from 'lucide-react'
import type { Call } from '../lib/types'
import { cx } from '../lib/format'
import { BorderBeam } from '../components/magicui/border-beam'
import { patchLocal } from '../lib/store'
import { useActiveCall, useCallsNewestFirst, usePrefersReducedMotion, verdictOf } from './selectors'
import { ProofCard } from './ProofCard'
import { STATUS_TEXT, checksOf, customerName, riskIndex, statusOf, wireTitle, type QueueStatus } from './pipeline/checks'
import { DecisionPanel } from './pipeline/Panels'

const TONE: Record<QueueStatus, { icon: string; text: string }> = {
  processing: { icon: 'bg-accent-soft text-accent', text: 'text-accent' },
  HOLD: { icon: 'bg-hold-soft text-hold', text: 'text-hold' },
  VERIFY: { icon: 'bg-verify-soft text-verify', text: 'text-verify' },
  NO_HOLD: { icon: 'bg-clear-soft text-clear', text: 'text-clear' },
  unscreened: { icon: 'bg-surface-2 text-mute', text: 'text-mute' },
}

function QueueCard({ call, active }: { call: Call; active: boolean }) {
  const st = statusOf(call)
  const reduced = usePrefersReducedMotion()
  const Icon = st === 'processing' ? PhoneCall : Landmark
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: active ? 1 : 0.55, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cx('card relative flex h-[80px] shrink-0 items-center gap-4 overflow-hidden px-4',
        active ? 'ring-1 ring-accent/50' : '')}
    >
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-300', TONE[st].icon)}>
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 font-mono text-[15.5px] font-medium text-ink tnum">{wireTitle(call)}</span>
          <span className="truncate text-[14px] text-mute">{customerName(call)}</span>
        </div>
        <div className={cx('mt-1 flex items-center gap-1.5 font-mono text-[13.5px]', TONE[st].text)}>
          <span className="size-1.5 rounded-full bg-current" />
          {STATUS_TEXT[st]}
        </div>
      </div>
      {active && st === 'processing' && !reduced && (
        <BorderBeam size={70} duration={5} colorFrom="#4f46e5" colorTo="#c7c4fb" borderWidth={1.5} />
      )}
    </motion.div>
  )
}

function SkeletonCard({ i }: { i: number }) {
  return (
    <div className="card flex h-[76px] shrink-0 items-center gap-4 px-4" style={{ opacity: 0.5 - i * 0.12 }}>
      <span className="size-10 shrink-0 rounded-full bg-surface-2" />
      <div className="flex-1 space-y-2.5">
        <div className="h-2.5 w-2/5 rounded-full bg-surface-2" />
        <div className="h-2 w-3/5 rounded-full bg-surface-2" />
      </div>
    </div>
  )
}

export function Pipeline() {
  const calls = useCallsNewestFirst()
  const active = useActiveCall()
  const queue = calls.slice(0, 3)
  if (active && !queue.some((c) => c.call_id === active.call_id)) queue.splice(2, 1, active)
  const checks = useMemo(() => (active ? checksOf(active) : []), [active])
  const flagged = checks.filter((c) => c.tone === 'flag').length
  const risk = riskIndex(verdictOf(active), flagged)
  const activeId = active?.call_id

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,26fr)_minmax(0,36fr)_minmax(0,38fr)] gap-x-4">
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex h-[20px] items-center justify-between font-mono text-[14px] font-medium uppercase tracking-[0.08em] text-ink-2">
          <span>Wire queue</span>
          <span className="normal-case tracking-normal text-mute">{calls.length ? `${calls.length} today` : '—'}</span>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_76%,transparent)]">
          {queue.map((c) => (
            // click a wire to look at its checks and decision
            <div key={c.call_id} className="cursor-pointer transition-transform hover:-translate-y-0.5" onClick={() => patchLocal({ activeCallId: c.call_id })}>
              <QueueCard call={c} active={c.call_id === activeId} />
            </div>
          ))}
          {Array.from({ length: queue.length ? 2 : 3 }, (_, i) => <SkeletonCard key={i} i={i} />)}
        </div>
      </div>
      <div className="min-h-0">
        <ProofCard />
      </div>
      <div className="min-h-0">
        <DecisionPanel call={active} risk={risk} />
      </div>
    </div>
  )
}
