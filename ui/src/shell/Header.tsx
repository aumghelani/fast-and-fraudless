// Header: chrome wordmark on the left, the step rail in the centre, network and data-out on the right.
import { useStore } from '../lib/store'
import { useBranding } from '../lib/branding'
import { num } from '../lib/format'
import { Chip } from '../ui/primitives'
import { StepRail } from './StepRail'

function Mark() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden>
      <path d="M7 4 H25 L21 24 H3 Z" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9.5 18 L13 10.5 L15.5 14.5 L19.5 8" fill="none" stroke="var(--color-accent)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Product name in chrome capitals; the last word carries a faint nitro-blue edge. */
function Wordmark({ name }: { name: string }) {
  const words = name.toUpperCase().split(/\s+/).filter(Boolean)
  const last = words.pop() ?? ''
  return (
    <span className="wordmark font-race whitespace-nowrap" aria-label={name}>
      {words.length > 0 && <span className="chrome-text">{words.join(' ')} </span>}
      <span className="chrome-text nitro-edge">{last}</span>
    </span>
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
        <Chip>
          <span className="h-1.5 w-1.5 rounded-full bg-ink-2" />
          Online
        </Chip>
      ) : null}
    </div>
  )
}

export function Header() {
  const { productName, bankName } = useBranding()
  const dataOut = useStore((s) => s.counters?.customer_data_out)
  return (
    <header className="relative z-20 flex h-18 shrink-0 items-center justify-between gap-5 border-b border-line bg-bg px-12">
      {/* the brand group keeps its natural width so it never runs into the rail at 1440 */}
      <div className="flex flex-1 items-center gap-3">
        <Mark />
        <Wordmark name={productName} />
        {bankName && <span className="min-w-0 truncate text-meta text-ink-2">for {bankName}</span>}
        <Chip className="ml-1">Synthetic data</Chip>
      </div>
      <StepRail />
      <div className="flex flex-1 items-center justify-end gap-4">
        <NetStatus />
        <span aria-hidden className="decal h-8 w-px bg-line-2" />
        <div className="flex flex-col items-end gap-1">
          <span className="whitespace-nowrap text-meta text-mute">Customer data sent out</span>
          <span className="tnum font-num text-title font-bold leading-none">{num(dataOut)}</span>
        </div>
      </div>
    </header>
  )
}
