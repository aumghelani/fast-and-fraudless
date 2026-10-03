// Decision pipeline: queue of wires -> rules & checks (revealed one by one) -> decision (risk index, chips, slider).
// Sequence on a new recommendation: card highlight, dots flow, checks reveal, odometer rolls, chip + knob settle.
import '@fontsource/teko/latin-600.css'
import '@fontsource/racing-sans-one/latin-400.css'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Landmark, Phone } from 'lucide-react'
import { cx } from '../../lib/format'
import { EASE, usePrefersReducedMotion, type Verdict } from '../../ui/tokens'
import type { CheckTone, DecisionPipelineProps, PipelineCase, PipelineCheck, QueueItem, QueueStatus } from './types'

export type { DecisionPipelineProps } from './types'

type Phase = 'idle' | 'processing' | 'scan' | 'score' | 'settled'

const MAX_CELLS = 8
const CARDS = 5 // real + skeleton

const CSS = `
@keyframes ffp-flow { to { stroke-dashoffset: -24; } }
.ffp-flow { animation: ffp-flow 0.5s linear infinite; }
@media (prefers-reduced-motion: reduce) { .ffp-flow { animation: none; } }
`

const DOT: Record<CheckTone, string> = {
  flag: 'bg-hold', warn: 'bg-verify', pass: 'bg-clear', mitigate: 'bg-clear', info: 'bg-mute',
}
const VALUE: Record<CheckTone, string> = {
  flag: 'text-hold', warn: 'text-verify', pass: 'text-ink-2', mitigate: 'text-clear', info: 'text-mute',
}
const STATUS: Record<QueueStatus, { text: string; cls: string }> = {
  processing: { text: 'Processing…', cls: 'text-accent' },
  HOLD: { text: 'Hold', cls: 'text-hold' },
  VERIFY: { text: 'Verify', cls: 'text-verify' },
  NO_HOLD: { text: 'Cleared', cls: 'text-clear' },
  unscreened: { text: 'No verdict', cls: 'text-mute' },
}
const CHIPS: { v: Verdict; label: string; on: string }[] = [
  { v: 'NO_HOLD', label: 'Clear', on: 'bg-clear/15 outline-clear text-clear' },
  { v: 'VERIFY', label: 'Verify', on: 'bg-verify/15 outline-verify text-verify' },
  { v: 'HOLD', label: 'Hold', on: 'bg-hold/15 outline-hold text-hold' },
]

/** Phase machine. Restarts when the active call or its verdict changes. */
function useSequence(c: PipelineCase | null, cells: number, reduced: boolean) {
  const key = c ? `${c.id}|${c.verdict ?? 'pending'}` : ''
  const [phase, setPhase] = useState<Phase>('idle')
  const [revealed, setRevealed] = useState(0)
  const n = useRef(cells)
  n.current = cells
  useEffect(() => {
    if (!c) return setPhase('idle')
    if (!c.verdict) return setPhase('processing')
    if (reduced) return setPhase('settled')
    const count = n.current
    const step = Math.min(250, 1600 / Math.max(1, count))
    const t0 = 350
    const timers: number[] = []
    setPhase('scan')
    setRevealed(0)
    for (let i = 1; i <= count; i++) timers.push(window.setTimeout(() => setRevealed(i), t0 + step * (i - 1)))
    const tScore = t0 + step * count + 120
    timers.push(window.setTimeout(() => setPhase('score'), tScore))
    timers.push(window.setTimeout(() => setPhase('settled'), tScore + 1000))
    return () => timers.forEach((t) => window.clearTimeout(t))
    // the key carries the call id and verdict
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced])
  return { phase, revealed: phase === 'scan' ? revealed : cells }
}

