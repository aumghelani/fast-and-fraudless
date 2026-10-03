import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Mic, MicOff, PhoneOff, Play, Radio, PhoneCall, AlertTriangle, Bot, KeyRound } from 'lucide-react'
import { useActiveCall } from '../lib/store'
import type { Call, Cue } from '../lib/types'
import { cx, num, usd } from '../lib/format'
import type { CallControls } from '../lib/useCallControls'
import { PanelHeader, Tag } from './ui'
import { VoiceOrb, type OrbTone } from './VoiceOrb'
import { PayeeCheck } from './Recommendation'

export const HIGH_RISK = ['URGENCY', 'SECRECY', 'AUTHORITY', 'STORY_CHANGE', 'COACHING', 'REMOTE_CONTROL']
export const LOW_RISK = ['VERIFIED_INDEPENDENTLY', 'ROUTINE_PAYEE']
const CUE_LABEL: Record<string, string> = {
  URGENCY: 'Urgency', SECRECY: 'Secrecy', AUTHORITY: 'Authority', STORY_CHANGE: 'Story change',
  COACHING: 'Coaching', REMOTE_CONTROL: 'Remote control', VERIFIED_INDEPENDENTLY: 'Verified independently',
  ROUTINE_PAYEE: 'Routine payee', AMOUNT_STATED: 'Amount stated',
}

/** Split the transcript into plain text and cue-quote highlights (case-insensitive, first non-overlapping hit). */
function highlight(text: string, cues: Cue[]): ReactNode[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const spans: { s: number; e: number; cue: string }[] = []
  for (const c of cues) {
    const q = (c.quote || '').trim()
    if (q.length < 3) continue
    let from = 0
    while (from < lower.length) {
      const i = lower.indexOf(q.toLowerCase(), from)
      if (i < 0) break
      const e = i + q.length
      if (!spans.some((sp) => i < sp.e && e > sp.s)) {
        spans.push({ s: i, e, cue: c.cue })
        break
      }
      from = i + 1
    }
  }
  spans.sort((a, b) => a.s - b.s)
  const out: ReactNode[] = []
  let p = 0
  spans.forEach((sp, k) => {
    if (sp.s > p) out.push(text.slice(p, sp.s))
    const high = HIGH_RISK.includes(sp.cue)
    const neutral = sp.cue === 'AMOUNT_STATED'
    out.push(
      <motion.mark
        key={`${sp.cue}-${sp.s}-${k}`}
        initial={{ backgroundColor: 'rgba(255,255,255,0.25)' }}
        animate={{ backgroundColor: neutral ? 'rgba(170,180,195,0.12)' : high ? 'rgba(255,59,59,0.16)' : 'rgba(47,210,122,0.14)' }}
        transition={{ duration: 1.2 }}
        className={cx(
          'rounded px-0.5 font-semibold',
          neutral ? 'text-ink' : high ? 'text-danger-ink underline decoration-danger/70 decoration-2 underline-offset-4' : 'text-safe underline decoration-safe/60 decoration-2 underline-offset-4',
        )}
        title={CUE_LABEL[sp.cue] || sp.cue}
      >
        {text.slice(sp.s, sp.e)}
        <sup className="ml-0.5 text-[0.55rem] font-bold tracking-wider opacity-80">{sp.cue.replace('_', ' ')}</sup>
      </motion.mark>,
    )
    p = sp.e
  })
  if (p < text.length) out.push(text.slice(p))
  return out
}

function Transcript({ call }: { call?: Call }) {
  const box = useRef<HTMLDivElement | null>(null)
  const final = call?.transcript_final ?? call?.transcript ?? ''
  const partial = call?.partial ?? ''
  const parts = useMemo(() => highlight(final, call?.cues || []), [final, call?.cues])
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [final, partial])
  return (
    <div ref={box} className="scroll-thin min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-black/25 px-4 py-3 text-[1.12rem] leading-[1.75] text-ink">
      {!call && <span className="text-mute">No call yet. Press <span className="kbd">1</span> for Margaret, <span className="kbd">2</span> for David, or <span className="kbd">M</span> for the mic.</span>}
      {call && !final && !partial && (
        <span className="text-mute">{call.ended ? 'Call ended with no speech transcribed.' : 'Listening… the first words appear after ~2 s of speech.'}</span>
      )}
      {parts}
      {partial && <span className="ml-1 italic text-ink-2/60">{partial}</span>}
      {call && !call.ended && (final || partial) && <span className="ml-1 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse bg-ink-2/70" />}
    </div>
  )
}

function CueChips({ cues }: { cues: Cue[] }) {
  const found = new Map<string, Cue>()
  for (const c of cues) if (!found.has(c.cue)) found.set(c.cue, c)
  const chip = (name: string, high: boolean) => {
    const c = found.get(name)
    const on = !!c
    return (
      <motion.div
        key={name}
        layout
        animate={on ? { scale: [1, 1.12, 1] } : { scale: 1 }}
        transition={{ duration: 0.45 }}
        className={cx(
          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.72rem] font-bold uppercase tracking-wider transition-colors duration-500',
          !on && 'border-line bg-transparent text-dim',
          on && high && 'border-danger/60 bg-danger/15 text-danger-ink shadow-[0_0_18px_rgba(255,59,59,0.25)]',
          on && !high && 'border-safe/50 bg-safe/10 text-safe',
        )}
        title={c?.quote ? `“${c.quote}”` : undefined}
      >
        {CUE_LABEL[name] || name}
        {c?.reader && (
          <span className="flex items-center gap-0.5 rounded bg-black/30 px-1 text-[0.55rem] font-semibold normal-case tracking-normal text-ink-2">
            {c.reader === 'llm' ? <Bot className="h-2.5 w-2.5" /> : <KeyRound className="h-2.5 w-2.5" />}
            {c.reader === 'llm' ? 'Nemotron' : 'keywords'}
          </span>
        )}
      </motion.div>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {HIGH_RISK.map((n) => chip(n, true))}
      <span className="mx-1 w-px self-stretch bg-line" />
      {LOW_RISK.map((n) => chip(n, false))}
    </div>
  )
}

