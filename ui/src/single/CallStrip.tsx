// Live call strip: orb, who is on the line, the newest sentence, and the start buttons.
import { AnimatePresence, motion } from 'motion/react'
import { useStoryCall, verdictOf } from '../flow/derive'
import { useCtl } from '../flow/CtlProvider'
import { StartTray } from '../shell/StartTray'
import { VoiceOrb, type OrbTone } from '../components/VoiceOrb'
import { customerName, mmss } from '../scenes/call/CallScene'
import { Button } from '../ui/primitives'
import { DASH, usd } from '../lib/format'
import type { Call } from '../lib/types'

/** The last sentence said, the in-progress words first. */
function newestSentence(c?: Call): string {
  const text = `${c?.transcript_final ?? c?.transcript ?? ''} ${c?.partial ?? ''}`.trim()
  if (!text) return ''
  const parts = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  return parts[parts.length - 1] ?? ''
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
  const said = newestSentence(call)
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

      {/* newest sentence; a new one fades in over 300 ms */}
      <div className="relative h-full min-w-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            key={said || (call ? 'waiting' : 'empty')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="absolute inset-0 flex items-center"
          >
            <span className={said ? 'line-clamp-2 text-body text-ink' : 'text-body text-mute'}>
              {said ? `“${said}”` : call ? 'Listening for the customer…' : 'Start a call to watch a wire get screened while the customer is still talking.'}
            </span>
          </motion.p>
        </AnimatePresence>
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
