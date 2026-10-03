// Scene 6 · Results: six scores, each with its denominator, and the GB10 right now.
import { useStore } from '../../lib/store'
import { DASH, num, pct } from '../../lib/format'
import type { Integration } from '../../lib/types'
import { SceneFrame } from '../../shell/SceneFrame'
import { Eyebrow, Reveal } from '../../ui/primitives'
import { BenchBars, ScoreTile } from './Tiles'

const times = (v: number) => `${v.toFixed(1)}×`

function lastScreening(list: Integration[]): Integration | undefined {
  return list.find((x) => typeof x?.result?.screening === 'string')
}

export function ResultsScene() {
  const ev = useStore((s) => s.eval)
  const bench = useStore((s) => s.bench)
  const t = useStore((s) => s.telemetry)
  const integrations = useStore((s) => s.integrations)
  const gpu = typeof bench?.gpu_s === 'number' ? bench.gpu_s : null
  const cpu = typeof bench?.cpu_s === 'number' ? bench.cpu_s : null
  const speedup = gpu && cpu ? cpu / gpu : null
  const scr = lastScreening(integrations)?.result

  return (
    <SceneFrame headline="How well it works" subline="Measured on labelled synthetic data. Every number has its denominator.">
      <Reveal order={0} className="grid-12 col-span-12 gap-y-6">
        <ScoreTile label="Scam calls held" value={ev?.scam_caught} den={ev?.scam_total ?? null} note={ev?.label} />
        <ScoreTile label="False holds on normal calls" value={ev?.false_holds} den={ev?.normal_total ?? null} />
        <ScoreTile
          label="Laundering attempts recovered"
          value={ev?.rings_recovered}
          den={ev?.rings_total ?? null}
          note={`${num(ev?.rings_recovered_escalated)} via escalated rings`}
        />
      </Reveal>
      <Reveal order={1} className="grid-12 col-span-12 mt-6 gap-y-6">
        <ScoreTile
          label="Escalated precision"
          value={ev?.flagged_precision}
          format={(v) => pct(v)}
          note={`all flagged ${pct(ev?.flagged_precision_all)}`}
        />
        <ScoreTile
          label="Injection attempts that changed a decision"
          value={ev?.redteam_decision_changed}
          den={ev?.redteam_attempts ?? null}
          note={`customer data out ${num(ev?.redteam_data_out)} · invented facts passed ${num(ev?.redteam_invented_facts_passed)}`}
        />
        <ScoreTile label="GPU vs CPU, same pandas code" value={speedup} format={times} note="faster">
          <BenchBars gpu={gpu} cpu={cpu} />
        </ScoreTile>
      </Reveal>
      <p className="tnum col-span-12 mt-auto self-end pt-6 text-meta text-mute">
        GB10 now: GPU {num(t?.gpu_util)}% · {num(t?.temp_c)} °C · {num(t?.power_w)} W · memory {num(t?.mem_used_gb, 1)}/
        {num(t?.mem_total_gb, 1)} GB · Payment rails: last ISO 20022 screening {scr?.screening ?? DASH}
        {scr?.ring_id ? ` (${scr.ring_id})` : ''}
      </p>
    </SceneFrame>
  )
}

type PerCall = { call?: string; expected?: string; recommendation?: string; correct?: boolean }

export function ResultsDetails() {
  const ev = useStore((s) => s.eval)
  const bench = useStore((s) => s.bench)
  const integrations = useStore((s) => s.integrations)
  const byType = Object.entries(ev?.by_type ?? {})
  const perCall = (Array.isArray(ev?.per_call) ? ev.per_call : []) as PerCall[]
  const b = (k: string) => (typeof bench?.[k] === 'number' ? `${num(bench[k] as number, 1)} s` : DASH)

  return (
    <div className="flex flex-col gap-10">
      <section>
        <Eyebrow className="mb-3">Recall by ring type</Eyebrow>
        {byType.length === 0 && <div className="text-mute">{DASH}</div>}
        {byType.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-2">
            <span className="text-ink-2">{k}</span>
            <span className="tnum text-ink">
              {num(v?.[0])} / {num(v?.[1])}
            </span>
          </div>
        ))}
      </section>
      <section>
        <Eyebrow className="mb-3">Calls · expected and recommended</Eyebrow>
        {perCall.length === 0 && <div className="text-mute">{DASH}</div>}
        {perCall.map((p, i) => (
          <div key={p.call ?? i} className="grid grid-cols-[6rem_1fr_7rem_2rem] items-baseline gap-3 border-b border-line py-2">
            <span className="font-mono text-ink">{p.call ?? DASH}</span>
            <span className="truncate text-ink-2" title={p.expected}>
              {p.expected ?? DASH}
            </span>
            <span className="text-ink">{p.recommendation ?? DASH}</span>
            <span className={p.correct ? 'text-clear' : 'text-hold'}>{p.correct == null ? DASH : p.correct ? '✓' : '✗'}</span>
          </div>
        ))}
      </section>
      <section>
        <Eyebrow className="mb-3">Benchmark split</Eyebrow>
        {[
          ['GPU load', b('gpu_load_s')],
          ['GPU detect', b('gpu_detect_s')],
          ['CPU load', b('cpu_load_s')],
          ['CPU detect', b('cpu_detect_s')],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-2">
            <span className="text-ink-2">{k}</span>
            <span className="tnum text-ink">{v}</span>
          </div>
        ))}
      </section>
      <section>
        <Eyebrow className="mb-3">Integrations</Eyebrow>
        {integrations.length === 0 && <div className="text-mute">No payment messages screened yet</div>}
        {integrations.map((x, i) => (
          <div key={`${x.ref ?? ''}-${i}`} className="flex justify-between gap-4 border-b border-line py-2">
            <span className="truncate font-mono text-ink-2">
              {x.kind ?? DASH} · {String(x.ref ?? DASH)}
            </span>
            <span className="text-ink">
              {String(x.result?.screening ?? DASH)}
              {x.result?.ring_id ? ` · ${x.result.ring_id}` : ''}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}
