// Results tiles: one number with its denominator, and the static GPU vs CPU bars.
import type { ReactNode } from 'react'
import { num } from '../../lib/format'
import { CountUp } from '../../ui/primitives'

const whole = (v: number) => num(Math.round(v))

export function ScoreTile({ label, value, format = whole, den, note, children }: {
  label: string
  value?: number | null
  format?: (v: number) => string
  den?: number | null
  note?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="col-span-4 flex h-82 min-w-0 flex-col rounded-xl border border-line bg-surface p-8">
      <div className="text-body text-ink-2">{label}</div>
      <div className="mt-4 flex items-baseline gap-3 leading-none">
        <CountUp value={value} format={format} className="text-hero font-bold text-ink" />
        {den !== undefined && <span className="tnum font-num text-title text-mute">/ {num(den)}</span>}
      </div>
      {children}
      {note != null && note !== '' && <div className="mt-auto text-meta text-mute">{note}</div>}
    </div>
  )
}

/** Two static bars scaled to the slower run. */
export function BenchBars({ gpu, cpu }: { gpu?: number | null; cpu?: number | null }) {
  const max = Math.max(gpu ?? 0, cpu ?? 0) || 1
  const rows = [
    { k: 'GPU', v: gpu, fill: 'fill-accent' },
    { k: 'CPU', v: cpu, fill: 'fill-faint' },
  ]
  return (
    <div className="mt-6 flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.k} className="grid grid-cols-[3rem_1fr_4.5rem] items-center gap-3 text-meta">
          <span className="text-ink-2">{r.k}</span>
          <svg className="h-3 w-full" aria-hidden>
            <rect width="100%" height="100%" rx="3" className="fill-surface-2" />
            {r.v != null && <rect width={`${Math.max(1, (r.v / max) * 100)}%`} height="100%" rx="3" className={r.fill} />}
          </svg>
          <span className="tnum text-right text-ink-2">{r.v != null ? `${num(r.v, 1)} s` : '—'}</span>
        </div>
      ))}
    </div>
  )
}
