import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate } from 'motion'
import { DASH, cx } from '../lib/format'

/** Counts up/down to a new value when it changes (motion only on events). Shows — while null. */
export function AnimatedNumber({
  value, format, className,
}: { value: number | null | undefined; format: (v: number) => string; className?: string }) {
  const [shown, setShown] = useState<number | null>(value ?? null)
  const prev = useRef<number | null>(value ?? null)
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      prev.current = null
      setShown(null)
      return
    }
    const from = prev.current
    prev.current = value
    if (from == null || from === value) {
      setShown(value)
      return
    }
    const ctl = animate(from, value, { duration: 0.8, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(v) })
    return () => ctl.stop()
  }, [value])
  return <span className={cx('tnum', className)}>{shown == null ? DASH : format(shown)}</span>
}

export function PanelHeader({
  title, icon, right, sub,
}: { title: string; icon?: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-mute">{icon}</span>}
        <span className="panel-title truncate">{title}</span>
        {sub && <span className="truncate text-[0.7rem] text-mute">{sub}</span>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

export function Tag({ children, tone = 'grey', className }: {
  children: ReactNode; tone?: 'grey' | 'red' | 'green' | 'amber' | 'nv' | 'blue'; className?: string
}) {
  const tones: Record<string, string> = {
    grey: 'border-line-2 text-ink-2 bg-panel-2',
    red: 'border-danger/50 text-danger-ink bg-danger/10',
    green: 'border-safe/40 text-safe bg-safe/10',
    amber: 'border-amber/50 text-amber bg-amber/10',
    nv: 'border-nv/50 text-nv bg-nv/10',
    blue: 'border-sky-400/40 text-sky-300 bg-sky-400/10',
  }
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.66rem] font-semibold uppercase tracking-wider', tones[tone], className)}>
      {children}
    </span>
  )
}
