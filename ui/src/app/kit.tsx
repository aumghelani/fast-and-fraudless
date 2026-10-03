// Shared building blocks for the page: card, pills, buttons, key hints.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/format'

export type Tone = 'accent' | 'hold' | 'verify' | 'clear' | 'mute'

/** White card. `bar` gives the solid indigo header (hero panels only); otherwise a quiet mono title. */
export function Card({ title, right, bar, className, bodyClassName, children }: {
  title?: ReactNode; right?: ReactNode; bar?: boolean; className?: string; bodyClassName?: string; children?: ReactNode
}) {
  return (
    <section className={cx('card flex min-h-0 flex-col overflow-hidden', className)}>
      {title != null &&
        (bar ? (
          <header className="flex h-11 shrink-0 items-center justify-between bg-accent px-5 font-mono text-[15px] font-medium text-white">
            <span>{title}</span>
            {right != null && <span className="text-[13px] text-white/80">{right}</span>}
          </header>
        ) : (
          <header className="flex shrink-0 items-center justify-between px-5 pt-4 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-ink-2">
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
        'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[15px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
