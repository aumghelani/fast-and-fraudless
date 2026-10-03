// Top row: mark, name and a synthetic-data note on the left; the link, the GB10 line and data sent out on the right.
import { Zap } from 'lucide-react'
import { useStore } from '../lib/store'
import { DASH, cx, num } from '../lib/format'
import { Pill } from './kit'

function Divider() {
  return <span aria-hidden className="h-5 w-px shrink-0 bg-line-2" />
}

/** Green dot while the page is streaming from the box; the words say whether the box can reach the internet. */
function LinkStatus() {
  const sse = useStore((s) => s.sse)
  const online = useStore((s) => s.net?.online)
  const uptime = useStore((s) => s.health?.uptime_s)
  const live = sse === 'live'
  const label = !live
    ? sse === 'connecting' ? 'Connecting' : 'Reconnecting'
    : online === false ? 'Offline · AI stays local' : 'Online'
  return (
    <Pill
      className="border border-line bg-surface text-[13px] uppercase tracking-[0.06em]"
      tone="mute"
    >
      <span aria-hidden className={cx('size-2 rounded-full', live ? 'bg-clear' : 'bg-faint')} />
      <span title={uptime != null ? `Box up ${num(uptime / 3600, 1)} h` : undefined}>{label}</span>
    </Pill>
  )
}

/** Compact live line from the box. */
function Gb10() {
  const t = useStore((s) => s.telemetry)
  const used = t?.mem_used_gb
  const mem = used == null ? DASH : t?.mem_total_gb != null ? `${num(used, 1)}/${num(t.mem_total_gb)} GB` : `${num(used, 1)} GB`
  return (
    <div className="tnum flex items-center gap-3 font-mono text-[14px] text-mute">
      <span className="font-semibold text-ink-2">GB10</span>
      <span>
        GPU <span className="text-ink">{t?.gpu_util == null ? DASH : `${num(t.gpu_util)}%`}</span>
      </span>
      <span>
        MEM <span className="text-ink">{mem}</span>
      </span>
      <span className="text-ink">{t?.temp_c == null ? DASH : `${num(t.temp_c)}°C`}</span>
    </div>
  )
}

function DataOut() {
  const n = useStore((s) => s.counters?.customer_data_out)
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[13px] uppercase tracking-[0.06em] text-mute">Customer data sent out</span>
      <span className={cx('tnum font-mono text-[18px] font-semibold', n == null ? 'text-mute' : n === 0 ? 'text-clear' : 'text-hold')}>
        {n == null ? DASH : num(n)}
      </span>
    </div>
  )
}

export function Header() {
  return (
    <header className="flex h-16 items-center justify-between">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-9 place-items-center rounded-[10px] bg-accent text-white">
          <Zap size={18} fill="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        </span>
        <span className="font-brand text-[26px] leading-none text-ink">Fast and Fraudless</span>
        <Pill className="ml-1 py-0.5 text-[12px] uppercase tracking-[0.08em] text-mute">Synthetic data</Pill>
      </div>
      <div className="flex items-center gap-5">
        <LinkStatus />
        <Divider />
        <Gb10 />
        <Divider />
        <DataOut />
      </div>
    </header>
  )
}
