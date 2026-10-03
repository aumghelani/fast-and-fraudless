// Decision scene: a top strip with the mini orb, the verdict card and the payee path.
import { useStoryCall, verdictOf } from '../../flow/derive'
import { useCtl } from '../../flow/CtlProvider'
import { useStore } from '../../lib/store'
import { SceneFrame } from '../../shell/SceneFrame'
import { StartTray } from '../../shell/StartTray'
import { VoiceOrb } from '../../components/VoiceOrb'
import { Chip, Empty, Eyebrow, Reveal } from '../../ui/primitives'
import { VERDICT } from '../../ui/tokens'
import { DASH, num } from '../../lib/format'
import type { Call } from '../../lib/types'
import { customerName, mmss } from '../call/CallScene'
import { cueLabel } from '../call/cues'
import { VerdictCard } from './VerdictCard'
import { PayeePath } from './PayeePath'

function lastSentence(c: Call): string {
  const t = (c.transcript_final || c.transcript || '').trim()
  if (!t) return ''
  const parts = t.split(/(?<=[.?!])\s+/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

function Strip({ call, active }: { call: Call; active: boolean }) {
  const v = verdictOf(call)
  const said = lastSentence(call)
  return (
    <div className="flex h-22 items-center gap-6 rounded-xl border border-line bg-surface px-6">
      <VoiceOrb size={3.5} tone={v ?? 'listening'} active={active} />
      <div className="shrink-0 text-body font-semibold">
        {customerName(call) ?? 'Customer'} · on the line {mmss(call.audio_s)}
      </div>
      <div className="min-w-0 flex-1 truncate text-lead text-ink-2">{said ? `…${said}` : ''}</div>
      <Chip>{call.ended ? 'Final · whole call' : 'Provisional · call in progress'}</Chip>
    </div>
  )
}

export function DecisionScene() {
  const call = useStoryCall()
  const ctl = useCtl()
  const active = ctl.mode === 'replay' || ctl.mode === 'mic'
  const v = verdictOf(call)

  if (!call || !v) {
    return (
      <SceneFrame headline="Decision" subline="The rules decide while the customer is still on the line.">
        <Empty title="No decision yet · start a call" sub={call ? 'Listening for the first window of speech…' : undefined}>
          <StartTray />
        </Empty>
      </SceneFrame>
    )
  }

  const pc = call.payee_check
  const questions = (call.questions || []).slice(0, 3)
  return (
    <SceneFrame headline={<Strip call={call} active={active} />}>
      <Reveal order={0} className="col-span-7 min-h-0">
        <VerdictCard key={call.call_id} call={call} v={v} />
      </Reveal>
      <Reveal order={1} className="col-span-5 flex min-h-0 flex-col gap-6">
        <PayeePath call={call} color={VERDICT[v].color} />
        <div className="text-body text-ink-2">
          {pc?.in_ring
            ? `Payee feeds ring ${pc.ring_id ?? DASH}, found by the GPU · ${pc.hops ?? DASH} hops`
            : pc?.error
              ? 'The ring map could not be read'
              : 'Payee is not linked to a known ring'}
        </div>
        {questions.length > 0 && (
          <div>
            <Eyebrow className="mb-3">Ask the customer</Eyebrow>
            <ol className="flex flex-col gap-2 text-body text-ink">
              {questions.map((q, i) => (
                <li key={q} className="flex gap-3">
                  <span className="tnum text-mute">{i + 1}</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Reveal>
    </SceneFrame>
  )
}

export function DecisionDetails() {
  const call = useStoryCall()
  const integrations = useStore((s) => s.integrations)
  if (!call) return <div className="text-ink-2">No call yet.</div>
  const ringId = call.payee_check?.ring_id
  const match = ringId ? integrations.find((x) => x.result?.ring_id === ringId) : undefined
  const f = call.features
  return (
    <div className="flex flex-col gap-8">
      <section>
        <Eyebrow className="mb-2">All reasons</Eyebrow>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {(call.reasons || []).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {!call.reasons?.length && <div className="text-ink-2">{DASH}</div>}
      </section>
      <section>
        <Eyebrow className="mb-2">Questions</Eyebrow>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {(call.questions || []).map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        {!call.questions?.length && <div className="text-ink-2">{DASH}</div>}
      </section>
      <section>
        <Eyebrow className="mb-2">Features</Eyebrow>
        <div className="tnum flex flex-col gap-1 text-ink-2">
          <div>First wire · {f?.first_wire == null ? DASH : f.first_wire ? 'yes' : 'no'}</div>
          <div>Amount ratio · {f?.amount_ratio != null ? `${num(f.amount_ratio, 1)}×` : DASH}</div>
          <div>High-risk cues · {f?.high_risk_cues?.length ? f.high_risk_cues.map(cueLabel).join(', ') : DASH}</div>
        </div>
      </section>
      <section>
        <Eyebrow className="mb-2">Cue quotes</Eyebrow>
        {(call.cues || []).map((c, i) => (
          <div key={i} className="py-1">
            <span className="text-meta font-semibold uppercase tracking-[0.08em] text-accent">{cueLabel(c.cue)}</span>
            <span className="ml-2 text-meta text-mute">{c.reader === 'llm' ? 'Nemotron' : c.reader || DASH}</span>
            {c.quote && <div className="text-ink-2">“{c.quote}”</div>}
          </div>
        ))}
        {!call.cues?.length && <div className="text-ink-2">{DASH}</div>}
      </section>
      <section>
        <Eyebrow className="mb-2">Payee path</Eyebrow>
        <div className="font-mono text-meta text-ink-2">
          {call.payee_check?.path?.length ? call.payee_check.path.join(' → ') : DASH}
        </div>
        <div className="mt-1 text-meta text-mute">
          {call.payee_check?.ring_type ?? DASH} · {call.payee_check?.ring_tier ?? DASH}
        </div>
      </section>
      <section>
        <Eyebrow className="mb-2">Payment-rail screening</Eyebrow>
        {match ? (
          <div className="text-ink-2">
            {match.kind ?? DASH} {match.ref ?? ''} · {match.result?.screening ?? DASH} · ring {match.result?.ring_id ?? DASH}
          </div>
        ) : (
          <div className="text-ink-2">No screened payment for this ring yet.</div>
        )}
      </section>
    </div>
  )
}