export function DecisionPipeline({ call, queue, compact = false, className }: DecisionPipelineProps) {
  const reduced = usePrefersReducedMotion()
  const over = call ? call.checks.length > MAX_CELLS : false
  const cells = call ? (over ? call.checks.slice(0, MAX_CELLS - 1) : call.checks) : []
  const nCells = cells.length + (over ? 1 : 0)
  const { phase, revealed } = useSequence(call, nCells, reduced)
  const flowing = phase === 'processing' || phase === 'scan' || phase === 'score'
  const settled = phase === 'settled'
  const link = flowing ? 'text-accent' : settled ? 'text-accent/40' : 'text-line-2'
  const cardH = compact ? '4rem' : '5.5rem'

  return (
    <div className={cx('relative flex h-full min-h-0 w-full overflow-hidden', className)}>
      <style>{CSS}</style>

      {/* queue */}
      <div className={cx('flex shrink-0 flex-col', compact ? 'w-60 gap-2' : 'w-[clamp(18rem,28%,26rem)] gap-3')}>
        {Array.from({ length: CARDS }, (_, i) => {
          const it = queue[i]
          return it ? (
            <QueueCard key={it.id} item={it} active={i === 0} compact={compact} h={cardH} />
          ) : (
            <SkeletonCard key={`sk${i}`} h={cardH} compact={compact} />
          )
        })}
      </div>

      {/* queue -> rules */}
      <div className={cx('relative shrink-0', compact ? 'w-8' : 'w-16')}>
        <div className={cx('absolute inset-x-0 h-4', link)} style={{ top: `calc(${cardH} / 2 - 0.5rem)` }}>
          <Dots dir="h" flowing={flowing && !reduced} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <RulesPanel call={call} cells={cells} over={over} phase={phase} revealed={revealed} compact={compact} />
        {/* rules -> decision */}
        <div className={cx('relative ml-12 w-4 shrink-0', compact ? 'h-6' : 'h-10', link)}>
          <Dots dir="v" flowing={flowing && !reduced} />
        </div>
        <DecisionPanel call={call} phase={phase} reduced={reduced} compact={compact} />
      </div>
    </div>
  )
}

function Dots({ dir, flowing }: { dir: 'h' | 'v'; flowing: boolean }) {
  const h = dir === 'h'
  return (
    <svg width="100%" height="100%" aria-hidden className="block overflow-visible">
      <line
        x1={h ? '0' : '50%'} y1={h ? '50%' : '0'} x2={h ? '100%' : '50%'} y2={h ? '50%' : '100%'}
        stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeDasharray="0.01 11.99"
        className={flowing ? 'ffp-flow' : undefined}
      />
    </svg>
  )
}

function QueueCard({ item, active, compact, h }: { item: QueueItem; active: boolean; compact: boolean; h: string }) {
  const st = STATUS[item.status]
  const Icon = item.kind === 'payment' ? Landmark : Phone
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: active ? 1 : 0.5, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={cx(
        'flex shrink-0 items-center gap-4 rounded-xl border px-4',
        active ? 'border-accent/60 bg-surface-2' : 'border-line bg-surface',
      )}
      style={{ height: h }}
    >
      <span
        className={cx(
          'grid shrink-0 place-items-center rounded-full',
          compact ? 'size-9' : 'size-11',
          active ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-mute',
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className={cx('truncate text-body font-semibold leading-tight', active ? 'text-ink' : 'text-ink-2')}>{item.title}</div>
        <div className="flex min-w-0 items-baseline gap-3">
          <span className={cx('shrink-0 font-num text-lead font-semibold uppercase leading-none tracking-[0.04em]', st.cls)}>{st.text}</span>
          {!compact && <span className="truncate text-meta text-mute">{item.sub}</span>}
        </div>
      </div>
    </motion.div>
  )
}

function SkeletonCard({ h, compact }: { h: string; compact: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-4 rounded-xl border border-line/60 bg-surface/50 px-4 opacity-50" style={{ height: h }}>
      <span className={cx('shrink-0 rounded-full bg-surface-2', compact ? 'size-9' : 'size-11')} />
      <div className="flex flex-1 flex-col gap-2">
        <span className="h-3 w-3/4 rounded bg-surface-2" />
        <span className="h-2.5 w-2/5 rounded bg-surface-2" />
      </div>
    </div>
  )
}

function PanelHead({ title, right, compact }: { title: string; right?: string; compact: boolean }) {
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-between gap-4 border-b border-accent/30 bg-accent/10 px-5',
        compact ? 'h-9' : 'h-12',
      )}
    >
      <span className="font-num text-lead font-semibold uppercase leading-none tracking-[0.06em] text-accent">{title}</span>
      {right && <span className="truncate text-meta text-ink-2">{right}</span>}
    </div>
  )
}

