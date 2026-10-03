// Header (64px, light): mark, wordmark and the synthetic-data pill on the left;
// network, the GB10 live line and "Customer data sent out" on the right. No step rail: one page.
import { useStore } from '../lib/store'
import { useBranding } from '../lib/branding'
import { DASH, cx, num } from '../lib/format'
import { Chip, Dot } from '../ui/primitives'

function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--color-accent)" />
      <path d="M7.5 17 L11.5 11 L15 14.5 L20.5 8.5" fill="none" stroke="#fff" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 20.5 H20.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** The one place Racing Sans One survives: the product name, in plain ink. */
function Wordmark({ name }: { name: string }) {
  return (
    <span className="wordmark font-race whitespace-nowrap text-ink" aria-label={name}>
      {name}
    </span>
  )
}

function Divider() {
  return <span aria-hidden className="h-6 w-px shrink-0 bg-line" />
}

function NetStatus() {
  const online = useStore((s) => s.net?.online)
  const sse = useStore((s) => s.sse)
  return (
    <div className="flex items-center gap-3">
      {sse !== 'live' && (
        <span className="whitespace-nowrap font-mono text-meta text-mute">
          {sse === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      )}
      {online === false ? (
        <Chip tone="hold" className="uppercase tracking-[0.06em]">
          <Dot tone="hold" />
          Offline · all inference local
        </Chip>
      ) : online === true ? (
        <Chip className="uppercase tracking-[0.06em]">
          <Dot tone="clear" />
          Online
        </Chip>
      ) : null}
    </div>
  )
}

/** Compact live line from the box: GPU load and memory. */
function Gb10Line() {
  const gpu = useStore((s) => s.telemetry?.gpu_util)
  const used = useStore((s) => s.telemetry?.mem_used_gb)
  const total = useStore((s) => s.telemetry?.mem_total_gb)
  const mem = used == null ? DASH : total != null ? `${num(used, 1)}/${num(total)} GB` : `${num(used, 1)} GB`
  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap font-mono text-meta text-mute">
      <span className="font-semibold text-ink-2">GB10</span>
      <span>
        GPU <span className="tnum text-ink">{gpu == null ? DASH : `${num(gpu)}%`}</span>
      </span>
      <span aria-hidden className="text-faint">·</span>
      <span>
        MEM <span className="tnum text-ink">{mem}</span>
      </span>
    </div>
  )
}

function DataOut() {
  const dataOut = useStore((s) => s.counters?.customer_data_out)
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      <span className="font-mono text-meta uppercase tracking-[0.06em] text-mute">Customer data sent out</span>
      <span className={cx('tnum font-mono text-lead font-semibold leading-none', dataOut ? 'text-hold' : 'text-ink')}>
        {num(dataOut)}
      </span>
    </div>
  )
}

export function Header() {
  const { productName, bankName } = useBranding()
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-6 border-b border-line bg-surface px-12">
      <div className="flex min-w-0 items-center gap-3">
        <Mark />
        <Wordmark name={productName} />
        {bankName && <span className="min-w-0 truncate font-mono text-meta text-mute">for {bankName}</span>}
        <Chip className="ml-2 uppercase tracking-[0.06em]">Synthetic data</Chip>
      </div>
      <div className="flex shrink-0 items-center gap-5">
        <NetStatus />
        <Divider />
        <Gb10Line />
        <Divider />
        <DataOut />
      </div>
    </header>
  )
}
