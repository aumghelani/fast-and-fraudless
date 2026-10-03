// The two indigo-bar panels of the hero: Rules & Checks, and the Decision.
import { useEffect, useRef, useState } from 'react'
import { animate, motion } from 'motion/react'
import { Check as CheckIcon } from 'lucide-react'
import type { Call } from '../../lib/types'
import { api } from '../../lib/api'
import { cx } from '../../lib/format'
import { Button, Card } from '../kit'
import { VERDICT_LABEL, usePrefersReducedMotion, verdictOf, type Verdict } from '../selectors'
import type { Check, CheckTone } from './checks'

const DOT: Record<CheckTone, string> = { flag: 'bg-hold', pass: 'bg-clear', info: 'bg-faint' }
const EASE = [0.22, 1, 0.36, 1] as const

/** Reveal checks one at a time (~220 ms) whenever the call or its verdict changes. */
function useReveal(key: string, total: number, reduced: boolean): number {
  const [state, setState] = useState({ key, n: 0 })
  const n = state.key === key ? state.n : 0
  useEffect(() => {
    if (state.key !== key) {
      setState({ key, n: 0 })
      return
    }
    if (reduced && n < total) {
      setState({ key, n: total })
      return
    }
    if (n >= total) return
    const t = setTimeout(() => setState({ key, n: n + 1 }), n === 0 ? 120 : 220)
    return () => clearTimeout(t)
  }, [key, n, total, reduced, state.key])
  return Math.min(n, total)
}