function RulesPanel({ call, cells, over, phase, revealed, compact }: {
  call: PipelineCase | null; cells: PipelineCheck[]; over: boolean; phase: Phase; revealed: number; compact: boolean
}) {
  const rowH = compact ? '2.25rem' : '3.5rem'
  const shownFlagged = cells.slice(0, revealed).filter((x) => x.tone === 'flag' || x.tone === 'warn').length
  const total = call?.checks.length ?? 0
  const flagged = phase === 'scan' ? shownFlagged : call?.flagged ?? 0
  const right =
    !call ? 'Idle' : phase === 'processing' ? 'Reading the call…' : `${flagged} of ${total} checks flagged`
  // bracket sits on the cell being checked
  const at = phase === 'scan' ? Math.max(0, revealed - 1) : 0
  const showBracket = phase === 'scan' || phase === 'processing'
  const rows = Math.ceil(Math.max(cells.length + (over ? 1 : 0), compact ? 4 : 6) / 2)

  return (
    <section className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <PanelHead title="Rules & checks" right={right} compact={compact} />
      {!call ? (
        <div className="grid place-items-center px-6 text-center" style={{ height: `calc(${rows} * ${rowH} + ${rows - 1} * 0.5rem + 2rem)` }}>
          <div className="flex flex-col items-center gap-2">
            <div className={cx('font-race text-ink', compact ? 'text-lead' : 'text-title')}>Waiting for the next wire…</div>
            <div className="text-body text-mute">Every wire is checked against the GPU ring map and the call.</div>
          </div>
        </div>
      ) : (
        <div className="relative grid grid-cols-2 gap-x-3 gap-y-2 p-4">
          {cells.map((chk, i) => (
            <Cell key={chk.id} chk={chk} shown={i < revealed} rowH={rowH} compact={compact} />
          ))}
          {over && (
            <div
              className={cx('flex items-center px-3 text-body text-mute transition-opacity duration-300', revealed > cells.length ? 'opacity-100' : 'opacity-0')}
              style={{ height: rowH }}
            >
              +{call.checks.length - cells.length} more checks
            </div>
          )}
          {/* scanning bracket */}
          <span
            aria-hidden
            className="pointer-events-none absolute top-4 left-4 transition-[transform,opacity] duration-200 ease-calm"
            style={{
              width: 'calc(50% - 1.375rem)',
              height: rowH,
              opacity: showBracket ? 1 : 0,
              transform: `translate(calc(${at % 2} * (100% + 0.75rem)), calc(${Math.floor(at / 2)} * (100% + 0.5rem)))`,
            }}
          >
            <span className="absolute top-0 left-0 size-3 rounded-tl-md border-t-2 border-l-2 border-accent" />
            <span className="absolute top-0 right-0 size-3 rounded-tr-md border-t-2 border-r-2 border-accent" />
            <span className="absolute bottom-0 left-0 size-3 rounded-bl-md border-b-2 border-l-2 border-accent" />
            <span className="absolute right-0 bottom-0 size-3 rounded-br-md border-r-2 border-b-2 border-accent" />
          </span>
        </div>
      )}
    </section>
  )
}

function Cell({ chk, shown, rowH, compact }: { chk: PipelineCheck; shown: boolean; rowH: string; compact: boolean }) {
  return (
    <div
      className={cx(
        'flex min-w-0 flex-col justify-center gap-0.5 rounded-lg px-3 transition-[opacity,transform] duration-300 ease-calm',
        shown ? 'translate-x-0 opacity-100' : '-translate-x-1.5 opacity-0',
      )}
      style={{ height: rowH }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cx('size-2.5 shrink-0 rounded-full', DOT[chk.tone])} />
        <span className="truncate text-body text-ink">{chk.label}</span>
        <span className={cx('ml-auto shrink-0 font-num text-lead font-semibold leading-none', VALUE[chk.tone])}>{chk.value}</span>
      </div>
      {!compact && chk.quote && <div className="truncate pl-5 text-meta text-ink-2 italic">“{chk.quote}”</div>}
    </div>
  )
}

