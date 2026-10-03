// Ring finder · GPU: transactions scanned, rings found and escalated, and the payee's ring when the call has one.
import { useStore } from '../../lib/store'
import { useStoryCall } from '../../flow/derive'
import { DASH, compact, cx, num, simClock, usd } from '../../lib/format'
import { Card } from './kit'
import { MiniPayeePath } from './MiniPayeePath'

function statusLine(total?: number, perSec?: number, replay?: string): string {
  if (perSec === 0 && total != null && total > 0) return 'Replay complete'
  if (perSec == null) return DASH
  return `${num(perSec)} tx/s · ${simClock(replay)?.time ?? DASH}`
}

function Fig({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="tnum font-mono text-[1.625rem] font-medium leading-none text-ink">{value}</span>
      <span className="truncate text-xs text-ink-2">{label}</span>
    </div>
  )
}

export function RingFinderCard() {
  const hydrated = useStore((s) => s.hydrated)
  const total = useStore((s) => s.tick?.tx_total)
  const perSec = useStore((s) => s.tick?.tx_per_sec)
  const replay = useStore((s) => s.tick?.replay_time)
  const found = useStore((s) => s.eval?.rings_found)
  const escalated = useStore((s) => s.eval?.rings_escalated)
  const shown = useStore((s) => s.ringOrder.length)
  const newestId = useStore((s) => s.ringOrder[s.ringOrder.length - 1])
  const newest = useStore((s) => (newestId ? s.rings[newestId] : undefined))
  const call = useStoryCall()
  const inRing = !!call?.payee_check?.in_ring
  const running = perSec != null && perSec > 0

  const status = (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] text-mute">
      <span className={cx('h-1.5 w-1.5 rounded-full', running ? 'bg-clear' : 'bg-faint')} />
      {statusLine(total, perSec, replay)}
    </span>
  )

  return (
    <Card title="Ring finder · GPU" right={status}>
      <div className="grid shrink-0 grid-cols-3 gap-4">
        <Fig value={compact(total)} label="transactions scanned" />
        <Fig value={num(found ?? (hydrated ? shown : null))} label="rings found" />
        <Fig value={num(escalated)} label="escalated" />
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-line pt-3">
        {call && inRing ? (
          <>
            <div className="flex shrink-0 items-baseline justify-between gap-3 text-xs">
              <span className="text-ink-2">This payee sits in a ring</span>
              <span className="font-mono text-hold">{call.payee_check?.ring_id ?? DASH}</span>
            </div>
            <div className="min-h-0 flex-1">
              <MiniPayeePath call={call} />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-2">Newest ring</span>
            {newest ? (
              <div className="flex min-w-0 items-baseline gap-2 font-mono text-[0.8125rem] text-ink">
                <span className="shrink-0">{newest.ring_id}</span>
                <span className="truncate text-ink-2">
                  · {newest.type || DASH} · {num(newest.accounts?.length)} accounts · {usd(newest.total_usd)}
                </span>
              </div>
            ) : (
              <span className="font-mono text-[0.8125rem] text-mute">{DASH}</span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
