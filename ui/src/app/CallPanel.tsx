// The phone line: who is calling, the live voice, the newest words, and the call buttons.
import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Mic, PhoneOff, Play } from 'lucide-react'
import { VoiceBars, type BarsTone } from '../components/VoiceBars'
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
      <p className="max-w-[560px] text-[15px] leading-[24px] text-ink-2">
        Play a recorded call or pick up the microphone. The wire is checked while the customer is still talking.
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
    <div className="flex h-[52px] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_14px)]">
      <p className="text-[16px] leading-[26px]">
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
    <section className="card flex h-32 items-center gap-6 px-6">
      {/* who is on the line */}
      <div className="flex w-[250px] shrink-0 flex-col gap-1.5">
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
        <div className="truncate font-mono text-[17px] font-semibold text-ink">
          {showCall ? name : view === 'starting' ? 'Dialling in…' : 'Ready for the next call'}
        </div>
        {err ? (
          <div className="truncate font-mono text-[12px] text-hold" title={ctl.error ?? undefined}>{err}</div>
        ) : showCall ? (
          <div className="truncate font-mono text-[12px] text-mute">
            {sourceOf(call, ctl.mode)}
            {call?.amount != null && <> · wire {usd(call.amount)}</>}
          </div>
        ) : (
          <div className="truncate font-mono text-[12px] text-mute">Line open · speech stays on this box</div>
        )}
      </div>

      <span aria-hidden className="h-16 w-px shrink-0 bg-line" />

      {/* the voice */}
      <div className="flex w-[380px] shrink-0 flex-col gap-1">
        <VoiceBars active={view === 'live'} tone={tone} bars={44} className="h-14 w-full" />
        <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.06em] text-mute">
          <span>Parakeet · local speech</span>
          <span className="tnum">{showCall && lat != null ? `${num(lat, 2)} s` : DASH}</span>
        </div>
      </div>

      {/* the words */}
      <div className="min-w-0 flex-1">
        <Caption call={call} view={view} still={still} />
      </div>

      {/* start and stop */}
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
          <Button variant="hold" className="w-[150px] justify-center px-3.5 text-[14px]" onClick={() => ctl.end()}>
            <PhoneOff size={15} />
            End call
            <KbdOn>Esc</KbdOn>
          </Button>
        ) : (
          <Button variant="primary" className="w-[150px] justify-center px-3.5 text-[14px]" onClick={() => ctl.toggleMic()}>
            <Mic size={15} />
            Microphone
            <KbdOn>M</KbdOn>
          </Button>
        )}
      </div>
    </section>
  )
}
