// The hero: the wire queue flows through the rules to a decision (after the reference recording).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { motion } from 'motion/react'
import { Landmark, PhoneCall } from 'lucide-react'
import type { Call } from '../lib/types'
import { cx } from '../lib/format'
import { BorderBeam } from '../components/magicui/border-beam'
import { patchLocal } from '../lib/store'
import { useActiveCall, useCallsNewestFirst, usePrefersReducedMotion, verdictOf } from './selectors'
import { STATUS_TEXT, checksOf, customerName, riskIndex, statusOf, wireTitle, type QueueStatus } from './pipeline/checks'
import { DecisionPanel, RulesPanel } from './pipeline/Panels'

const TONE: Record<QueueStatus, { icon: string; text: string }> = {
  processing: { icon: 'bg-accent-soft text-accent', text: 'text-accent' },
  HOLD: { icon: 'bg-hold-soft text-hold', text: 'text-hold' },
  VERIFY: { icon: 'bg-verify-soft text-verify', text: 'text-verify' },
  NO_HOLD: { icon: 'bg-clear-soft text-clear', text: 'text-clear' },
  unscreened: { icon: 'bg-surface-2 text-mute', text: 'text-mute' },
}

function QueueCard({ call, active, innerRef }: { call: Call; active: boolean; innerRef?: RefObject<HTMLDivElement | null> }) {
  const st = statusOf(call)
  const reduced = usePrefersReducedMotion()
  const Icon = st === 'processing' ? PhoneCall : Landmark
  return (
    <motion.div
      ref={innerRef}
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: active ? 1 : 0.55, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cx('card relative flex h-[76px] shrink-0 items-center gap-4 overflow-hidden px-4',
        active ? 'ring-1 ring-accent/50' : '')}
    >
      <span className={cx('grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-300', TONE[st].icon)}>
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 font-mono text-[14.5px] font-medium text-ink tnum">{wireTitle(call)}</span>
          <span className="truncate text-[13px] text-mute">{customerName(call)}</span>
        </div>
        <div className={cx('mt-1 flex items-center gap-1.5 font-mono text-[12.5px]', TONE[st].text)}>
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

interface Pt { x: number; y: number }
interface Geo { a?: [Pt, Pt]; b?: [Pt, Pt] }

const curve = ([p, q]: [Pt, Pt]) => {
  const mx = (p.x + q.x) / 2
  return `M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${q.y}, ${q.x} ${q.y}`
}

/** Dotted connector; small indigo dots travel along it only while the call is processing. */
function Connector({ pts, moving }: { pts: [Pt, Pt]; moving: boolean }) {
  const d = curve(pts)
  return (
    <g>
      <path d={d} fill="none" stroke="var(--color-mute)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="0 7" strokeLinecap="round" />
      {moving && (
        <motion.path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={3.2} strokeLinecap="round"
          strokeDasharray="0 26" initial={{ strokeDashoffset: 0 }} animate={{ strokeDashoffset: -26 }}
          transition={{ duration: 1.1, ease: 'linear', repeat: Infinity }} />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill="var(--color-surface)" stroke={moving ? 'var(--color-accent)' : 'var(--color-mute)'} strokeOpacity={moving ? 1 : 0.6} strokeWidth={1.6} />
      ))}
    </g>
  )
}

export function Pipeline() {
  const calls = useCallsNewestFirst()
  const active = useActiveCall()
  const reduced = usePrefersReducedMotion()
  const queue = calls.slice(0, 3)
  if (active && !queue.some((c) => c.call_id === active.call_id)) queue.splice(2, 1, active)

  const checks = useMemo(() => (active ? checksOf(active) : []), [active])
  const flagged = checks.filter((c) => c.tone === 'flag').length
  const risk = riskIndex(verdictOf(active), flagged)
  const processing = !!active && statusOf(active) === 'processing'

  // connector geometry, measured from the live layout
  const box = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const rules = useRef<HTMLDivElement>(null)
  const decision = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geo>({})
  const measure = useCallback(() => {
    const o = box.current?.getBoundingClientRect()
    const r = rules.current?.getBoundingClientRect()
    const d = decision.current?.getBoundingClientRect()
    if (!o || !r || !d) return
    const c = card.current?.getBoundingClientRect()
    const g: Geo = {}
    if (c) {
      const y = c.top + c.height / 2 - o.top
      const y2 = Math.min(Math.max(y, r.top - o.top + 70), r.bottom - o.top - 40)
      g.a = [{ x: c.right - o.left + 8, y }, { x: r.left - o.left - 8, y: y2 }]
    }
    g.b = [{ x: r.right - o.left + 8, y: r.top - o.top + 84 }, { x: d.left - o.left - 8, y: d.top - o.top + 112 }]
    setGeo((p) => (JSON.stringify(p) === JSON.stringify(g) ? p : g))
  }, [])
  const activeId = active?.call_id
  const queueKey = queue.map((c) => c.call_id).join(',')
  useLayoutEffect(() => {
    measure()
    const t = setTimeout(measure, 450) // after the card entrance settles
    return () => clearTimeout(t)
  }, [measure, activeId, queueKey])
  useEffect(() => {
    const ro = new ResizeObserver(() => measure())
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [measure])

  return (
    <div ref={box} className="relative grid h-full min-h-0 grid-cols-[28fr_38fr_34fr] gap-x-16">
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex h-[18px] items-center justify-between font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-ink-2">
          <span>Wire queue</span>
          <span className="normal-case tracking-normal text-mute">{calls.length ? `${calls.length} today` : '—'}</span>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_76%,transparent)]">
          {queue.map((c) => (
            // click a wire to look at its checks and decision
            <div key={c.call_id} className="cursor-pointer transition-transform hover:-translate-y-0.5" onClick={() => patchLocal({ activeCallId: c.call_id })}>
              <QueueCard call={c} active={c.call_id === activeId} innerRef={c.call_id === activeId ? card : undefined} />
            </div>
          ))}
          {Array.from({ length: queue.length ? 2 : 3 }, (_, i) => <SkeletonCard key={i} i={i} />)}
        </div>
      </div>
      <div ref={rules} className="relative z-10 min-h-0">
        <RulesPanel call={active} checks={checks} />
      </div>
      <div ref={decision} className="relative z-10 min-h-0">
        <DecisionPanel call={active} risk={risk} />
      </div>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {geo.a && active && <Connector pts={geo.a} moving={processing && !reduced} />}
        {geo.b && <Connector pts={geo.b} moving={processing && !reduced} />}
      </svg>
    </div>
  )
}
