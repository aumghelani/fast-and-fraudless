// Shared bits for the four bottom cards: white card shell, small mono title, rolling mono number, pastel pill.
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { animate } from 'motion'
import { DASH, cx } from '../../lib/format'
import { DUR, EASE, prefersReducedMotion } from '../../ui/tokens'

export const CARD_SHADOW = '0 1px 2px rgb(22 26 46 / .06), 0 8px 28px rgb(22 26 46 / .07)'

export function Card({ title, right, children, className }: {
  title: string; right?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section
      className={cx('flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-surface p-5', className)}
      style={{ boxShadow: CARD_SHADOW }}
    >
      <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <h2 className="truncate font-mono text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-2">{title}</h2>
        {right}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

/** Mono number that rolls up once (600 ms) when it first arrives, then updates in place. */
export function MonoCount({ value, format, className }: {
  value?: number | null; format: (v: number) => string; className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const ran = useRef(false)
  const fmt = useRef(format)
  fmt.current = format
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (value == null || !Number.isFinite(value)) {
      el.textContent = DASH
      return
    }
    if (ran.current || prefersReducedMotion()) {
      ran.current = true
      el.textContent = fmt.current(value)
      return
    }
    ran.current = true
    el.textContent = fmt.current(0)
    const c = animate(0, value, {
      duration: DUR.slow,
      ease: EASE,
      onUpdate: (v) => {
        el.textContent = fmt.current(v)
      },
    })
    return () => {
      c.stop()
      el.textContent = fmt.current(value)
    }
  }, [value])
  return <span ref={ref} className={cx('tnum font-mono', className)} />
}

export type PillTone = 'neutral' | 'accent' | 'hold' | 'verify' | 'clear'

const PILL: Record<PillTone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-[#ECEBFD] text-accent',
  hold: 'bg-[#FDECEC] text-hold',
  verify: 'bg-[#FFF4D6] text-verify',
  clear: 'bg-[#E5F6EC] text-clear',
}

/** Soft pastel pill, mono, like the chips in the reference recording. */
export function Pill({ tone = 'neutral', children, className, title }: {
  tone?: PillTone; children: ReactNode; className?: string; title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 font-mono text-[0.6875rem] leading-4',
        PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Small key hint inside a button. */
export function KeyHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-current px-1 font-mono text-[0.625rem] leading-none opacity-50">
      {children}
    </kbd>
  )
}

export const BTN = 'inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-[0.8125rem] font-medium transition-colors duration-200 disabled:opacity-40'
export const BTN_PRIMARY = cx(BTN, 'bg-accent text-white hover:bg-accent/90')
export const BTN_GHOST = cx(BTN, 'border border-line-2 bg-surface text-ink hover:bg-surface-2')
