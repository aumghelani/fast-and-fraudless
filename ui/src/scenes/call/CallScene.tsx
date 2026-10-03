// Call scene: the voice orb and the live transcript. The verdict colour is saved for Decision.
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useStoryCall } from '../../flow/derive'
import { useCtl } from '../../flow/CtlProvider'
import { SceneFrame } from '../../shell/SceneFrame'
import { StartTray } from '../../shell/StartTray'
import { VoiceOrb } from '../../components/VoiceOrb'
import { Button, Chip, Empty, Eyebrow, Reveal } from '../../ui/primitives'
import { DASH, num, usd } from '../../lib/format'
import type { Call } from '../../lib/types'
import { Transcript } from './Transcript'
import { cueLabel } from './cues'

export function mmss(s?: number | null): string {
  if (s == null || !Number.isFinite(s)) return DASH
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export function customerName(c?: Call): string | undefined {
  return c?.customer?.name?.replace(/\s*\(fictional\)\s*/i, '').trim() || undefined
}

/** Raw errors never go on stage; this is the plain-word line. */
function plainError(e?: string | null): string {
  if (!e) return ''
  if (/secure context|getUserMedia|NotAllowed|Permission/i.test(e)) return 'Microphone is not available here'
  if (/audio playback/i.test(e)) return 'Audio could not play on this screen'
  if (/^4\d\d|^5\d\d/.test(e)) return 'The box did not accept the call · try again'
  return 'Something went wrong with the call · try again'
}

function payeeLine(c: Call): string {
  const pc = c.payee_check
  if (pc?.in_ring) return `Payee ${c.payee_account ?? pc.payee_account ?? DASH} is ${pc.hops ?? DASH} hops from ring ${pc.ring_id ?? DASH}`
  if (pc?.error) return 'The ring map could not be read'
  if (c.recommendation) return 'Payee is not linked to a known ring'
  return 'Checking the payee against the ring graph…'
}

export function CallScene() {
  const call = useStoryCall()
  const ctl = useCtl()
  const active = ctl.mode === 'replay' || ctl.mode === 'mic'

  if (!call) {
    return (
      <SceneFrame headline="A customer is on the line" subline="Speech is transcribed and read on the GB10 while the call is live.">
        <Empty title={ctl.mode === 'starting' ? 'Connecting the call…' : 'No call on the line'}>
          <div className="flex flex-col items-center gap-8">
            <VoiceOrb size={12} tone="idle" active={false} />
            <StartTray />
          </div>
        </Empty>
      </SceneFrame>
    )
  }

  const name = customerName(call)
  const cu = call.customer
  const err = plainError(ctl.error)
  const status = err || (call.ended ? `Call ended · ${mmss(call.audio_s)}` : `Listening · ${call.asr ?? DASH} on the GB10`)
  const facts = [
    cu?.age != null ? `${num(cu.age)} years old` : null,
    cu?.tenure_years != null ? `banked ${num(cu.tenure_years)} years` : null,
    cu?.prior_wires === 0 ? 'first wire ever' : null,
  ].filter(Boolean)
  const ratio = call.features?.amount_ratio
  const seen = new Set<string>()
  const cues = (call.cues || []).filter((c) => c.cue && !seen.has(c.cue) && seen.add(c.cue))

  return (
    <SceneFrame
      headline={name ? `${name} wants to wire ${usd(call.amount)}` : 'A customer is on the line'}
      subline="Speech is transcribed and read on the GB10 while the call is live."
      actions={
        ctl.mode !== 'idle' ? (
          <Button variant="ghost" onClick={() => ctl.end()}>
            End call
          </Button>
        ) : null
      }
    >
      <Reveal order={0} className="col-span-5 flex min-h-0 flex-col items-start gap-6">
        <VoiceOrb size={20} tone={active ? 'listening' : 'idle'} active={active} />
        <div className="text-meta text-mute">{status}</div>
        <div className="flex flex-col gap-1 text-body text-ink-2">
          <div>{facts.length ? facts.join(' · ') : DASH}</div>
          <div className="tnum">
            Typical month {usd(cu?.typical_monthly_outflow_usd)} · this wire {ratio != null ? `${num(ratio, 1)}×` : DASH}
          </div>
          <div className="font-mono text-ink">{call.payee_account ?? DASH}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip>Synthetic customer</Chip>
          {call.source === 'replay' && <Chip>Replay</Chip>}
          {call.cue_source?.includes('fallback') && <Chip>Keyword fallback</Chip>}
        </div>
      </Reveal>
      <Reveal order={1} className="col-span-7 flex min-h-0 flex-col gap-6">
        <div className="min-h-0 flex-1">
          <Transcript call={call} />
        </div>
        <div className="flex min-h-8 flex-wrap gap-2">
          {cues.map((c) => (
            <motion.span key={c.cue} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
              <Chip tone="accent" className="font-semibold uppercase tracking-[0.08em]">
                {cueLabel(c.cue)}
              </Chip>
            </motion.span>
          ))}
        </div>
        <div className="text-body text-ink-2">{payeeLine(call)}</div>
      </Reveal>
    </SceneFrame>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-4 py-1">
      <span className="w-32 shrink-0 text-meta text-mute">{k}</span>
      <span className="min-w-0 wrap-break-word">{v}</span>
    </div>
  )
}

export function CallDetails() {
  const call = useStoryCall()
  const ctl = useCtl()
  if (!call) return <div className="text-ink-2">No call yet.</div>
  return (
    <div className="flex flex-col gap-8">
      <section>
        <Eyebrow className="mb-2">Transcript</Eyebrow>
        <p className="text-body text-ink">{call.transcript_final || call.transcript || DASH}</p>
      </section>
      <section>
        <Eyebrow className="mb-2">Speech windows</Eyebrow>
        {(call.windows || []).slice(-10).map((w) => (
          <div key={w.i} className="tnum flex gap-4 py-0.5 font-mono text-meta text-ink-2">
            <span>#{w.i}</span>
            <span>
              {num(w.t0_s, 1)}-{num(w.t1_s, 1)} s
            </span>
            <span>{w.asr_latency_s != null ? `${num(w.asr_latency_s, 2)} s` : DASH}</span>
            {w.fallback && <span className="text-verify">fallback</span>}
          </div>
        ))}
        {!call.windows?.length && <div className="text-ink-2">{DASH}</div>}
      </section>
      <section>
        <Eyebrow className="mb-2">Cues</Eyebrow>
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
        <Eyebrow className="mb-2">Call</Eyebrow>
        <Row k="Call id" v={<span className="font-mono">{call.call_id}</span>} />
        <Row k="Clip" v={call.clip ?? DASH} />
        <Row k="Source" v={call.source ?? DASH} />
        <Row k="Mic mode" v={ctl.micMode ?? DASH} />
        <Row k="Speech model" v={call.asr ?? DASH} />
        <Row k="Cue reader" v={call.cue_source ?? DASH} />
        {call.asr_error && <Row k="Speech error" v="Speech recognition failed for a window" />}
        {ctl.error && <Row k="Call error" v={plainError(ctl.error)} />}
      </section>
    </div>
  )
}
