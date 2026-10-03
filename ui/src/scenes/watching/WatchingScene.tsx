// Scene 1 · Watching: the GPU scans every transaction for laundering rings; the 3-D map sits behind.
import { useMemo } from 'react'
import { useStore } from '../../lib/store'
import { DASH, compact, num, simClock, usd } from '../../lib/format'
import { SceneFrame } from '../../shell/SceneFrame'
import { StartTray } from '../../shell/StartTray'
import { Eyebrow, Reveal, Stat } from '../../ui/primitives'

function statusLine(total?: number, perSec?: number, replay?: string): string {
  if (perSec === 0 && total != null && total > 0) return 'Replay complete'
  if (perSec == null) return DASH
  return `${num(perSec)} tx/s · replay clock ${simClock(replay)?.time ?? DASH}`
}

export function WatchingScene() {
  const hydrated = useStore((s) => s.hydrated)
  const total = useStore((s) => s.tick?.tx_total)
  const perSec = useStore((s) => s.tick?.tx_per_sec)
  const replay = useStore((s) => s.tick?.replay_time)
  const found = useStore((s) => s.eval?.rings_found)
  const escalated = useStore((s) => s.eval?.rings_escalated)
  const shown = useStore((s) => s.ringOrder.length)
  const gpu = useStore((s) => s.telemetry?.gpu_util)
  const used = useStore((s) => s.telemetry?.mem_used_gb)
  const max = useStore((s) => s.telemetry?.mem_total_gb)

  return (
    <SceneFrame headline="Watching every transaction for laundering rings" subline="On one Dell Pro Max GB10, inside the bank.">
      <div className="col-span-4 flex min-h-0 flex-col">
        <Reveal order={0}>
          <Stat size="display" value={compact(total)} label="transactions scanned on the GPU" />
        </Reveal>
        <Reveal order={1} className="mt-12 flex flex-col gap-8">
          <div className="flex gap-12">
            <Stat value={num(found ?? (hydrated ? shown : null))} label="rings found" />
            <Stat value={num(escalated)} label="escalated" />
          </div>
          <div className="tnum flex flex-col gap-1 text-body text-ink-2">
            <p>{statusLine(total, perSec, replay)}</p>
            <p>
              GB10 · GPU {num(gpu)}% · {num(used, 1)} of {num(max, 1)} GB in memory
            </p>
          </div>
        </Reveal>
        <div className="mt-auto pt-8">
          <StartTray />
        </div>
      </div>
    </SceneFrame>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line py-2">
      <span className="text-ink-2">{k}</span>
      <span className={mono ? 'tnum font-mono text-ink' : 'tnum text-ink'}>{v}</span>
    </div>
  )
}

export function WatchingDetails() {
  const rings = useStore((s) => s.rings)
  const order = useStore((s) => s.ringOrder)
  const tick = useStore((s) => s.tick)
  const bench = useStore((s) => s.bench)
  const newest = useMemo(() => order.slice(-10).reverse(), [order])
  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const id of order) {
      const t = rings[id]?.type || 'unknown'
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [rings, order])
  const clock = simClock(tick?.replay_time)
  const b = (k: string) => (typeof bench?.[k] === 'number' ? (bench[k] as number) : null)

  return (
    <div className="flex flex-col gap-10">
      <section>
        <Eyebrow className="mb-3">Newest rings</Eyebrow>
        {newest.length === 0 && <div className="text-mute">{DASH}</div>}
        {newest.map((id) => {
          const r = rings[id]
          return (
            <div key={id} className="grid grid-cols-[7rem_1fr_auto_auto] items-baseline gap-4 border-b border-line py-2">
              <span className="font-mono text-ink">{id}</span>
              <span className="truncate text-ink-2">
                {r?.type || DASH} · {r?.tier || DASH}
              </span>
              <span className="tnum text-ink-2">{num(r?.accounts?.length)} accts</span>
              <span className="tnum text-ink">{usd(r?.total_usd)}</span>
            </div>
          )
        })}
      </section>
      <section>
        <Eyebrow className="mb-3">Rings by type · {num(order.length)} on the map feed</Eyebrow>
        {byType.length === 0 && <div className="text-mute">{DASH}</div>}
        {byType.map(([t, n]) => (
          <Row key={t} k={t} v={num(n)} />
        ))}
      </section>
      <section>
        <Eyebrow className="mb-3">Replay</Eyebrow>
        <Row k="Date" v={clock?.date ?? DASH} />
        <Row k="Time" v={clock?.time ?? DASH} mono />
        <Row k="Cycle" v={tick?.cycle_s != null ? `${num(tick.cycle_s, 1)} s` : DASH} />
      </section>
      <section>
        <Eyebrow className="mb-3">Benchmark · same pandas code</Eyebrow>
        <Row k="Rows" v={num(b('rows'))} />
        <Row k="GPU total" v={b('gpu_s') != null ? `${num(b('gpu_s'), 1)} s` : DASH} />
        <Row k="CPU total" v={b('cpu_s') != null ? `${num(b('cpu_s'), 1)} s` : DASH} />
        <Row k="GPU load / detect" v={`${num(b('gpu_load_s'), 1)} s / ${num(b('gpu_detect_s'), 1)} s`} />
        <Row k="CPU load / detect" v={`${num(b('cpu_load_s'), 1)} s / ${num(b('cpu_detect_s'), 1)} s`} />
      </section>
    </div>
  )
}
