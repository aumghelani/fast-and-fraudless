// Decision pipeline (light): queue of wires -> Rules & Checks (revealed one by one) -> Decision (risk index, chips, slider, banker buttons).
// Sequence on a new recommendation: active card beams, dots travel, checks reveal under a bracket, number rolls, chip + knob settle.
import '@fontsource/racing-sans-one/latin-400.css'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, MotionConfig, animate, motion } from 'motion/react'
import { Landmark, Phone } from 'lucide-react'
import { AnimatedBeam } from '../magicui/animated-beam'
import { BorderBeam } from '../magicui/border-beam'
import { api } from '../../lib/api'
import { cx } from '../../lib/format'
import { EASE, usePrefersReducedMotion, type Verdict } from '../../ui/tokens'
import type { CheckTone, DecisionPipelineProps, PipelineCase, PipelineCheck, QueueItem, QueueStatus } from './types'

export type { DecisionPipelineProps } from './types'

type Phase = 'idle' | 'processing' | 'scan' | 'score' | 'settled'

const MAX_ROWS = 7
const CARDS = 5 // real + skeleton
const SHADOW = '0 1px 2px rgb(22 26 46 / .06), 0 8px 28px rgb(22 26 46 / .07)'
const tint = (c: string, p = 12) => `color-mix(in srgb, var(--color-${c}) ${p}%, var(--color-surface))`

const DOT: Record<CheckTone, string> = {
  flag: 'bg-hold', warn: 'bg-verify', pass: 'bg-clear', mitigate: 'bg-clear', info: 'bg-faint',
}
const VALUE: Record<CheckTone, string> = {
  flag: 'text-hold', warn: 'text-verify', pass: 'text-ink-2', mitigate: 'text-clear', info: 'text-mute',
}
const STATUS: Record<QueueStatus, { text: string; tone: string }> = {
  processing: { text: 'Processing…', tone: 'accent' },
  HOLD: { text: 'Hold advised', tone: 'hold' },
  VERIFY: { text: 'Verify with customer', tone: 'verify' },
  NO_HOLD: { text: 'Cleared', tone: 'clear' },
  unscreened: { text: 'No verdict', tone: 'mute' },
}
const CHIPS: { v: Verdict; label: string; tone: string }[] = [
  { v: 'NO_HOLD', label: 'CLEAR', tone: 'clear' },
  { v: 'VERIFY', label: 'VERIFY', tone: 'verify' },
  { v: 'HOLD', label: 'HOLD', tone: 'hold' },
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
    const step = Math.min(320, 2000 / Math.max(1, count))
    const t0 = 450
    const timers: number[] = []
    setPhase('scan')
    setRevealed(0)
    for (let i = 1; i <= count; i++) timers.push(window.setTimeout(() => setRevealed(i), t0 + step * (i - 1)))
    const tScore = t0 + step * count + 200
    timers.push(window.setTimeout(() => setPhase('score'), tScore))
    timers.push(window.setTimeout(() => setPhase('settled'), tScore + 1200))
    return () => timers.forEach((t) => window.clearTimeout(t))
    // the key carries the call id and verdict
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced])
  return { phase, revealed: phase === 'scan' ? revealed : cells }
}

