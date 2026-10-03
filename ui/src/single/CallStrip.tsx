// Live call strip: orb, who is on the line, the newest sentence, and the start buttons.
import { motion } from 'motion/react'
import { useStoryCall, verdictOf } from '../flow/derive'
import { useCtl } from '../flow/CtlProvider'
import { StartTray } from '../shell/StartTray'
import { VoiceOrb, type OrbTone } from '../components/VoiceOrb'
import { customerName, mmss } from '../scenes/call/CallScene'
import { Button } from '../ui/primitives'
import { DASH, usd } from '../lib/format'
import type { Call } from '../lib/types'

/** Caption tail: the newest sentence (in-progress words included) and up to ~180 chars before it. */
function captionOf(c?: Call): { older: string; newest: string; n: number } {
  const text = `${c?.transcript_final ?? c?.transcript ?? ''} ${c?.partial ?? ''}`.replace(/\s+/g, ' ').trim()
  if (!text) return { older: '', newest: '', n: 0 }
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  const n = parts.length
  const newest = parts.pop() ?? ''
  let older = parts.join(' ')
  if (older.length > 180) older = '…' + older.slice(older.indexOf(' ', older.length - 180) + 1)
  return { older, newest, n }
}

function plainError(e?: string | null): string {
  if (!e) return ''
  if (/secure context|getUserMedia|NotAllowed|Permission/i.test(e)) return 'Microphone is not available here'
  if (/audio playback/i.test(e)) return 'Audio could not play on this screen'
  return 'The call could not start · try again'
}

export function CallStrip() {
  const call = useStoryCall()
  const ctl = useCtl()
  const active = ctl.mode === 'replay' || ctl.mode === 'mic'
  const v = verdictOf(call)
  const tone: OrbTone = active ? 'listening' : v ?? 'idle'
  const name = customerName(call)
  const { older, newest, n } = captionOf(call)
  const err = plainError(ctl.error)

  const status = err
    ? err
    : !call
      ? ctl.mode === 'starting' ? 'Connecting the call…' : 'No call on the line'
      : call.ended
        ? `Ended · ${mmss(call.audio_s)}`
        : `Live · ${mmss(call.audio_s)}`

  return (
    <div className="flex h-22 items-center gap-6 rounded-xl border border-line bg-surface px-5 shadow-[0_1px_2px_rgb(22_26_46/.06),0_8px_28px_rgb(22_26_46/.07)]">
      <VoiceOrb size={3.5} tone={tone} active={active} />

      <div className="flex w-64 shrink-0 flex-col gap-1">
        <span className="font-mono text-[0.75rem] uppercase tracking-[0.12em] text-mute">Live call</span>
        <span className="truncate font-mono text-[1.0625rem] font-semibold text-ink">
          {name ?? DASH}
          {call?.amount != null && <span className="font-normal text-ink-2"> · {usd(call.amount)}</span>}
        </span>
        <span className={err ? 'font-mono text-meta text-hold' : 'tnum font-mono text-meta text-mute'}>{status}</span>
      </div>

      <span aria-hidden className="h-12 w-px shrink-0 bg-line" />

      {/* live caption, bottom-anchored at two lines; only the newest sentence fades in */}
      <div className="flex h-[3.375rem] min-w-0 flex-1 flex-col justify-end overflow-hidden">
        {newest ? (
          <p className="text-body leading-normal">
            {older && <span className="text-mute">{older} </span>}
            <motion.span
              key={`${call?.call_id}-${n}`} // a new sentence fades in once; growing words do not
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="text-ink"
            >
              {newest}
            </motion.span>
          </p>
        ) : (
          <p className="text-body leading-normal text-mute">
            {call ? 'Listening for the customer…' : 'Start a call to watch a wire get screened while the customer is still talking.'}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {ctl.mode === 'replay' && (
          <Button variant="ghost" onClick={() => ctl.end()}>
            End call
          </Button>
        )}
        <StartTray compact />
      </div>
    </div>
  )
}
