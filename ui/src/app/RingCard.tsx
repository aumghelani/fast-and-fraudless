// GPU ring finder: how much it scanned, what it found, and the ring that matters right now.
import { useMemo } from 'react'
import { useStore } from '../lib/store'
import { compact, DASH, num, simClock, usd } from '../lib/format'
import { Card } from './kit'
import { useActiveCall, useRing, verdictOf } from './selectors'
import { PayeeGraph, RingShape } from './ring/RingGraph'

function Status() {
  const tick = useStore((s) => s.tick)
  if (!tick) return <>{DASH}</>
  if ((tick.tx_per_sec ?? 0) > 0) {
    const c = simClock(tick.replay_time)
    return (
      <span className="inline-flex items-center gap-1.5 font-mono">
        <span className="size-1.5 rounded-full bg-accent" />
        replay {c ? c.time : ''}
      </span>
    )
  }
  return <span className="font-mono">{tick.tx_total ? 'replay complete' : 'idle'}</span>
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="tnum font-mono text-[20px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1.5 font-mono text-[12px] text-mute">{label}</div>
    </div>
  )
}

export function RingCard() {
  const tick = useStore((s) => s.tick)
  const bench = useStore((s) => s.bench)
  const ev = useStore((s) => s.eval)
  const rings = useStore((s) => s.rings)
  const order = useStore((s) => s.ringOrder)

  const call = useActiveCall()
  const pc = call?.payee_check
  const inRing = !!pc?.in_ring && !!pc.ring_id
  const payeeRing = useRing(inRing ? pc?.ring_id : null)

  // newest escalated ring (ringOrder is oldest first)
  const newest = useMemo(() => {
    for (let i = order.length - 1; i >= 0; i--) if (rings[order[i]]?.tier === 'escalate') return rings[order[i]]
    return order.length ? rings[order[order.length - 1]] : undefined
  }, [rings, order])
  const escalatedHere = useMemo(() => Object.values(rings).filter((r) => r.tier === 'escalate').length, [rings])

  const scanned = tick?.tx_total ?? bench?.rows
  const found = ev?.rings_found ?? (order.length || null)
  const escalated = ev?.rings_escalated ?? (escalatedHere || null)
  const hubColor = verdictOf(call) === 'HOLD' ? 'var(--color-hold)' : 'var(--color-accent)'
  const hops = pc?.hops

  return (
    <Card title="Ring finder · GPU" right={<Status />} className="h-full" bodyClassName="flex flex-col px-5 pb-4 pt-3">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="tnum font-mono text-[34px] font-semibold leading-none tracking-tight text-ink">
            {scanned ? compact(scanned) : DASH}
          </div>
          <div className="mt-2 text-[13.5px] text-mute">transactions scanned on the GB10</div>
        </div>
        <Figure value={num(found)} label="rings found" />
        <Figure value={num(escalated)} label="escalated" />
      </div>

      <div className="relative mt-3 min-h-0 flex-1 border-t border-line pt-2">
        <div className="absolute left-0 top-2 font-mono text-[11.5px] text-faint">
          {inRing ? 'payee path' : newest ? 'newest escalated ring' : ''}
        </div>
        {inRing && call ? (
          <PayeeGraph key={call.call_id} call={call} ring={payeeRing} color={hubColor} />
        ) : newest ? (
          <RingShape ring={newest} />
        ) : (
          <div className="grid h-full place-items-center font-mono text-[13px] text-faint">no ring yet</div>
        )}
      </div>

      <div className="mt-1 truncate font-mono text-[13px] text-ink-2">
        {inRing ? (
          <>
            Payee feeds ring <span style={{ color: hubColor }}>{pc?.ring_id}</span>
            <span className="text-mute"> · {hops != null ? `${hops} ${hops === 1 ? 'hop' : 'hops'}` : DASH}</span>
          </>
        ) : newest ? (
          <>
            <span className="text-accent">{newest.ring_id}</span>
            <span className="text-mute">
              {[newest.type, newest.accounts?.length ? `${newest.accounts.length} accounts` : null, newest.total_usd != null ? usd(newest.total_usd) : null]
                .filter(Boolean)
                .map((s) => ` · ${s}`)
                .join('')}
            </span>
          </>
        ) : (
          <span className="text-mute">{DASH}</span>
        )}
      </div>
    </Card>
  )
}
