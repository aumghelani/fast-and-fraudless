import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { num, pct } from '../lib/format'
import { AnimatedNumber } from './ui'

function Stat({ label, value, den, tone = 'ink', note }: {
  label: string; value: number | null | undefined; den?: number | null; tone?: 'ink' | 'safe' | 'danger'; note?: ReactNode
}) {
  const color = tone === 'safe' ? 'text-safe' : tone === 'danger' ? 'text-danger-ink' : 'text-ink'
  return (
    <div className="flex min-w-0 flex-col justify-center border-l border-line px-5 first:border-l-0">
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <AnimatedNumber value={value} format={(v) => num(Math.round(v))} className={`text-[2.1rem] font-black leading-none ${color}`} />
        {den !== undefined && <span className="tnum text-[1.1rem] font-semibold text-mute">/ {num(den)}</span>}
      </div>
      {note && <div className="truncate text-[0.66rem] text-mute">{note}</div>}
    </div>
  )
}

export function EvalStrip() {
  const ev = useStore((s) => s.eval)
  const counters = useStore((s) => s.counters)
  const byType = ev?.by_type
  return (
    <footer className="glass-strong flex h-[5.4rem] shrink-0 items-stretch border-t border-line px-3">
      <div className="flex flex-col justify-center pr-5 pl-2">
        <div className="text-[0.72rem] font-black tracking-[0.24em] text-ink">EVAL</div>
        <div className="text-[0.6rem] text-mute">labelled synthetic data</div>
      </div>
      <Stat
        label="laundering attempts recovered"
        value={ev?.rings_recovered}
        den={ev?.rings_total ?? null}
        note={
          <>
            seen so far in replay{ev?.rings_total_all != null ? ` · ${num(ev.rings_total_all)} in full dataset` : ''}
            {ev?.rings_recovered_escalated != null ? ` · ${num(ev.rings_recovered_escalated)} via escalated rings` : ''}
          </>
        }
      />
      <div className="flex min-w-0 flex-col justify-center border-l border-line px-5">
        <div className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-2">escalated precision</div>
        <AnimatedNumber value={ev?.flagged_precision} format={(v) => pct(v)} className="text-[2.1rem] font-black leading-none text-ink" />
        <div className="truncate text-[0.66rem] text-mute">laundering share of escalated-ring txns · all flagged {pct(ev?.flagged_precision_all)}</div>
      </div>
      {byType && (
        <div className="hidden min-w-0 flex-col justify-center gap-0.5 border-l border-line px-4 2xl:flex">
          {Object.entries(byType).slice(0, 8).reduce<[string, [number, number]][][]>((rows, e, i) => {
            ;(rows[i % 2] ||= []).push(e as [string, [number, number]])
            return rows
          }, []).map((row, r) => (
            <div key={r} className="flex gap-3 text-[0.62rem]">
              {row.map(([k, [a, b]]) => (
                <span key={k} className="tnum whitespace-nowrap text-mute">
                  {k.toLowerCase()} <span className={a > 0 ? 'text-ink-2' : 'text-dim'}>{a}/{b}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      <Stat label="scam calls caught" value={ev?.scam_caught} den={ev?.scam_total ?? null} tone="safe" note={ev?.label ? String(ev.label) : 'replayed through the full pipeline'} />
      <Stat label="false HOLDs" value={ev?.false_holds} den={ev?.normal_total ?? null} tone={ev?.false_holds ? 'danger' : 'safe'} note="on normal calls" />
      <Stat label="customer data sent out" value={counters?.customer_data_out} tone={counters?.customer_data_out ? 'danger' : 'safe'} note="from the OpenShell egress log" />
    </footer>
  )
}