export function DecisionPipeline({ call, queue, compact = false, className }: DecisionPipelineProps) {
  const reduced = usePrefersReducedMotion()
  const over = call ? call.checks.length > MAX_ROWS : false
  const cells = call ? (over ? call.checks.slice(0, MAX_ROWS - 1) : call.checks) : []
  const nCells = cells.length + (over ? 1 : 0)
  const { phase, revealed } = useSequence(call, nCells, reduced)
  const flowing = phase === 'processing' || phase === 'scan' || phase === 'score'
  const beams = flowing && !reduced
  const cardH = compact ? '4.25rem' : '5.25rem'
  const root = useRef<HTMLDivElement>(null)
  const a0 = useRef<HTMLSpanElement>(null)
  const a1 = useRef<HTMLSpanElement>(null)
  const b0 = useRef<HTMLSpanElement>(null)
  const b1 = useRef<HTMLSpanElement>(null)
  const skeletons = Math.max(0, CARDS - queue.length)
  const linkY = { top: `calc(${cardH} / 2 - 0.5rem)` }

  return (
    <MotionConfig reducedMotion="user">
      <div ref={root} className={cx('relative flex h-full min-h-0 w-full', className)}>
        {/* queue: active first; older cards fade; the column fades out at the bottom */}
        <div
          className={cx('flex shrink-0 flex-col overflow-hidden', compact ? 'w-64 gap-2' : 'w-[clamp(18rem,22%,25rem)] gap-3')}
          style={{ maskImage: 'linear-gradient(to bottom, #000 70%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 70%, transparent)' }}
        >
          <AnimatePresence initial={false}>
            {queue.slice(0, CARDS).map((it, i) => (
              <QueueCard key={it.id} item={it} index={i} beam={i === 0 && beams} compact={compact} h={cardH} />
            ))}
            {Array.from({ length: skeletons }, (_, i) => (
              <SkeletonCard key={`sk${i}`} h={cardH} compact={compact} fade={i} />
            ))}
          </AnimatePresence>
        </div>

        {/* queue -> rules */}
        <div className={cx('relative shrink-0', compact ? 'w-8' : 'w-14')}>
          <div className="absolute inset-x-0 h-4" style={linkY}>
            <Dots />
            <span ref={a0} className="absolute top-1/2 left-0" />
            <span ref={a1} className="absolute top-1/2 right-0" />
          </div>
        </div>

        <RulesPanel call={call} cells={cells} over={over} phase={phase} revealed={revealed} compact={compact} />

        {/* rules -> decision */}
        <div className={cx('relative shrink-0', compact ? 'w-8' : 'w-14')}>
          <div className="absolute inset-x-0 h-4" style={linkY}>
            <Dots />
            <span ref={b0} className="absolute top-1/2 left-0" />
            <span ref={b1} className="absolute top-1/2 right-0" />
          </div>
        </div>

        <DecisionPanel call={call} phase={phase} reduced={reduced} compact={compact} />

        {/* travelling light on the connectors while a wire is being processed */}
        {beams && (
          <>
            <AnimatedBeam
              containerRef={root} fromRef={a0} toRef={a1} pathOpacity={0} pathWidth={3} duration={1.6}
              gradientStartColor="var(--color-accent)" gradientStopColor="var(--color-accent)"
            />
            <AnimatedBeam
              containerRef={root} fromRef={b0} toRef={b1} pathOpacity={0} pathWidth={3} duration={1.6} delay={0.5}
              gradientStartColor="var(--color-accent)" gradientStopColor="var(--color-accent)"
            />
          </>
        )}
      </div>
    </MotionConfig>
  )
}

function Dots() {
  return (
    <svg width="100%" height="100%" aria-hidden className="block overflow-visible text-line-2">
      <line
        x1="0" y1="50%" x2="100%" y2="50%"
        stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeDasharray="0.01 8"
      />
    </svg>
  )
}

function QueueCard({ item, index, beam, compact, h }: {
  item: QueueItem; index: number; beam: boolean; compact: boolean; h: string
}) {
  const st = STATUS[item.status]
  const Icon = item.kind === 'payment' ? Landmark : Phone
  const active = index === 0
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: active ? 1 : index === 1 ? 0.6 : 0.42, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={cx(
        'relative flex shrink-0 items-center gap-4 rounded-xl border bg-surface px-4',
        active ? 'border-accent/60' : 'border-line',
      )}
      style={{ height: h, boxShadow: active ? SHADOW : 'none' }}
    >
      {beam && <BorderBeam size={72} duration={3} borderWidth={1.5} colorFrom="var(--color-accent)" colorTo="var(--color-accent)" />}
      <span
        className={cx('grid shrink-0 place-items-center rounded-full text-white', compact ? 'size-9' : 'size-11')}
        style={{ background: `var(--color-${st.tone === 'mute' ? 'faint' : st.tone})` }}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} strokeWidth={2} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className={cx('truncate font-mono font-semibold leading-tight text-ink', compact ? 'text-[0.9rem]' : 'text-[1.02rem]')}>
          {item.title}
        </div>
        <div className="flex min-w-0 items-baseline gap-2 font-mono text-[0.85rem] leading-tight">
          <span
            className="shrink-0"
            style={{ color: item.status === 'processing' ? 'var(--color-mute)' : `var(--color-${st.tone})` }}
          >
            {st.text}
          </span>
          {!compact && <span className="truncate text-faint">· {item.sub}</span>}
        </div>
      </div>
    </motion.div>
  )
}