function DecisionPanel({ call, phase, reduced, compact }: { call: PipelineCase | null; phase: Phase; reduced: boolean; compact: boolean }) {
  const settled = phase === 'settled'
  const scoring = phase === 'score' || settled
  const risk = call && scoring ? call.risk : null
  const knob = settled && call?.risk != null ? call.risk : 0
  const note =
    !call ? 'Rules decide. The banker acts.'
    : phase === 'processing' ? 'Reading the call…'
    : phase === 'scan' ? 'Checking the rules…'
    : settled ? call.reason ?? '—'
    : 'Scoring…'

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <PanelHead title="Decision" right="risk index · from rule hits; rules decide" compact={compact} />
      <div className={cx('flex min-h-0 flex-1 items-center', compact ? 'gap-5 px-4 py-3' : 'gap-10 px-8 py-5')}>
        <div className={cx('flex shrink-0 items-baseline gap-2 font-num font-semibold leading-none', compact ? 'text-hero' : 'text-display')}>
          {risk == null ? (
            <span className="tnum text-faint">--</span>
          ) : (
            <Odometer key={`${call?.id}|${call?.verdict}`} value={risk} roll={!reduced} />
          )}
          <span className={cx('text-mute', compact ? 'text-lead' : 'text-title')}>/100</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex gap-3">
            {CHIPS.map((c) => {
              const on = settled && call?.verdict === c.v
              return (
                <span
                  key={c.v}
                  className={cx(
                    'decal trim-cap rounded-sm px-4 py-2 font-num text-lead font-semibold uppercase leading-none tracking-[0.06em]',
                    'outline-1 -outline-offset-1 outline-solid transition-[opacity,background-color,color] duration-300',
                    on ? c.on : 'text-mute outline-line-2',
                    on || !settled ? 'opacity-100' : 'opacity-40',
                  )}
                >
                  {c.label}
                </span>
              )
            })}
          </div>
          <Slider pos={knob} verdict={settled ? call?.verdict ?? null : null} reduced={reduced} />
          <div className={cx('truncate text-body', settled ? 'text-ink' : 'text-mute')} title={call?.reason ?? undefined}>{note}</div>
        </div>
      </div>
    </section>
  )
}

const ZONES: { v: Verdict; w: string; cls: string }[] = [
  { v: 'NO_HOLD', w: '40%', cls: 'bg-clear' },
  { v: 'VERIFY', w: '30%', cls: 'bg-verify' },
  { v: 'HOLD', w: '30%', cls: 'bg-hold' },
]

function Slider({ pos, verdict, reduced }: { pos: number; verdict: Verdict | null; reduced: boolean }) {
  return (
    <div className="relative h-5 overflow-hidden px-2.5">
      <div className="relative flex h-full items-center">
        <div className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full">
          {ZONES.map((z) => (
            <span
              key={z.v}
              className={cx('h-full rounded-full transition-opacity duration-300', z.cls, verdict === z.v ? 'opacity-90' : 'opacity-25')}
              style={{ width: z.w }}
            />
          ))}
        </div>
        {/* carrier spans the track; moving it by pos% moves the knob by pos% of the track */}
        <motion.div
          className="pointer-events-none absolute inset-y-0 left-0 w-full"
          initial={false}
          animate={{ x: `${pos}%` }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: EASE }}
        >
          <span
            className={cx(
              'absolute top-1/2 left-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg transition-colors duration-300',
              verdict === 'HOLD' ? 'bg-hold' : verdict === 'VERIFY' ? 'bg-verify' : verdict === 'NO_HOLD' ? 'bg-clear' : 'bg-faint',
            )}
          />
        </motion.div>
      </div>
    </div>
  )
}

/** Two rolling reels; the ones reel spins twice on the way up. Transform only. */
function Odometer({ value, roll }: { value: number; roll: boolean }) {
  const v = Math.max(0, Math.min(99, Math.round(value)))
  return (
    <span className="tnum inline-flex text-ink" aria-label={String(v)}>
      <Reel n={10} index={Math.floor(v / 10)} roll={roll} duration={0.9} />
      <Reel n={30} index={20 + (v % 10)} roll={roll} duration={1} />
    </span>
  )
}

function Reel({ n, index, roll, duration }: { n: number; index: number; roll: boolean; duration: number }) {
  return (
    <span aria-hidden className="relative inline-block h-[1em] w-[0.5em] overflow-hidden">
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={roll ? { y: '0%' } : false}
        animate={{ y: `${(-index / n) * 100}%` }}
        transition={roll ? { duration, ease: EASE } : { duration: 0 }}
      >
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="block h-[1em] text-center leading-none">
            {i % 10}
          </span>
        ))}
      </motion.span>
    </span>
  )
}
