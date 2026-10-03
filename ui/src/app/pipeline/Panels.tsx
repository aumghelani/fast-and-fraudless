// Rules & Checks (each check rises in, a scan bar sweeps it and fills it green or red) and the Decision.
import { useEffect, useRef, useState } from 'react'
import { animate, motion } from 'motion/react'
import { Check as CheckIcon } from 'lucide-react'
import type { Call } from '../../lib/types'
import { cx } from '../../lib/format'
import { Card, GlowCard } from '../kit'
import { VERDICT_LABEL, usePrefersReducedMotion, verdictOf, type Verdict } from '../selectors'
import type { Check, CheckTone } from './checks'

const DOT: Record<CheckTone, string> = { flag: 'bg-hold', pass: 'bg-clear', info: 'bg-faint' }
const FILL: Record<CheckTone, string> = { flag: 'bg-hold-soft', pass: 'bg-clear-soft', info: 'bg-surface-2' }
const BAR: Record<CheckTone, string> = {
  flag: 'bg-hold shadow-[0_0_14px_3px_rgb(229_72_77/0.55)]',
  pass: 'bg-clear shadow-[0_0_14px_3px_rgb(23_163_90/0.5)]',
  info: 'bg-mute shadow-[0_0_10px_2px_rgb(138_144_166/0.4)]',
}
const RISE_S = 0.35 // the check's box rises from the bottom
const SCAN_S = 0.8 // then the scan bar sweeps left to right
const EASE = [0.22, 1, 0.36, 1] as const

/** Reveal checks one at a time, each after the previous scan has mostly run. */
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
    const t = setTimeout(() => setState({ key, n: n + 1 }), n === 0 ? 120 : 650)
    return () => clearTimeout(t)
  }, [key, n, total, reduced, state.key])
  return Math.min(n, total)
}