function SkeletonCard({ h, compact, fade }: { h: string; compact: boolean; fade: number }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: Math.max(0.35, 0.8 - fade * 0.2) }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex shrink-0 items-center gap-4 rounded-xl border border-line bg-surface px-4"
      style={{ height: h }}
    >
      <span className={cx('shrink-0 rounded-full bg-surface-2', compact ? 'size-9' : 'size-11')} />
      <div className="flex flex-1 flex-col gap-2.5">
        <span className="h-3 w-3/4 rounded-full bg-surface-2" />
        <span className="h-2.5 w-2/5 rounded-full bg-surface-2" />
      </div>
    </motion.div>
  )
}

/** Solid indigo header bar, white mono title (the GIF's panel heads). */
function PanelHead({ title, right, compact }: { title: string; right?: string; compact: boolean }) {
  return (
    <div className={cx('flex shrink-0 items-center justify-between gap-4 bg-accent px-5 text-white', compact ? 'h-9' : 'h-11')}>
      <span className="font-mono text-[0.95rem] font-medium leading-none">{title}</span>
      {right && <span className="truncate font-mono text-[0.8rem] leading-none text-white/75">{right}</span>}
    </div>
  )
}

function RulesPanel({ call, cells, over, phase, revealed, compact }: {
  call: PipelineCase | null; cells: PipelineCheck[]; over: boolean; phase: Phase; revealed: number; compact: boolean
}) {
  const shownFlagged = cells.slice(0, revealed).filter((x) => x.tone === 'flag' || x.tone === 'warn').length
  const total = call?.checks.length ?? 0
  const flagged = phase === 'scan' ? shownFlagged : call?.flagged ?? 0
  const right = !call ? 'idle' : phase === 'processing' ? 'reading the call…' : `${flagged} of ${total} flagged`
  // bracket rides the row being checked
  const at = phase === 'scan' ? revealed - 1 : phase === 'processing' ? cells.length - 1 : -1

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface" style={{ boxShadow: SHADOW }}>
      <PanelHead title="Rules & Checks" right={right} compact={compact} />
      {!call ? (
        <div className="relative flex min-h-0 flex-1 flex-col gap-2 p-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex max-h-14 min-h-0 flex-1 items-center gap-3 px-4" style={{ opacity: 0.7 - i * 0.12 }}>
              <span className="size-2 shrink-0 rounded-full bg-surface-2" />
              <span className="h-2.5 rounded-full bg-surface-2" style={{ width: `${48 - i * 5}%` }} />
              <span className="ml-auto h-2.5 w-16 rounded-full bg-surface-2" />
            </div>
          ))}
          <div className="absolute inset-0 grid place-items-center">
            <div className="rounded-lg border border-line bg-surface px-5 py-3 text-center" style={{ boxShadow: SHADOW }}>
              <div className="font-mono text-[1.05rem] font-medium text-ink">Waiting for the next wire…</div>
              <div className="mt-1 text-meta text-mute">Every wire is checked against the GPU ring map and the call.</div>
            </div>
          </div>
        </div>
      ) : (
        <LayoutGroup>
          <div className={cx('flex min-h-0 flex-1 flex-col', compact ? 'gap-1 p-2' : 'gap-1.5 p-3')}>
            {cells.map((chk, i) => (
              <Row key={chk.id} chk={chk} shown={i < revealed} scanning={i === at} compact={compact} />
            ))}
            {over && (
              <div
                className={cx(
                  'flex max-h-14 min-h-0 flex-1 items-center px-4 font-mono text-meta text-mute transition-opacity duration-300',
                  revealed > cells.length ? 'opacity-100' : 'opacity-0',
                )}
              >
                +{call.checks.length - cells.length} more checks
              </div>
            )}
          </div>
        </LayoutGroup>
      )}
    </section>
  )
}

