import { Gauge, Timer, Zap } from 'lucide-react'
import { useStore } from '../lib/store'
import { compact, num, simClock } from '../lib/format'
import { useEChart } from '../lib/useEChart'
import { AnimatedNumber, PanelHeader } from './ui'

function Sparkline() {
  const hist = useStore((s) => s.txHistory)
  const ref = useEChart(
    {
      animation: true,
      animationDurationUpdate: 600,
      grid: { left: 0, right: 0, top: 4, bottom: 0 },
      xAxis: { type: 'category', show: false, boundaryGap: false, data: hist.map((h) => h.t) },
      yAxis: { type: 'value', show: false, min: 0 },
      series: [
        {
          type: 'line',
          data: hist.map((h) => h.v),
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: (_v: unknown, p: { dataIndex: number }) => (p.dataIndex === hist.length - 1 ? 6 : 0),
          lineStyle: { color: '#76b900', width: 2 },
          itemStyle: { color: '#76b900' },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: 'rgba(118,185,0,0.28)' }, { offset: 1, color: 'rgba(118,185,0,0)' }],
            },
          },
        },
      ],
    },
    [hist],
  )
  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-0" />
      {hist.length < 2 && (
        <div className="absolute inset-0 flex items-end pb-1 text-[0.62rem] text-mute">tx/s history builds with each GPU cycle</div>
      )}
    </div>
  )
}

function BenchBar() {
  const bench = useStore((s) => s.bench)
  const cpu = typeof bench?.cpu_s === 'number' ? bench.cpu_s : null
  const gpu = typeof bench?.gpu_s === 'number' ? bench.gpu_s : null
  const speedup = cpu != null && gpu != null && gpu > 0 ? cpu / gpu : null
  const max = Math.max(cpu ?? 0, gpu ?? 0) || 1
  return (
    <div className="px-4 pb-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="panel-title">GPU vs CPU · same pandas code</span>
        <span className="text-[0.7rem] text-mute">
          {bench?.rows != null ? `${compact(bench.rows)} rows` : '—'}
        </span>
      </div>
      {[
        { k: 'CPU · pandas', v: cpu, c: '#5a6474' },
        { k: 'GPU · cudf.pandas', v: gpu, c: '#76b900' },
      ].map((b) => (
        <div key={b.k} className="mb-1 flex items-center gap-2">
          <span className="w-[7.5rem] shrink-0 text-[0.72rem] text-ink-2">{b.k}</span>
          <div className="relative h-3.5 flex-1 overflow-hidden rounded bg-panel-2">
            {b.v != null && (
              <div
                className="h-full rounded transition-[width] duration-700"
                style={{ width: `${Math.max(1.5, (b.v / max) * 100)}%`, background: b.c }}
              />
            )}
          </div>
          <span className="tnum w-[4.5rem] text-right font-mono text-[0.78rem] text-ink">{b.v != null ? `${num(b.v, 2)} s` : '—'}</span>
        </div>
      ))}
      <div className="mt-1 text-right text-[0.78rem]">
        {speedup != null ? (
          <span className="font-bold text-nv">{num(speedup, 1)}× faster on the GPU</span>
        ) : (
          <span className="text-mute">benchmark not run yet</span>
        )}
      </div>
    </div>
  )
}

export function Throughput() {
  const tick = useStore((s) => s.tick)
  const clock = simClock(tick?.replay_time)
  return (
    <div className="panel flex shrink-0 flex-col">
      <PanelHeader title="Transaction replay" icon={<Zap className="h-4 w-4" />} sub="IBM AML HI-Medium · SYNTHETIC" />
      <div className="grid grid-cols-[auto_1fr] gap-x-5 px-4 pb-2">
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-widest text-mute">
              <Timer className="h-3 w-3" /> replay clock
            </div>
            <div className="tnum font-mono text-[1.45rem] font-semibold leading-tight text-ink">{clock?.time ?? '—'}</div>
            <div className="text-[0.7rem] text-ink-2">{clock?.date ?? '—'}</div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[0.62rem] uppercase tracking-widest text-mute">transactions processed on GPU</div>
              <AnimatedNumber value={tick?.tx_total} format={(v) => num(Math.round(v))} className="text-[1.45rem] font-bold text-ink" />
            </div>
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 text-[0.62rem] uppercase tracking-widest text-mute">
                <Gauge className="h-3 w-3" /> tx / s
              </div>
              <AnimatedNumber value={tick?.tx_per_sec} format={(v) => num(Math.round(v))} className="text-[1.45rem] font-bold text-nv" />
            </div>
          </div>
          <div className="mt-1 h-[2.6rem]">
            <Sparkline />
          </div>
        </div>
      </div>
      <div className="mx-4 mb-2 flex items-baseline gap-2 rounded-md border border-line bg-panel-2/60 px-3 py-1.5">
        <span className="tnum text-[1.15rem] font-bold text-ink">{tick?.tx_total != null ? compact(tick.tx_total) : '—'}</span>
        <span className="text-[0.74rem] text-ink-2">transactions replayed through GB10 GPU memory, re-scanned every cycle</span>
        {tick?.cycle_s != null && <span className="ml-auto text-[0.68rem] text-mute">cycle {num(tick.cycle_s, 1)} s</span>}
      </div>
      <BenchBar />
    </div>
  )
}
