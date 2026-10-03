// The replay section: who is calling and the controls on top; below, the 3-D voice ring with a phone in it,
// the live transcript, and the rules being checked as the words arrive. Its edge glows red on fraud, green when clear.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Mic, Phone, PhoneOff, Play } from 'lucide-react'
import { type BarsTone } from '../components/VoiceBars'
import { VoiceRing3D } from '../components/VoiceRing3D'
import { DASH, cx, num, usd } from '../lib/format'
import type { Call } from '../lib/types'
import { useCtl } from './controls'
import { Button, GlowCard, Kbd, Pill } from './kit'
import { useActiveCall, usePrefersReducedMotion, verdictOf, VERDICT_LABEL, VERDICT_TONE } from './selectors'
import { customerName, mmss, plainError, useNow, useRecentActivity } from './call/helpers'
import { checksOf } from './pipeline/checks'
import { RulesPanel } from './pipeline/Panels'

type View = 'idle' | 'starting' | 'live' | 'ended'

function PulseDot({ className, still }: { className: string; still: boolean }) {
  return (
    <motion.span
      aria-hidden
      className={cx('size-2 shrink-0 rounded-full', className)}
      animate={still ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
      transition={still ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
    />
  )
}

/** Key hint that sits on a filled button. */
function KbdOn({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/30 bg-white/15 px-1.5 font-mono text-[12px] text-white">{children}</kbd>
}

function sourceOf(c: Call | undefined, mode: string): string {
  const s = c?.source ?? (mode === 'mic' ? 'mic' : 'replay')
  return s === 'mic' ? 'Microphone' : 'Replay'
}

const split = (t?: string) => (t || '').trim().split(/(?<=[.!?])\s+/).filter(Boolean)

/** The live transcript in its own box: every sentence so far, newest at the bottom and in full ink. */
function TranscriptBox({ call, view, still, lat }: { call?: Call; view: View; still: boolean; lat?: number | null }) {
  const done = split(call?.transcript_final || (call?.partial ? '' : call?.transcript))
  const partial = (call?.partial || '').trim()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: still ? 'auto' : 'smooth' })
  }, [done.length, partial, still])
  const id = call?.call_id ?? ''
  const fade = still
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, ease: 'easeOut' as const } }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-line bg-surface-2/50">
      <div className="flex shrink-0 items-center justify-between gap-3 whitespace-nowrap px-5 pt-4 font-mono text-[14px] uppercase tracking-[0.08em] text-ink-2">
        <span>Live transcript</span>
        <span className="truncate normal-case tracking-normal text-mute">Parakeet{lat != null && view !== 'idle' ? ` · ${num(lat, 2)} s` : ' · on the GB10'}</span>
      </div>
      <div ref={box} className="mt-2 min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3 [mask-image:linear-gradient(to_bottom,transparent,#000_28px)] [scrollbar-width:none]">
        {view === 'idle' ? (
          <p className="text-[20px] leading-[1.5] text-ink-2">
            Line open. Start a live call <span className="font-mono text-[16px] text-mute">(M)</span> or play a recorded one{' '}
            <span className="font-mono text-[16px] text-mute">(⇧1)</span>.
          </p>
        ) : view === 'starting' ? (
          <p className="text-[20px] text-mute">Connecting the call…</p>
        ) : !done.length && !partial ? (
          <p className="text-[20px] text-mute">{view === 'live' ? 'Listening for the customer…' : 'No words were heard on this call.'}</p>
        ) : (
          <p className="text-[21px] leading-[1.55]">
            {done.map((t, k) => (
              <motion.span key={`${id}-${k}`} {...fade} className={cx('transition-colors duration-500', k === done.length - 1 && !partial ? 'text-ink' : 'text-ink-2')}>
                {t}{' '}
              </motion.span>
            ))}
            {partial && view === 'live' && (
              <motion.span key={`${id}-${done.length}`} {...fade} className="text-ink">
                {partial}
              </motion.span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

/** The phone in the middle of the ring, in the theme colour; a soft ping while a call is live. */
function PhoneMark({ live, still }: { live: boolean; still: boolean }) {
  return (
    <span className="relative grid size-[min(26%,96px)] min-h-12 min-w-12 place-items-center rounded-full bg-accent text-white shadow-[0_10px_30px_rgb(79_70_229/0.35)]">
      {live && !still && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-accent"
          animate={{ scale: [1, 1.6], opacity: [0.35, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <Phone className="relative size-[42%]" strokeWidth={2.2} />
    </span>
  )
}

export function CallPanel() {
  const ctl = useCtl()
  const call = useActiveCall()
  const still = usePrefersReducedMotion()
  const remote = useRecentActivity(call)

  const ctlLive = ctl.mode === 'replay' || ctl.mode === 'mic'
  const live = ctlLive || (!!call && !call.ended && remote)
  const starting = ctl.mode === 'starting'

  // only a call this page saw live gets the "ended" view; old calls in the store leave the line ready
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => {
    if (live && call?.call_id) setSeen(call.call_id)
  }, [live, call?.call_id])
  const view: View = starting ? 'starting' : live ? 'live' : call && seen === call.call_id ? 'ended' : 'idle'

  // timer: the call's own audio clock, nudged by the wall clock between updates
  const now = useNow(live)
  const [t0, setT0] = useState<number | null>(null)
  useEffect(() => {
    setT0(live ? Date.now() : null)
  }, [live, call?.call_id])
  const elapsed = t0 != null ? (now - t0) / 1000 : 0
  const clock = view === 'live' ? mmss(Math.max(call?.audio_s ?? 0, elapsed)) : mmss(call?.audio_s)

  const v = verdictOf(call)
  const tone: BarsTone = view === 'live' ? (v ?? 'listening') : 'idle'
  const name = customerName(call) ?? call?.call_id ?? DASH
  const err = plainError(ctl.error)
  const lat = [...(call?.windows ?? [])].reverse().find((w) => w.asr_latency_s != null)?.asr_latency_s
  const showCall = view === 'live' || view === 'ended'

  const checks = useMemo(() => (call && showCall ? checksOf(call) : []), [call, showCall])
  const flagged = checks.some((x) => x.tone === 'flag')
  const glow = !showCall ? null : v === 'NO_HOLD' ? 'clear' : v === 'HOLD' || flagged ? 'hold' : v === 'VERIFY' ? 'verify' : null

  return (
    <GlowCard tone={glow} pulsing={view === 'live'} className="flex h-full min-h-0 min-w-0 flex-col" data-block="replay">
      {/* who is on the line, and the controls */}
      <div className="flex shrink-0 flex-wrap items-start gap-x-6 gap-y-3 px-5 pt-4">
        <div className="flex min-w-[240px] flex-1 flex-col gap-1">
          <div className="flex h-7 items-center gap-2">
            {view === 'live' && (
              <>
                <Pill tone="accent" className="py-0.5 text-[13px] tracking-[0.08em]">
                  <PulseDot className="bg-accent" still={still} />
                  LIVE
                </Pill>
                <span className="tnum font-mono text-[16px] font-medium text-ink">{clock}</span>
                {v && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                    <Pill tone={VERDICT_TONE[v]} className="py-0.5 text-[13px]">{VERDICT_LABEL[v]}</Pill>
                  </motion.span>
                )}
              </>
            )}
            {view === 'ended' && (
              <>
                <span className="font-mono text-[14px] text-mute">Call ended ·</span>
                {v ? (
                  <Pill tone={VERDICT_TONE[v]} className="py-0.5 text-[13px]">{VERDICT_LABEL[v]}</Pill>
                ) : (
                  <Pill className="py-0.5 text-[13px]">No verdict</Pill>
                )}
                <span className="tnum font-mono text-[14px] text-mute">{clock}</span>
              </>
            )}
            {view === 'starting' && (
              <Pill tone="accent" className="py-0.5 text-[13px] tracking-[0.08em]">
                <PulseDot className="bg-accent" still={still} />
                CONNECTING
              </Pill>
            )}
            {view === 'idle' && (
              <Pill className="py-0.5 text-[13px] tracking-[0.08em]">
                <span aria-hidden className="size-2 rounded-full bg-faint" />
                NO CALL
              </Pill>
            )}
          </div>
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="truncate font-mono text-[18px] font-semibold text-ink">
              {showCall ? name : view === 'starting' ? 'Dialling in…' : 'Ready for the next call'}
            </span>
            {err ? (
              <span className="truncate font-mono text-[13px] text-hold" title={ctl.error ?? undefined}>{err}</span>
            ) : (
              <span className="truncate font-mono text-[13px] text-mute">
                {showCall ? <>{sourceOf(call, ctl.mode)}{call?.amount != null && <> · wire {usd(call.amount)}</>}</> : 'Line open · speech stays on the GB10'}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <Button className="px-3.5 text-[15px]" disabled={starting} onClick={() => ctl.replay('CALL-01')}>
            <Play size={13} className="text-mute" fill="currentColor" strokeWidth={0} />
            Margaret · replay
            <Kbd>⇧1</Kbd>
          </Button>
          <Button className="px-3.5 text-[15px]" disabled={starting} onClick={() => ctl.replay('CALL-02')}>
            <Play size={13} className="text-mute" fill="currentColor" strokeWidth={0} />
            David · replay
            <Kbd>⇧2</Kbd>
          </Button>
          {ctlLive || starting ? (
            <Button variant="hold" className="justify-center px-3.5 text-[15px]" onClick={() => ctl.end()}>
              <PhoneOff size={15} />
              End call
              <KbdOn>Esc</KbdOn>
            </Button>
          ) : (
            <>
              <Button className="justify-center px-3.5 text-[15px]" onClick={() => ctl.startMicCall('CALL-01')}>
                <Mic size={15} className="text-accent" />
                Live · Margaret's account
                <Kbd>⇧M</Kbd>
              </Button>
              <Button variant="primary" className="justify-center px-3.5 text-[15px]" onClick={() => ctl.toggleMic()}>
                <Mic size={15} />
                Live call
                <KbdOn>M</KbdOn>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ring | transcript | rules, edge to edge */}
      <div className="flex min-h-0 flex-1 items-stretch gap-4 px-4 pb-4 pt-3">
        <div className="relative aspect-square h-full max-h-[min(420px,34vh)] shrink-0 self-center max-[1450px]:max-h-[min(240px,34vh)]">
          <VoiceRing3D active={view === 'live'} tone={tone} tilt={0.42} bars={96} className="absolute inset-0">
            <PhoneMark live={view === 'live'} still={still} />
          </VoiceRing3D>
        </div>
        <TranscriptBox call={call} view={view} still={still} lat={showCall ? lat : null} />
        <div className="min-h-0 w-[38%] min-w-[400px] shrink-0 max-[1700px]:min-w-[340px] max-[1450px]:min-w-[300px]">
          <RulesPanel call={showCall ? call : undefined} checks={checks} />
        </div>
      </div>
    </GlowCard>
  )
}