function Row({ chk, shown, scanning, compact }: { chk: PipelineCheck; shown: boolean; scanning: boolean; compact: boolean }) {
  return (
    <div className={cx('relative flex min-h-0 flex-1 items-center', compact ? 'max-h-11' : 'max-h-15')}>
      {scanning && (
        <motion.span
          layoutId="ffp-bracket"
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg"
          style={{ background: tint('accent', 7) }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <span className="absolute top-0 left-0 size-2.5 rounded-tl-md border-t-[1.5px] border-l-[1.5px] border-accent" />
          <span className="absolute top-0 right-0 size-2.5 rounded-tr-md border-t-[1.5px] border-r-[1.5px] border-accent" />
          <span className="absolute bottom-0 left-0 size-2.5 rounded-bl-md border-b-[1.5px] border-l-[1.5px] border-accent" />
          <span className="absolute right-0 bottom-0 size-2.5 rounded-br-md border-r-[1.5px] border-b-[1.5px] border-accent" />
        </motion.span>
      )}
      <div
        className={cx(
          'relative flex min-w-0 flex-1 items-center gap-3 px-4 transition-[opacity,transform] duration-300 ease-calm',
          shown ? 'translate-x-0 opacity-100' : '-translate-x-1.5 opacity-0',
        )}
      >
        <span className={cx('size-2 shrink-0 rounded-full', DOT[chk.tone])} />
        <div className="flex min-w-0 flex-col">
          <span className={cx('truncate font-mono leading-tight text-ink', compact ? 'text-[0.85rem]' : 'text-[0.98rem]')}>{chk.label}</span>
          {!compact && chk.quote && <span className="truncate text-meta leading-snug text-ink-2 italic">“{chk.quote}”</span>}
        </div>
        <span className={cx('ml-auto shrink-0 font-mono font-semibold leading-none', compact ? 'text-[0.85rem]' : 'text-[0.98rem]', VALUE[chk.tone])}>
          {chk.value}
        </span>
      </div>
    </div>
  )
}

/** Rolls 0 -> value in ~1.1 s (Magic UI NumberTicker idea, tuned to settle fast). */
function Ticker({ value, reduced }: { value: number; reduced: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced) {
      el.textContent = String(value)
      return
    }
    const c = animate(0, value, { duration: 1.1, ease: EASE, onUpdate: (v) => (el.textContent = String(Math.round(v))) })
    return () => c.stop()
  }, [value, reduced])
  return <span ref={ref} className="tnum">0</span>
}

function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function DecisionPanel({ call, phase, reduced, compact }: { call: PipelineCase | null; phase: Phase; reduced: boolean; compact: boolean }) {
  const settled = phase === 'settled'
  const scoring = phase === 'score' || settled
  const risk = call && scoring ? call.risk : null
  const knob = settled && call?.risk != null ? call.risk : 0
  const note =
    !call ? 'Rules decide. The banker acts.'
    : phase === 'processing' ? 'Waiting for the rules…'
    : phase === 'scan' ? 'Checking the rules…'
    : settled ? call.reason ?? '—'
    : 'Scoring…'

  return (
    <section
      className={cx('flex shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface', compact ? 'w-88' : 'w-[clamp(24rem,32%,36rem)]')}
      style={{ boxShadow: SHADOW }}
    >
      <PanelHead title="Decision" right="risk index · rules decide" compact={compact} />
      <div className={cx('flex min-h-0 flex-1 flex-col items-center justify-center', compact ? 'gap-3 px-4 py-3' : 'gap-4 px-7 py-4')}>
        <div className={cx('flex items-baseline gap-1.5 font-mono font-semibold leading-none', compact ? 'text-[3.25rem]' : 'text-hero')}>
          {risk == null ? (
            <span className="tnum text-faint">--</span>
          ) : (
            <span className="text-accent">
              <Ticker key={`${call?.id}|${call?.verdict}`} value={risk} reduced={reduced} />
            </span>
          )}
          <span className={cx('font-medium text-mute', compact ? 'text-body' : 'text-lead')}>/100</span>
        </div>
        <div className="flex gap-2.5">
          {CHIPS.map((c) => {
            const on = settled && call?.verdict === c.v
            return (
              <span
                key={c.v}
                className={cx(
                  'rounded-full px-4 py-1.5 font-mono text-[0.85rem] font-semibold leading-none tracking-[0.04em]',
                  'transition-[opacity,background-color,color,box-shadow] duration-300',
                )}
                style={{
                  background: on || !settled ? tint(c.tone, on ? 16 : 10) : 'var(--color-surface-2)',
                  color: on || !settled ? `var(--color-${c.tone})` : 'var(--color-mute)',
                  boxShadow: on ? `inset 0 0 0 1px color-mix(in srgb, var(--color-${c.tone}) 45%, transparent)` : 'none',
                  opacity: on ? 1 : settled ? 0.6 : 0.75,
                }}
              >
                {c.label}
              </span>
            )
          })}
        </div>
        <Slider pos={knob} reduced={reduced} />
        <div
          className={cx('line-clamp-2 w-full text-center leading-snug', compact ? 'text-meta' : 'text-body', settled ? 'text-ink-2' : 'text-mute')}
          title={call?.reason ?? undefined}
        >
          {note}
        </div>
        {call && settled && call.verdict && <BankerActions call={call} compact={compact} />}
      </div>
    </section>
  )
}

