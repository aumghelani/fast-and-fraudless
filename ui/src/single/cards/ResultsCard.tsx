// Results: six numbers measured on the GB10, each with its denominator, straight from the eval data. "—" until it arrives.
import { useStore } from '../../lib/store'
import { num, pct } from '../../lib/format'
import { Card, MonoCount } from './kit'

const whole = (v: number) => num(Math.round(v))
const times = (v: number) => `${v.toFixed(1)}×`

function Cell({ label, value, format = whole, den }: {
  label: string; value?: number | null; format?: (v: number) => string; den?: number | null
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 border-t border-line pt-3">
      <div className="flex items-baseline gap-0.5 leading-none">
        <MonoCount value={value} format={format} className="text-[1.5rem] font-medium text-ink" />
        {den !== undefined && <span className="tnum font-mono text-[0.8125rem] text-mute">/{num(den)}</span>}
      </div>
      <span className="text-xs leading-snug text-ink-2">{label}</span>
    </div>
  )
}

export function ResultsCard() {
  const ev = useStore((s) => s.eval)
  const bench = useStore((s) => s.bench)
  const gpu = typeof bench?.gpu_s === 'number' ? bench.gpu_s : null
  const cpu = typeof bench?.cpu_s === 'number' ? bench.cpu_s : null
  const speedup = gpu && cpu ? cpu / gpu : null

  return (
    <Card title="Measured on the GB10">
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-x-5 gap-y-4">
        <Cell label="Scam calls held" value={ev?.scam_caught} den={ev?.scam_total ?? null} />
        <Cell label="False holds on normal calls" value={ev?.false_holds} den={ev?.normal_total ?? null} />
        <Cell label="Laundering rings recovered" value={ev?.rings_recovered} den={ev?.rings_total ?? null} />
        <Cell label="Escalated precision" value={ev?.flagged_precision} format={(v) => pct(v)} />
        <Cell label="Injections that changed a decision" value={ev?.redteam_decision_changed} den={ev?.redteam_attempts ?? null} />
        <Cell label="GPU vs CPU, same pandas code" value={speedup} format={times} />
      </div>
    </Card>
  )
}