function Fact({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className="leading-tight">
      <div className="text-[0.6rem] uppercase tracking-widest text-mute">{k}</div>
      <div className={cx('tnum', strong ? 'text-[1.5rem] font-bold text-ink' : 'text-[0.95rem] font-semibold text-ink-2')}>{v}</div>
    </div>
  )
}

export function LiveCall({ ctl }: { ctl: CallControls }) {
  const call = useActiveCall()
  const rec = call?.recommendation
  const tone: OrbTone = rec === 'HOLD' || rec === 'VERIFY' || rec === 'NO_HOLD' ? rec : ctl.mode !== 'idle' ? 'listening' : 'idle'
  const live = ctl.mode === 'mic' || ctl.mode === 'replay' || (call && !call.ended)
  const cu = call?.customer
  const amount = call?.amount
  const busy = ctl.mode === 'starting'

  return (
    <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        title="Live call"
        icon={<PhoneCall className="h-4 w-4" />}
        sub={call ? `call ${call.call_id}` : 'banker’s desk'}
        right={
          <>
            {call?.source === 'replay' && <Tag tone="amber"><Play className="h-3 w-3" />Replay {call.clip || ''}</Tag>}
            {call?.source === 'mic' && !call.ended && <Tag tone="red"><Radio className="h-3 w-3" />Mic live</Tag>}
            {call?.asr && <Tag tone={call.asr === 'transcript-fallback' ? 'amber' : 'grey'}>ASR {call.asr === 'transcript-fallback' ? 'fallback (transcript)' : call.asr}</Tag>}
            {call?.cue_source && <Tag tone={call.cue_source.includes('fallback') ? 'amber' : 'grey'}>cues {call.cue_source}</Tag>}
            {call?.ended && <Tag>ended</Tag>}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <button className={cx('btn', ctl.mode === 'mic' && '!border-danger/60 !bg-danger/15 text-danger-ink')} onClick={ctl.toggleMic} disabled={busy}>
          {ctl.mode === 'mic' ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {ctl.mode === 'mic' ? 'Stop mic' : 'Mic call'} <span className="kbd">M</span>
        </button>
        <button className="btn" onClick={() => ctl.replay('CALL-01')} disabled={busy}>
          <Play className="h-4 w-4 text-amber" /> CALL-01 · Margaret <span className="kbd">1</span>
        </button>
        <button className="btn" onClick={() => ctl.replay('CALL-02')} disabled={busy}>
          <Play className="h-4 w-4 text-amber" /> CALL-02 · David <span className="kbd">2</span>
        </button>
        <button className="btn" onClick={ctl.end} disabled={ctl.mode === 'idle' || busy}>
          <PhoneOff className="h-4 w-4" /> End
        </button>
        {ctl.mode === 'mic' && (
          <div className="ml-auto flex items-center gap-2 text-[0.68rem] text-mute">
            input
            <div className="h-2 w-28 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full bg-safe transition-[width] duration-75" style={{ width: `${Math.min(100, ctl.level * 400)}%` }} />
            </div>
            {ctl.micMode && <span>{ctl.micMode}</span>}
          </div>
        )}
      </div>
      {(ctl.error || call?.asr_error) && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-1.5 text-[0.74rem] text-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{ctl.error || call?.asr_error}</span>
        </div>
      )}

      <div className="grid min-h-0 shrink-0 grid-cols-[11rem_minmax(0,1fr)_minmax(0,14.5rem)] gap-3 px-4">
        <div className="relative aspect-square w-full">
          <VoiceOrb tone={tone} active={!!live} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-mute">
            {ctl.mode === 'replay' ? 'replay audio' : ctl.mode === 'mic' ? 'caller · live mic' : call && !call.ended ? 'call in progress' : 'idle'}
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[1.3rem] font-bold text-ink" title={cu?.name}>{cu?.name ? cu.name.replace(/\s*\(fictional\)\s*/i, '') : '—'}</span>
            {call && call.synthetic !== false && <Tag tone="amber">{/fictional/i.test(cu?.name || '') ? 'fictional · synthetic' : 'synthetic'}</Tag>}
          </div>
          <div className="grid grid-cols-4 gap-x-3 gap-y-1">
            <Fact k="age" v={num(cu?.age)} />
            <Fact k="tenure" v={cu?.tenure_years != null ? `${num(cu.tenure_years)} yrs` : '—'} />
            <Fact k="wires" v={num(cu?.prior_wires)} />
            <Fact k="typical/mo" v={usd(cu?.typical_monthly_outflow_usd)} />
          </div>
          <div className="flex items-end gap-5 rounded-xl border border-line bg-black/20 px-3.5 py-2">
            <Fact k="wire amount" v={amount != null ? usd(amount) : '—'} strong />
            {call?.features?.amount_ratio != null && (
              <Fact k="vs typical" v={<span className={call.features.amount_ratio >= 5 ? 'text-danger-ink' : ''}>{num(call.features.amount_ratio, 1)}×</span>} />
            )}
            <Fact k="audio" v={call?.audio_s != null ? `${num(call.audio_s, 0)} s` : '—'} />
          </div>
        </div>
        <PayeeCheck />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3 pb-3">
        <Transcript call={call} />
        <AnimatePresence initial={false}>
          <CueChips cues={call?.cues || []} />
        </AnimatePresence>
      </div>
    </div>
  )
}
