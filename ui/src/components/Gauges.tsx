import { Cpu } from 'lucide-react'
import { useStore } from '../lib/store'
import { num } from '../lib/format'
import { useEChart } from '../lib/useEChart'
import { PanelHeader } from './ui'

// Display scales only (not data): GB10 GPU util 0-100 %, power 0-150 W, temp 30-100 °C.
function Gauge({ value, min, max, unit, label, color }: {
  value: number | null | undefined; min: number; max: number; unit: string; label: string; color: string
}) {
  const v = value ?? null
  const ref = useEChart(
    {
      animationDurationUpdate: 900,
      animationEasingUpdate: 'cubicOut',
      series: [
        {
          type: 'gauge',
          min, max,
          startAngle: 215, endAngle: -35,
          radius: '88%',
          center: ['50%', '58%'],
          progress: { show: true, width: 9, roundCap: true, itemStyle: { color, shadowBlur: 12, shadowColor: color } },
          axisLine: { lineStyle: { width: 9, color: [[1, '#1a212c']] }, roundCap: true },
          axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
          anchor: { show: false }, title: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, '-4%'],
            formatter: (x: number) => (v == null ? '—' : `${Math.round(x)}`),
            color: '#e8edf4', fontSize: 22, fontWeight: 700, fontFamily: 'Inter Variable, Inter, sans-serif',
          },
          data: [{ value: v ?? min }],
        },
      ],
    },
    [v],
  )
  return (
    <div className="relative flex flex-col items-center">
      <div ref={ref} className="h-[6.4rem] w-full" />
      <div className="-mt-3 text-[0.62rem] uppercase tracking-widest text-mute">{label} <span className="normal-case">{unit}</span></div>
    </div>
  )
}

export function Gauges() {
  const t = useStore((s) => s.telemetry)
  const used = t?.mem_used_gb
  const total = t?.mem_total_gb
  const frac = used != null && total ? used / total : null
  return (
    <div className="panel shrink-0">
      <PanelHeader title="GB10" icon={<Cpu className="h-4 w-4 text-nv" />} sub="live telemetry · nvidia-smi + /proc/meminfo" />
      <div className="grid grid-cols-3 gap-1 px-2">
        <Gauge value={t?.gpu_util} min={0} max={100} unit="%" label="GPU util" color="#76b900" />
        <Gauge value={t?.power_w} min={0} max={150} unit="W" label="power" color="#76b900" />
        <Gauge value={t?.temp_c} min={30} max={100} unit="°C" label="temp" color={t?.temp_c != null && t.temp_c > 85 ? '#f5a524' : '#76b900'} />
      </div>
      <div className="px-4 pt-1 pb-3">
        <div className="mb-1 flex items-baseline justify-between text-[0.7rem]">
          <span className="uppercase tracking-widest text-mute">unified memory</span>
          <span className="tnum text-ink"><b className="text-[0.95rem]">{num(used, 1)}</b> / {num(total, 1)} GB</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-gradient-to-r from-nv/70 to-nv transition-[width] duration-1000 ease-out" style={{ width: `${(frac ?? 0) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
