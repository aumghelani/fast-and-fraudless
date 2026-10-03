// Small building blocks shared by the page. Light, flat, calm: white cards, pastel pills, mono labels.
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { animate } from 'motion'
import { motion } from 'motion/react'
import { DASH, cx } from '../lib/format'
import { DUR, EASE, prefersReducedMotion } from './tokens'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'hold'
  size?: 'md' | 'lg'
  kbd?: string
}

const VARIANT = {
  primary: 'bg-accent text-white shadow-soft hover:bg-accent-deep',
  hold: 'bg-hold-fill text-white shadow-soft hover:bg-hold-deep',
  ghost: 'border border-line bg-surface text-ink shadow-soft hover:border-line-2 hover:bg-surface-2',
} as const

export function Button({ variant = 'primary', size = 'md', kbd, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-3 whitespace-nowrap rounded-lg text-body font-semibold',
        'transition-colors duration-200 disabled:opacity-40 disabled:shadow-none',
        size === 'lg' ? 'h-14 px-6' : 'h-12 px-5',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && <Kbd className="border-current opacity-60">{kbd}</Kbd>}
    </button>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line-2 px-1.5 font-mono text-meta font-medium leading-none text-inherit',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

type Tone = 'neutral' | 'accent' | 'hold' | 'verify' | 'clear'

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent-deep',
  hold: 'bg-hold-soft text-hold-deep',
  verify: 'bg-verify-soft text-verify-deep',
  clear: 'bg-clear-soft text-clear-deep',
}

/** Badge: a soft pastel pill in mono (Approved / Review / Decline style). */
export function Chip({ tone = 'neutral', children, className, title }: {
  tone?: Tone; children: ReactNode; className?: string; title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 font-mono text-meta font-medium leading-tight',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Small round status dot (tone colour). */
export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  const bg = { neutral: 'bg-mute', accent: 'bg-accent', hold: 'bg-hold', verify: 'bg-verify', clear: 'bg-clear' }[tone]
  return <span aria-hidden className={cx('inline-block h-2 w-2 shrink-0 rounded-full', bg, className)} />
}

/** Small mono uppercase label (card titles, field names). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('font-mono text-meta font-medium uppercase tracking-[0.06em] text-ink-2', className)}>{children}</div>
  )
}

/** White card: 12px radius, soft two-layer shadow. */
export function Card({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  )
}

/**
 * A titled card. bar = the solid indigo header bar with a white mono title (hero panels only);
 * without it the title is a quiet mono eyebrow, so the bottom row stays calm.
 */
export function Panel({ title, right, bar = false, children, className, bodyClassName }: {
  title: ReactNode; right?: ReactNode; bar?: boolean; children?: ReactNode; className?: string; bodyClassName?: string
}) {
  return (
    <section className={cx('card flex min-h-0 flex-col overflow-hidden', className)}>
      {bar ? (
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 bg-accent px-5 font-mono text-meta font-semibold text-white">
          <span className="truncate">{title}</span>
          {right}
        </header>
      ) : (
        <header className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4">
          <Eyebrow className="truncate">{title}</Eyebrow>
          {right}
        </header>
      )}
      <div className={cx('min-h-0 flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

const STAT = {
  display: ['text-display', 'text-hero'],
  hero: ['text-hero', 'text-title'],
  title: ['text-title', 'text-lead'],
} as const

/** A number with an optional denominator, a label and a note. */
export function Stat({ value, label, den, size = 'title', note, className }: {
  value: ReactNode; label: ReactNode; den?: ReactNode; size?: 'display' | 'hero' | 'title'; note?: ReactNode; className?: string
}) {
  const [v, d] = STAT[size]
  return (
    <div className={cx('flex flex-col gap-3', className)}>
      {/* trim-cap: trims the line box so the number sits tight on its label */}
      <div className="tnum flex items-baseline gap-2 font-mono font-semibold leading-none tracking-[-0.03em] text-ink">
        <span className={cx(v, 'trim-cap leading-none')}>{value}</span>
        {den != null && <span className={cx(d, 'trim-cap font-medium leading-none text-mute')}>/ {den}</span>}
      </div>
      <div className="text-body text-ink-2">{label}</div>
      {note != null && note !== '' && <div className="text-meta text-mute">{note}</div>}
    </div>
  )
}

/** Counts up once (600 ms) the first time a value is there, then updates in place. Writes text through a ref. */
export function CountUp({ value, format, className }: {
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

/** Entrance group: fade and rise 12px. order 1 starts 120 ms after order 0. */
export function Reveal({ order = 0, className, children }: { order?: 0 | 1; className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE, delay: order * 0.12 }}
    >
      {children}
    </motion.div>
  )
}

export function Empty({ title, sub, children, className }: {
  title: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string
}) {
  return (
    <div className={cx('col-span-full flex h-full flex-col items-center justify-center gap-4 text-center', className)}>
      <div className="font-mono text-lead font-semibold text-ink">{title}</div>
      {sub != null && <div className="text-body text-ink-2">{sub}</div>}
      {children != null && <div className="mt-4">{children}</div>}
    </div>
  )
}