/** Indigo track, white knob that glides to the risk index; faint ticks at the zone edges. */
function Slider({ pos, reduced }: { pos: number; reduced: boolean }) {
  const t = reduced ? 'none' : 'left 700ms cubic-bezier(0.22,1,0.36,1), width 700ms cubic-bezier(0.22,1,0.36,1)'
  return (
    <div className="relative h-5 w-full max-w-104 px-2">
      <div className="relative h-full">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ background: tint('accent', 14) }} />
        <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${pos}%`, transition: t }} />
        {[40, 70].map((x) => (
          <span key={x} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-2" style={{ left: `${x}%` }} />
        ))}
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-white"
          style={{ left: `${pos}%`, transition: t, boxShadow: '0 1px 3px rgb(22 26 46 / .2)' }}
        />
      </div>
    </div>
  )
}

/** Same call as VerdictCard: the banker decides; nothing is sent automatically. */
function BankerActions({ call, compact }: { call: PipelineCase; compact: boolean }) {
  const [pending, setPending] = useState<'hold' | 'release' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const decidedAt = useRef<number | null>(null)
  const bd = call.bankerDecision ?? null
  if (bd && decidedAt.current == null) decidedAt.current = Date.now()

  const decide = async (d: 'hold' | 'release') => {
    setPending(d)
    setErr(null)
    try {
      await api.callDecision(call.id, d)
    } catch {
      setErr('The decision did not reach the box · try again')
    } finally {
      setPending(null)
    }
  }

  if (bd) {
    return (
      <div className="font-mono text-[0.95rem] font-semibold" style={{ color: `var(--color-${bd === 'hold' ? 'hold' : 'clear'})` }}>
        {bd === 'hold' ? 'Held' : 'Released'} by the banker at {decidedAt.current ? hhmm(decidedAt.current) : '—'}
      </div>
    )
  }

  const holdFirst = call.verdict !== 'NO_HOLD'
  const btn = cx('inline-flex items-center justify-center rounded-lg font-semibold transition-colors duration-200 disabled:opacity-40', compact ? 'h-9 px-4 text-meta' : 'h-11 px-5 text-body')
  const solidHold = cx(btn, 'bg-hold-fill text-white hover:brightness-110')
  const solidRelease = cx(btn, 'bg-accent text-white hover:brightness-110')
  const ghost = cx(btn, 'border border-line-2 bg-surface text-ink-2 hover:bg-surface-2')
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-3">
        {holdFirst ? (
          <>
            <button type="button" className={solidHold} disabled={!!pending} onClick={() => decide('hold')}>
              {pending === 'hold' ? 'Holding…' : 'Hold wire'}
            </button>
            <button type="button" className={ghost} disabled={!!pending} onClick={() => decide('release')}>
              {pending === 'release' ? 'Releasing…' : 'Release'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className={solidRelease} disabled={!!pending} onClick={() => decide('release')}>
              {pending === 'release' ? 'Releasing…' : 'Release wire'}
            </button>
            <button type="button" className={ghost} disabled={!!pending} onClick={() => decide('hold')}>
              {pending === 'hold' ? 'Holding…' : 'Hold'}
            </button>
          </>
        )}
      </div>
      {err && <span className="text-meta text-hold">{err}</span>}
    </div>
  )
}
