// Proof: nothing about the customer leaves the bank, counted from the OpenShell egress log.
import { useMemo, useState, type ReactNode } from 'react'
import { useStore } from '../../lib/store'
import { DASH, cx, hms, num, toDate } from '../../lib/format'
import { SceneFrame } from '../../shell/SceneFrame'
import { Eyebrow, Reveal, Stat } from '../../ui/primitives'
import { LeakTest } from './LeakTest'

function hhmm(t?: string | number | null): string {
  const d = toDate(t)
  return d ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : DASH
}

export function ProofScene() {
  const counters = useStore((s) => s.counters)
  const watchdog = useStore((s) => s.watchdog)
  const restored = useStore((s) => s.health?.restored)
  const rec = watchdog?.recoveries
  const last = watchdog?.last_recovery

  let healing = `${num(rec)} automatic ${rec === 1 ? 'recovery' : 'recoveries'}`
  if (last?.ts) healing += ` · last ${hhmm(last.ts)}${last.target ? ` (${last.target})` : ''}`

  return (
    <SceneFrame headline="Nothing about the customer leaves the bank" subline="Counted from the OpenShell egress log on the box.">
      <Reveal order={0} className="col-span-6 flex min-h-0 flex-col gap-12">
        <Stat size="display" value={num(counters?.customer_data_out)} label="customer records sent out" />
        <div className="flex gap-16">
          <Stat value={num(counters?.denied_total)} label="outbound attempts denied" />
          <Stat value={num(counters?.alerts_sent)} label="alerts sent · content-free" />
        </div>
        <div className="flex flex-col gap-2 text-body text-ink-2">
          <span>{healing}</span>
          {restored && <span>Survived a restart: state restored from MongoDB</span>}
        </div>
      </Reveal>
      <Reveal order={1} className="col-span-6 min-h-0">
        <LeakTest />
      </Reveal>
    </SceneFrame>
  )
}

// --- details

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Eyebrow>{title}</Eyebrow>
        {right}
      </div>
      {children}
    </section>
  )
}

function duration(s?: number | null): string {
  if (s == null || !Number.isFinite(s)) return DASH
  const t = Math.floor(s)
  if (t < 60) return `${t} s`
  if (t < 3600) return `${Math.floor(t / 60)} min ${t % 60} s`
  return `${Math.floor(t / 3600)} h ${Math.floor((t % 3600) / 60)} min`
}

export function ProofDetails() {
  const egress = useStore((s) => s.egress)
  const watchdog = useStore((s) => s.watchdog)
  const uptime = useStore((s) => s.health?.uptime_s)
  const [hidePolls, setHidePolls] = useState(true)

  const rows = useMemo(() => {
    const out = []
    for (const r of egress) {
      if (hidePolls && r.kind === 'poll') continue
      out.push(r)
      if (out.length >= 10) break
    }
    return out
  }, [egress, hidePolls])
  const policies = useMemo(
    () => Array.from(new Set(egress.map((r) => r.policy).filter((p): p is string => !!p))),
    [egress],
  )
  const last = watchdog?.last_recovery
  const checks = Object.entries(watchdog?.checks ?? {})

  return (
    <div>
      <Section
        title="Egress log · newest 10"
        right={
          <button
            aria-pressed={hidePolls}
            className="rounded-lg border border-line-2 px-2 text-meta text-ink-2 transition-colors duration-200 hover:border-mute"
            onClick={() => setHidePolls((v) => !v)}
          >
            Hide polls · {hidePolls ? 'on' : 'off'}
          </button>
        }
      >
        {rows.length === 0 && <div className="text-mute">{DASH}</div>}
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <div
              key={r._k}
              className={cx('flex gap-3 whitespace-nowrap font-mono text-meta', r.kind === 'poll' && 'opacity-50')}
              title={r.reason ?? undefined}
            >
              <span className="tnum shrink-0 text-mute">{hms(r.ts)}</span>
              <span className={cx('w-16 shrink-0', r.verdict === 'DENIED' ? 'text-hold' : 'text-ink-2')}>{r.verdict ?? DASH}</span>
              <span className="min-w-0 truncate text-ink">{r.dest ?? DASH}</span>
              {r.policy && <span className="shrink-0 text-mute">{r.policy}</span>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Policies seen">
        <div className="font-mono text-meta text-ink-2">{policies.length ? policies.join(' · ') : DASH}</div>
      </Section>

      <Section title="Watchdog">
        <div className="flex flex-col gap-1 font-mono text-meta text-ink-2">
          {checks.length === 0 && <span className="text-mute">{DASH}</span>}
          {checks.map(([k, v]) => (
            <span key={k}>
              {k}: {String(v)}
            </span>
          ))}
        </div>
        <div className="mt-4 text-body text-ink-2">Recoveries · {num(watchdog?.recoveries)}</div>
        {last && (
          <div className="mt-1 text-meta text-mute">
            Last: {[last.target, last.action, last.reason, hms(last.ts)].filter(Boolean).join(' · ')}
          </div>
        )}
      </Section>

      <Section title="Backend">
        <div className="text-body text-ink-2">Uptime · {duration(uptime)}</div>
      </Section>
    </div>
  )
}
