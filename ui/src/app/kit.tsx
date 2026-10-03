// Shared building blocks for the page: card, pills, buttons, key hints.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from './selectors'
import { cx } from '../lib/format'

export type Tone = 'accent' | 'hold' | 'verify' | 'clear' | 'mute'

/** White card. `bar` gives the solid indigo header (hero panels only); otherwise a quiet mono title. */
export function Card({ title, right, bar, barClass, className, bodyClassName, children }: {
  title?: ReactNode; right?: ReactNode; bar?: boolean; barClass?: string; className?: string; bodyClassName?: string; children?: ReactNode
}) {
  return (
    <section className={cx('card flex min-h-0 flex-col overflow-hidden', className)}>
      {title != null &&
        (bar ? (
          <header className={cx('flex h-12 shrink-0 items-center justify-between px-5 font-mono text-[16px] font-medium text-white transition-colors duration-500', barClass ?? 'bg-accent')}>
            <span>{title}</span>
            {right != null && <span className="text-[13.5px] text-white/85">{right}</span>}
          </header>
        ) : (
          <header className="flex shrink-0 items-center justify-between px-5 pt-4 font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-ink-2">
            <span>{title}</span>
            {right != null && <span className="normal-case tracking-normal text-mute">{right}</span>}
          </header>
        ))}
      <div className={cx('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

const PILL: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  hold: 'bg-hold-soft text-hold',
  verify: 'bg-verify-soft text-verify',
  clear: 'bg-clear-soft text-clear',
  mute: 'bg-surface-2 text-ink-2',
}

export function Pill({ tone = 'mute', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[13px] font-medium', PILL[tone], className)}>
      {children}
    </span>
  )
}

export function Button({ variant = 'ghost', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'hold' | 'ghost'
}) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-white hover:opacity-90',
        variant === 'hold' && 'bg-hold-fill text-white hover:opacity-90',
        variant === 'ghost' && 'border border-line-2 bg-surface text-ink hover:bg-surface-2',
        className,
      )}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-surface-2 px-1.5 font-mono text-[11px] text-ink-2">{children}</kbd>
}

const GLOW_RGB = { hold: '229 72 77', verify: '212 138 0', clear: '23 163 90' } as const
const CARD_SHADOW = '0 1px 2px rgb(22 26 46 / 0.06), 0 8px 28px rgb(22 26 46 / 0.07)'

/** Card whose edge glows: pulsing red on fraud while live, amber to verify, green when clear. */
export function GlowCard({ tone, pulsing, className, children }: {
  tone: keyof typeof GLOW_RGB | null; pulsing: boolean; className?: string; children: ReactNode
}) {
  const still = usePrefersReducedMotion()
  const rgb = tone ? GLOW_RGB[tone] : null
  const a = rgb ? `0 0 0 2px rgb(${rgb} / 0.55), 0 0 26px 2px rgb(${rgb} / 0.30), ${CARD_SHADOW}` : `0 0 0 0px rgb(0 0 0 / 0), 0 0 0px 0px rgb(0 0 0 / 0), ${CARD_SHADOW}`
  const b = rgb ? `0 0 0 2px rgb(${rgb} / 0.95), 0 0 54px 10px rgb(${rgb} / 0.22), ${CARD_SHADOW}` : a
  const pulse = !!rgb && pulsing && !still
  return (
    <motion.section
      className={cx('rounded-[var(--radius-card)] bg-surface', className)}
      initial={false}
      animate={{ boxShadow: pulse ? [a, b, a] : a }}
      transition={pulse ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.5 }}
    >
      {children}
    </motion.section>
  )
}