export function RulesPanel({ call, checks }: { call?: Call; checks: Check[] }) {
  const reduced = usePrefersReducedMotion()
  // keyed by call only: checks arrive as the call is transcribed and each one slides in once
  const key = call ? call.call_id : ''
  const shown = useReveal(key, checks.length, reduced)
  const flagged = checks.filter((c) => c.tone === 'flag').length
  const visible = checks.slice(0, shown)
  // keep the newest heard check in view when the list is taller than the panel
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [shown, reduced])
  return (
    <Card bar title="Rules & Checks" right={!call ? '—' : checks.length ? `${flagged} of ${checks.length} flagged` : 'listening…'} className="h-full"
      bodyClassName="relative px-4 py-4 [@media(max-height:780px)]:py-2">
      {!call || checks.length === 0 ? (
        <div className="flex h-full flex-col justify-center gap-3 px-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 opacity-60">
              <span className="size-2 rounded-full bg-line-2" />
              <span className="h-2.5 rounded-full bg-surface-2" style={{ width: `${46 - i * 6}%` }} />
              <span className="ml-auto h-2.5 w-16 rounded-full bg-surface-2" />
            </div>
          ))}
          <p className="mt-3 text-center font-mono text-[14px] text-mute">
            {!call ? 'Waiting for the next wire…' : call.ended ? 'Call ended before any words were heard' : 'Listening… checks appear as the customer speaks'}
          </p>
        </div>
      ) : (
        <div className="flex h-full flex-col">
        <ul ref={listRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pt-2 [mask-image:linear-gradient(to_bottom,transparent,#000_14px)] [scrollbar-width:none]">
          {visible.map((c) => (
            <motion.li
              key={c.id}
              initial={reduced ? false : { opacity: 0, y: 22, scaleY: 0.6 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              style={{ transformOrigin: 'bottom' }}
              transition={{ duration: RISE_S, ease: EASE }}
              className="relative flex h-[36px] shrink-0 items-center gap-3 overflow-hidden rounded-lg border border-line px-3"
            >
              {/* the tint that the scan bar leaves behind */}
              <motion.span
                aria-hidden
                className={cx('absolute inset-y-0 left-0', FILL[c.tone])}
                initial={reduced ? false : { width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: SCAN_S, ease: 'easeInOut', delay: RISE_S }}
              />
              {!reduced && (
                <motion.span
                  aria-hidden
                  className={cx('absolute inset-y-1 w-[3px] rounded-full', BAR[c.tone])}
                  initial={{ left: '0%', opacity: 1 }}
                  animate={{ left: '100%', opacity: [1, 1, 0] }}
                  transition={{ duration: SCAN_S, ease: 'easeInOut', delay: RISE_S, opacity: { duration: SCAN_S, times: [0, 0.85, 1], delay: RISE_S } }}
                />
              )}
              <motion.span
                className={cx('relative size-2.5 shrink-0 rounded-full', DOT[c.tone])}
                initial={reduced ? false : { scale: 0.4, opacity: 0.4 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.25, delay: RISE_S + SCAN_S * 0.9 }}
              />
              <span className="relative shrink-0 font-mono text-[15px] text-ink">{c.label}</span>
              {c.quote && (
                <span className="relative min-w-0 truncate text-[14px] italic text-ink-2">“{c.quote}”</span>
              )}
              <motion.span
                className={cx('relative ml-auto shrink-0 font-mono text-[14.5px] font-medium tnum',
                  c.tone === 'flag' ? 'text-hold' : c.tone === 'pass' ? 'text-clear' : 'text-mute')}
                initial={reduced ? false : { opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: RISE_S + SCAN_S * 0.85 }}
              >
                {c.value}
              </motion.span>
            </motion.li>
          ))}
        </ul>
        <div className="mt-2 flex shrink-0 items-center justify-between border-t border-line px-3 pt-2.5 font-mono text-[13px] text-mute [@media(max-height:780px)]:hidden">
          <span className="flex items-center gap-2">
            <span className={cx('size-1.5 rounded-full', verdictOf(call) ? 'bg-clear' : call.ended ? 'bg-faint' : 'bg-accent')} />
            {verdictOf(call) ? 'All checks read' : call.ended ? 'Call ended' : 'Reading the call…'}
          </span>
          <span className="tnum">{call.call_id}</span>
        </div>
        </div>
      )}
    </Card>
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
  const decided = call?.banker_decision ?? null

  const pos = risk ?? 0
  const tone = verdict === 'HOLD' ? 'hold' : verdict === 'VERIFY' ? 'verify' : verdict === 'NO_HOLD' ? 'clear' : null
  const ink = tone === 'hold' ? 'text-hold' : tone === 'verify' ? 'text-verify' : tone === 'clear' ? 'text-clear' : 'text-accent'
  const fill = tone === 'hold' ? 'bg-hold' : tone === 'verify' ? 'bg-verify' : tone === 'clear' ? 'bg-clear' : 'bg-accent'
  const knob = tone === 'hold' ? 'border-hold' : tone === 'verify' ? 'border-verify' : tone === 'clear' ? 'border-clear' : 'border-accent'
  const bar = tone === 'hold' ? 'bg-hold-fill' : tone === 'verify' ? 'bg-verify' : tone === 'clear' ? 'bg-clear' : 'bg-accent'
  return (
    <GlowCard tone={tone} pulsing={!!call && !call.ended} className="h-full">
    <Card bar barClass={bar} title="Decision" right="rules decide, not the model" className="h-full" bodyClassName="flex min-h-0 flex-col px-6 pb-4 pt-3">
      <div className="flex items-baseline gap-2 font-mono">
        <span className={cx('inline-block w-[2ch] text-right text-[48px] leading-none tnum [@media(max-height:780px)]:text-[38px]', risk != null && 'font-semibold', risk == null ? 'font-light text-faint' : ink, 'transition-colors duration-500')}>
          {risk == null ? '—' : <Ticker value={risk} reduced={reduced} />}
        </span>
        <span className="text-[24px] text-mute">/100</span>
      </div>
      <p className="mt-1.5 font-mono text-[13px] text-mute [@media(max-height:780px)]:hidden">risk index from rule hits</p>

      <div className="mt-3 flex gap-2">
        {CHIPS.map(({ v, on }) => (
          <span key={v} className={cx('rounded-full px-4 py-1 font-mono text-[14px] font-medium transition-colors duration-300',
            verdict === v ? on : 'bg-surface-2 text-mute')}>
            {VERDICT_LABEL[v]}
          </span>
        ))}
        {/* what the banker chose (they act from the suggestion box) */}
        {decided && (
          <span className={cx('ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[13.5px]',
            decided === 'hold' ? 'bg-hold-soft text-hold' : 'bg-clear-soft text-clear')}>
            <CheckIcon size={14} strokeWidth={2.5} />
            {decided === 'hold' ? 'Held by banker' : 'Released'}
          </span>
        )}
      </div>

      <div className="relative mt-4 h-5 shrink-0">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent-soft" />
        <motion.div className={cx('absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-colors duration-500', fill)}
          initial={false} animate={{ width: `${pos}%` }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }} />
        {[40, 70].map((t) => (
          <span key={t} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-2" style={{ left: `${t}%` }} />
        ))}
        <motion.span className={cx('absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white shadow-[0_1px_4px_rgb(22_26_46/0.25)] transition-colors duration-500', knob)}
          initial={false} animate={{ left: `${pos}%`, opacity: risk == null ? 0.4 : 1 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }} />
      </div>


    </Card>
    </GlowCard>
  )
}
