// Measured numbers from the eval runs on the box, each with its denominator. "—" until they arrive.
import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { cx, num, pct } from '../lib/format'
import { Card } from './kit'
import { Roll } from './ring/Stat'

type Cell = { label: string; value?: number | null; digits?: number; suffix?: string; den?: number | null; note?: ReactNode }

const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function ResultsCard() {
  const ev = useStore((s) => s.eval)
  const bench = useStore((s) => s.bench)

  const speed = has(bench?.cpu_s) && has(bench?.gpu_s) && bench.gpu_s > 0 ? bench.cpu_s / bench.gpu_s : null
  const cells: Cell[] = [
    // long labels sit in the outer columns, where cells are widest
    { label: 'scam calls held', value: ev?.scam_caught, den: ev?.scam_total, note: 'synthetic scam calls' },
    {
      label: 'false holds',
      value: ev?.false_holds,
      den: ev?.normal_total,
      note: has(ev?.verify_flags) ? `${num(ev.verify_flags)} sent to verify` : 'normal calls',
    },
    { label: 'rings recovered', value: ev?.rings_recovered, den: ev?.rings_total, note: 'laundering rings' },
    {
      label: 'escalated precision',
      value: has(ev?.flagged_precision) ? ev.flagged_precision * 100 : null,
      digits: 1,
      suffix: '%',
      note: has(ev?.flagged_precision_all) ? `all flagged ${pct(ev.flagged_precision_all)}` : null,
    },
    {
      label: 'GPU vs CPU',
      value: speed,
      digits: 1,
      suffix: '×',
      note: speed != null ? `${num(bench?.gpu_s, 1)} s vs ${num(bench?.cpu_s, 1)} s` : null,
    },
    { label: 'injection attempts', value: ev?.redteam_decision_changed, den: ev?.redteam_attempts, note: 'changed a decision' },
  ]

  return (
    <Card title="Measured on the GB10" right={ev ? 'eval runs' : null} className="h-full" bodyClassName="px-5 pb-4 pt-3">
      <div className="grid h-full grid-cols-[1.06fr_0.94fr_1fr] grid-rows-2">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={cx(
              'flex min-w-0 flex-col border-line',
              i % 3 === 0 ? 'pr-3' : 'border-l px-3',
              i % 3 === 2 && 'pr-0',
              i >= 3 ? 'border-t pt-3' : 'pb-3',
            )}
          >
            <div className="truncate font-mono text-[10.5px] text-ink-2">{c.label}</div>
            <div className="mt-auto flex items-baseline gap-1 whitespace-nowrap font-mono leading-none">
              <Roll value={c.value} digits={c.digits} suffix={c.suffix} className="text-[28px] font-semibold text-ink" />
              {c.den !== undefined && <span className="tnum text-[13px] text-mute">/{num(c.den)}</span>}
            </div>
            <div className="mt-2 min-h-4 truncate text-[11.5px] text-mute">{c.note ?? ''}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
