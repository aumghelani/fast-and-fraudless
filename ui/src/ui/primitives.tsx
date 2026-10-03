// Small building blocks shared by every scene. Flat, calm, six type sizes.
import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
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
  primary: 'bg-ink text-bg hover:bg-ink/90',
  hold: 'bg-hold-fill text-white hover:bg-hold-fill/90',
  ghost: 'border border-line-2 bg-transparent text-ink hover:border-mute hover:bg-surface-2',
} as const

export function Button({ variant = 'primary', size = 'md', kbd, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-3 whitespace-nowrap rounded-lg text-body font-semibold',
        'transition-colors duration-200 disabled:opacity-40',
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
        'inline-flex h-6 min-w-6 items-center justify-center rounded border border-line-2 px-1.5 font-mono text-meta leading-none text-inherit',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

type Tone = 'neutral' | 'accent' | 'hold' | 'verify' | 'clear'

const TONE: Record<Tone, string> = {
  neutral: 'outline-line-2 text-ink-2',
  accent: 'outline-accent/60 bg-accent/10 text-accent',
  hold: 'outline-hold/60 bg-hold/10 text-hold',
  verify: 'outline-verify/60 bg-verify/10 text-verify',
  clear: 'outline-clear/60 bg-clear/10 text-clear',
}

/** Badge: a slanted racing decal in condensed caps. Pass className "font-mono" for ids (kept upright). */
export function Chip({ tone = 'neutral', children, className, title }: {
  tone?: Tone; children: ReactNode; className?: string; title?: string
}) {
  const mono = /(^|\s)font-mono(\s|$)/.test(className ?? '')
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap outline-1 -outline-offset-1 outline-solid',
        mono
          ? 'rounded-lg px-2.5 py-0.5 text-meta'
          : 'decal trim-cap rounded-sm px-3 py-1.5 font-num text-body font-semibold uppercase leading-none tracking-[0.06em]',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-meta font-semibold uppercase tracking-[0.08em] text-mute', className)}>{children}</div>
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
      {/* trim-cap: Teko's tall line box would leave a gap between the number and its label */}
      <div className="tnum flex items-baseline gap-2 font-num font-bold leading-none">
        <span className={cx(v, 'trim-cap leading-none')}>{value}</span>
        {den != null && <span className={cx(d, 'trim-cap font-semibold leading-none text-mute')}>/ {den}</span>}
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
  return <span ref={ref} className={cx('tnum font-num', className)} />
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
      <div className="font-race text-title">{title}</div>
      {sub != null && <div className="text-body text-ink-2">{sub}</div>}
      {children != null && <div className="mt-4">{children}</div>}
    </div>
  )
}
