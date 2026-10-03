// The phone line: who is calling, the live voice, the newest words, and the call buttons.
import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Mic, PhoneOff, Play } from 'lucide-react'
import { type BarsTone } from '../components/VoiceBars'
import { VoiceRing3D } from '../components/VoiceRing3D'
import { DASH, cx, num, usd } from '../lib/format'
import type { Call } from '../lib/types'
import { useCtl } from './controls'
import { Button, Kbd, Pill } from './kit'
import { useActiveCall, usePrefersReducedMotion, verdictOf, VERDICT_LABEL, VERDICT_TONE } from './selectors'
import { captionOf, customerName, mmss, plainError, useNow, useRecentActivity } from './call/helpers'

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
  return <kbd className="rounded border border-white/30 bg-white/15 px-1.5 font-mono text-[11px] text-white">{children}</kbd>
}

function sourceOf(c: Call | undefined, mode: string): string {
  const s = c?.source ?? (mode === 'mic' ? 'mic' : 'replay')
  return s === 'mic' ? 'Microphone' : 'Replay'
}

/** Bottom-anchored two-line caption; each new sentence fades in once, growing words do not. */
function Caption({ call, view, still }: { call?: Call; view: View; still: boolean }) {
  if (view === 'idle')
    return (
      <p className="mx-auto text-[20px] leading-[32px] text-ink-2">
        Line open. Start a live call <span className="font-mono text-[14px] text-mute">(M)</span> or play a recorded one{' '}
        <span className="font-mono text-[14px] text-mute">(⇧1)</span>.
      </p>
    )
  if (view === 'starting') return <p className="text-[15px] text-mute">Connecting the call…</p>
  const { done, first, total, partial } = captionOf(call)
  if (!done.length && !partial)
    return <p className="text-[15px] text-mute">{view === 'live' ? 'Listening for the customer…' : 'No words were heard on this call.'}</p>
  const id = call?.call_id ?? ''
  const fade = still
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : { initial: { opacity: 0, filter: 'blur(3px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, transition: { duration: 0.4, ease: 'easeOut' as const } }
  return (
    <div className="flex max-h-[72px] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_14px)]">
      <p className="text-[24px] leading-[36px]">
        {done.map((s, k) => (
          <motion.span key={`${id}-${first + k}`} {...fade} className={cx('transition-colors duration-300', view === 'ended' ? 'text-ink-2' : 'text-ink')}>
            {s}{' '}
          </motion.span>
        ))}
        {/* same key as the sentence it becomes, so finishing it does not fade it again */}
        {partial && view === 'live' && (
          <motion.span key={`${id}-${total}`} {...fade} className="text-ink-2 transition-colors duration-300">
            {partial}
          </motion.span>
        )}
      </p>
    </div>
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

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      {/* who is on the line, and the controls */}
      <div className="flex shrink-0 items-start gap-6 px-2 pt-1">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex h-7 items-center gap-2">
            {view === 'live' && (
              <>
                <Pill tone="accent" className="py-0.5 text-[12px] tracking-[0.08em]">
                  <PulseDot className="bg-accent" still={still} />
                  LIVE
                </Pill>
                <span className="tnum font-mono text-[15px] font-medium text-ink">{clock}</span>
                {v && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                    <Pill tone={VERDICT_TONE[v]} className="py-0.5 text-[12px]">{VERDICT_LABEL[v]}</Pill>
                  </motion.span>
                )}
              </>
            )}
            {view === 'ended' && (
              <>
                <span className="font-mono text-[13px] text-mute">Call ended ·</span>
                {v ? (
                  <Pill tone={VERDICT_TONE[v]} className="py-0.5 text-[12px]">{VERDICT_LABEL[v]}</Pill>
                ) : (
                  <Pill className="py-0.5 text-[12px]">No verdict</Pill>
                )}
                <span className="tnum font-mono text-[13px] text-mute">{clock}</span>
              </>
            )}
            {view === 'starting' && (
              <Pill tone="accent" className="py-0.5 text-[12px] tracking-[0.08em]">
                <PulseDot className="bg-accent" still={still} />
                CONNECTING
              </Pill>
            )}
            {view === 'idle' && (
              <Pill className="py-0.5 text-[12px] tracking-[0.08em]">
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
              <span className="truncate font-mono text-[12px] text-hold" title={ctl.error ?? undefined}>{err}</span>
            ) : (
              <span className="truncate font-mono text-[12px] text-mute">
                {showCall ? <>{sourceOf(call, ctl.mode)}{call?.amount != null && <> · wire {usd(call.amount)}</>}</> : 'Line open · speech stays on the GB10'}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button className="px-3.5 text-[14px]" disabled={starting} onClick={() => ctl.replay('CALL-01')}>
            <Play size={13} className="text-mute" fill="currentColor" strokeWidth={0} />
            Margaret · replay
            <Kbd>⇧1</Kbd>
          </Button>
          <Button className="px-3.5 text-[14px]" disabled={starting} onClick={() => ctl.replay('CALL-02')}>
            <Play size={13} className="text-mute" fill="currentColor" strokeWidth={0} />
            David · replay
            <Kbd>⇧2</Kbd>
          </Button>
          {ctlLive || starting ? (
            <Button variant="hold" className="justify-center px-3.5 text-[14px]" onClick={() => ctl.end()}>
              <PhoneOff size={15} />
              End call
              <KbdOn>Esc</KbdOn>
            </Button>
          ) : (
            <>
              <Button className="justify-center px-3.5 text-[14px]" onClick={() => ctl.startMicCall('CALL-01')}>
                <Mic size={15} className="text-accent" />
                Live · Margaret's account
                <Kbd>⇧M</Kbd>
              </Button>
              <Button variant="primary" className="justify-center px-3.5 text-[14px]" onClick={() => ctl.toggleMic()}>
                <Mic size={15} />
                Live call
                <KbdOn>M</KbdOn>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* the voice: a circular 3-D wave, the live words in the middle */}
      <VoiceRing3D active={view === 'live'} tone={tone} className="relative min-h-0 flex-1">
        <div className="flex max-h-[var(--ring-in-h)] w-[var(--ring-in-w)] items-center justify-center overflow-hidden text-center">
          <Caption call={call} view={view} still={still} />
        </div>
      </VoiceRing3D>
      <span className="pointer-events-none absolute bottom-1 right-2 font-mono text-[11px] uppercase tracking-[0.06em] text-mute">
        Parakeet · local speech{showCall && lat != null ? ` · ${num(lat, 2)} s` : ''}
      </span>
    </section>
  )
}
