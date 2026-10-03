// Header: brand on the left, the step rail in the centre, network and data-out on the right.
import { useStore } from '../lib/store'
import { useBranding } from '../lib/branding'
import { num } from '../lib/format'
import { Chip } from '../ui/primitives'
import { StepRail } from './StepRail'

function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden>
      <rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      <path d="M8 18.5 L13 9.5 L15.5 14 L20 7.5" fill="none" stroke="var(--color-accent)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="19" r="2.2" fill="var(--color-accent)" />
    </svg>
  )
}

function NetStatus() {
  const online = useStore((s) => s.net?.online)
  const sse = useStore((s) => s.sse)
  return (
    <div className="flex items-center gap-3">
      {sse !== 'live' && (
        <span className="text-meta text-mute">{sse === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
      )}
      {online === false ? (
        <Chip tone="hold">
          <span className="h-1.5 w-1.5 rounded-full bg-hold" />
          Offline · all inference local
        </Chip>
      ) : online === true ? (
        <span className="inline-flex items-center gap-2 text-meta text-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-2" />
          Online
        </span>
      ) : null}
    </div>
  )
}

export function Header() {
  const { productName, bankName } = useBranding()
  const dataOut = useStore((s) => s.counters?.customer_data_out)
  return (
    <header className="relative z-20 flex h-18 shrink-0 items-center justify-between gap-8 border-b border-line bg-bg px-12">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Mark />
        <span className="truncate text-body font-semibold">{productName}</span>
        {bankName && <span className="truncate text-meta text-ink-2">for {bankName}</span>}
        <Chip>Synthetic data</Chip>
      </div>
      <StepRail />
      <div className="flex flex-1 items-center justify-end gap-6">
        <NetStatus />
        <span aria-hidden className="h-8 w-px bg-line" />
        <div className="flex flex-col items-end">
          <span className="text-meta text-mute">Customer data sent out</span>
          <span className="tnum text-lead font-semibold leading-tight">{num(dataOut)}</span>
        </div>
      </div>
    </header>
  )
}