export function RulesPanel({ call, checks }: { call?: Call; checks: Check[] }) {
  const reduced = usePrefersReducedMotion()
  const key = call ? `${call.call_id}|${verdictOf(call) ?? ''}` : ''
  const shown = useReveal(key, checks.length, reduced)
  const flagged = checks.filter((c) => c.tone === 'flag').length
  const visible = checks.slice(0, shown)
  const cur = shown - 1
  return (
    <Card bar title="Rules & Checks" right={call ? `${flagged} of ${checks.length} flagged` : '—'} className="h-full"
      bodyClassName="relative px-4 py-4">
      {!call ? (
        <div className="flex h-full flex-col justify-center gap-3 px-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 opacity-60">
              <span className="size-2 rounded-full bg-line-2" />
              <span className="h-2.5 rounded-full bg-surface-2" style={{ width: `${46 - i * 6}%` }} />
              <span className="ml-auto h-2.5 w-16 rounded-full bg-surface-2" />
            </div>
          ))}
          <p className="mt-3 text-center font-mono text-[13px] text-mute">Waiting for the next wire…</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1 overflow-hidden">
          {visible.map((c, i) => (
            <motion.li
              key={c.id}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="relative flex h-[34px] shrink-0 items-center gap-3 rounded-lg px-3"
            >
              {i === cur && <Bracket reduced={reduced} tone={c.tone} />}
              <span className={cx('relative size-2 shrink-0 rounded-full', DOT[c.tone])} />
              <span className="relative shrink-0 font-mono text-[13.5px] text-ink">{c.label}</span>
              {c.quote && (
                <span className="relative min-w-0 truncate text-[13px] italic text-mute">“{c.quote}”</span>
              )}
              <span className={cx('relative ml-auto shrink-0 font-mono text-[13px] tnum',
                c.tone === 'flag' ? 'text-hold' : c.tone === 'pass' ? 'text-clear' : 'text-mute')}>
                {c.value}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Thin corner bracket around the check being read, with a status dot. */
function Bracket({ reduced, tone }: { reduced: boolean; tone: CheckTone }) {
  const corner = 'absolute size-2.5 border-accent'
  return (
    <motion.span
      layoutId="scan-bracket"
      transition={reduced ? { duration: 0 } : { duration: 0.28, ease: EASE }}
      className="pointer-events-none absolute inset-0 rounded-lg bg-accent-soft/60"
    >
      <span className={cx(corner, 'left-0 top-0 rounded-tl-md border-l border-t')} />
      <span className={cx(corner, 'right-0 top-0 rounded-tr-md border-r border-t')} />
      <span className={cx(corner, 'bottom-0 left-0 rounded-bl-md border-b border-l')} />
      <span className={cx(corner, 'bottom-0 right-0 rounded-br-md border-b border-r')} />
      <span className={cx('absolute -right-1 -top-1 size-2 rounded-full ring-2 ring-surface', DOT[tone] === 'bg-faint' ? 'bg-accent' : DOT[tone])} />
    </motion.span>
  )
}

/** Rolling number: eases to the new value in under a second. */
function Ticker({ value, reduced }: { value: number; reduced: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const last = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced) {
      el.textContent = String(value)
      last.current = value
      return
    }
    const a = animate(last.current, value, {
      duration: 0.9, ease: EASE,
      onUpdate: (v) => {
        last.current = v
        el.textContent = String(Math.round(v))
      },
    })
    return () => a.stop()
  }, [value, reduced])
  return <span ref={ref}>0</span>
}

const CHIPS: { v: Verdict; on: string }[] = [
  { v: 'NO_HOLD', on: 'bg-clear-soft text-clear ring-1 ring-clear/40' },
  { v: 'VERIFY', on: 'bg-verify-soft text-verify ring-1 ring-verify/40' },
  { v: 'HOLD', on: 'bg-hold-soft text-hold ring-1 ring-hold/40' },
]

export function DecisionPanel({ call, risk }: { call?: Call; risk: number | null }) {
  const reduced = usePrefersReducedMotion()
  const verdict = verdictOf(call)
  const [pending, setPending] = useState<'hold' | 'release' | null>(null)
  const [local, setLocal] = useState<{ id: string; d: 'hold' | 'release' } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const id = call?.call_id
  const decided = call?.banker_decision ?? (local && local.id === id ? local.d : null)

  useEffect(() => {
    setPending(null)
    setErr(null)
  }, [id])

  const decide = async (d: 'hold' | 'release') => {
    if (!id || pending) return
    setPending(d)
    setErr(null)
    try {
      await api.callDecision(id, d)
      setLocal({ id, d })
    } catch {
      setErr('Could not save. Try again.')
    } finally {
      setPending(null)
    }
  }

  const pos = risk ?? 0
  return (
    <Card bar title="Decision" right="rules decide, not the model" className="h-full" bodyClassName="flex flex-col px-6 pb-5 pt-5">
      <div className="flex items-baseline gap-2 font-mono">
        <span className="inline-block w-[2ch] text-right text-[64px] font-semibold leading-none text-accent tnum">
          {risk == null ? '—' : <Ticker value={risk} reduced={reduced} />}
        </span>
        <span className="text-[22px] text-mute">/100</span>
      </div>
      <p className="mt-2 font-mono text-[12px] text-mute">risk index from rule hits</p>

      <div className="mt-5 flex gap-2">
        {CHIPS.map(({ v, on }) => (
          <span key={v} className={cx('rounded-full px-3.5 py-1 font-mono text-[13px] font-medium transition-colors duration-300',
            verdict === v ? on : 'bg-surface-2 text-mute')}>
            {VERDICT_LABEL[v]}
          </span>
        ))}
      </div>

      <div className="relative mt-6 h-5">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent-soft" />
        <motion.div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
          initial={false} animate={{ width: `${pos}%` }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }} />
        {[40, 70].map((t) => (
          <span key={t} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-2" style={{ left: `${t}%` }} />
        ))}
        <motion.span className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-white shadow-[0_1px_4px_rgb(22_26_46/0.25)]"
          initial={false} animate={{ left: `${pos}%`, opacity: risk == null ? 0.4 : 1 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }} />
      </div>
      <div className="relative mt-1.5 h-4 font-mono text-[11px] text-faint tnum">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: '40%' }}>40</span>
        <span className="absolute -translate-x-1/2" style={{ left: '70%' }}>70</span>
        <span className="absolute right-0">100</span>
      </div>

      <p className="mt-4 line-clamp-2 min-h-[44px] text-[14.5px] leading-[22px] text-ink-2">
        {call?.reasons?.[0] ?? (call ? 'Listening to the call…' : '—')}
      </p>

      <div className="mt-auto flex h-10 items-center gap-3">
        {decided ? (
          <span className="inline-flex items-center gap-2 font-mono text-[14px] text-ink">
            <span className={cx('grid size-6 place-items-center rounded-full', decided === 'hold' ? 'bg-hold-soft text-hold' : 'bg-clear-soft text-clear')}>
              <CheckIcon size={14} strokeWidth={2.5} />
            </span>
            {decided === 'hold' ? 'Held by the banker' : 'Released by the banker'}
          </span>
        ) : (
          <>
            <Button variant="hold" disabled={!call || !!pending} onClick={() => decide('hold')}>
              {pending === 'hold' ? 'Holding…' : 'Hold wire'}
            </Button>
            <Button variant="ghost" disabled={!call || !!pending} onClick={() => decide('release')}>
              {pending === 'release' ? 'Releasing…' : 'Release'}
            </Button>
            {err && <span className="text-[13px] text-hold">{err}</span>}
          </>
        )}
      </div>
    </Card>
  )
}
