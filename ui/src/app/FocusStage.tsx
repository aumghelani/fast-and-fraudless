// Focus stage: shown when the details are minimised. Big 3-D voice bars, the newest words, and the suggestion box.
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Lightbulb } from 'lucide-react'
import { VoiceBars3D } from '../components/VoiceBars3D'
import { api } from '../lib/api'
import { useCtl } from './controls'
import { Button, Pill } from './kit'
import { EASE } from './interact'
import { useActiveCall, verdictOf, VERDICT_TONE } from './selectors'
import { captionOf, customerName } from './call/helpers'

const HEADLINE = { HOLD: 'Hold this wire', VERIFY: 'Verify before sending', NO_HOLD: 'No hold needed' } as const

function SuggestionBox() {
  const call = useActiveCall()
  const v = verdictOf(call)
  const [busy, setBusy] = useState<null | 'hold' | 'release'>(null)
  const [err, setErr] = useState('')
  const done = call?.banker_decision
  const decide = async (d: 'hold' | 'release') => {
    if (!call) return
    setBusy(d)
    setErr('')
    try {
      await api.callDecision(call.call_id, d)
    } catch (e) {
      setErr('Could not save. Try again.')
      console.warn(e)
    } finally {
      setBusy(null)
    }
  }
  const qs = (call?.questions || []).slice(0, 3)
  return (
    <section className="card flex h-full w-[460px] shrink-0 flex-col overflow-hidden p-6">
      <header className="flex items-center gap-2 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-ink-2">
        <Lightbulb className="size-4 text-accent" /> Suggestion
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={v ?? 'none'}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          {!call ? (
            <p className="text-[17px] leading-relaxed text-ink-2">Start a call. Suggestions for the banker appear here while the customer is still talking.</p>
          ) : !v ? (
            <p className="text-[17px] leading-relaxed text-ink-2">Listening to {customerName(call) ?? 'the customer'}… the rules decide after the first words.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className={`text-[24px] font-semibold leading-tight ${v === 'HOLD' ? 'text-hold' : v === 'VERIFY' ? 'text-verify' : 'text-clear'}`}>
                  {HEADLINE[v]}
                </span>
              </div>
              {call.reasons?.[0] && <p className="mt-1.5 line-clamp-2 text-[14px] leading-snug text-ink-2">{call.reasons[0]}</p>}
              {qs.length > 0 && (
                <>
                  <div className="mt-4 font-mono text-[12px] uppercase tracking-[0.08em] text-mute">Ask the customer</div>
                  <ol className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                    {qs.map((q, i) => (
                      <motion.li
                        key={q}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 * i }}
                        className="flex shrink-0 gap-3 text-[15px] leading-snug text-ink"
                      >
                        <span className="font-mono text-[13px] leading-[1.4rem] text-accent">{i + 1}</span>
                        <span className="line-clamp-2">{q}</span>
                      </motion.li>
                    ))}
                  </ol>
                </>
              )}
              <div className="mt-auto flex shrink-0 items-center gap-3 pt-4">
                {done ? (
                  <Pill tone={done === 'hold' ? 'hold' : 'clear'}>{done === 'hold' ? 'Held by the banker' : 'Released by the banker'}</Pill>
                ) : (
                  <>
                    <Button variant="hold" disabled={!!busy} onClick={() => decide('hold')}>
                      {busy === 'hold' ? 'Holding…' : 'Hold wire'}
                    </Button>
                    <Button disabled={!!busy} onClick={() => decide('release')}>
                      {busy === 'release' ? 'Releasing…' : 'Release'}
                    </Button>
                  </>
                )}
                {err && <span className="text-[13px] text-hold">{err}</span>}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}

export function FocusStage() {
  const ctl = useCtl()
  const call = useActiveCall()
  const v = verdictOf(call)
  const live = ctl.mode === 'replay' || ctl.mode === 'mic'
  const cap = captionOf(call)
  const line = cap.partial || cap.done[cap.done.length - 1] || ''
  return (
    <div className="flex h-full min-h-0 gap-6">
      <section className="card relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-2">
          <span>Live voice · Parakeet on the GB10</span>
          {v && <Pill tone={VERDICT_TONE[v]}>{v === 'NO_HOLD' ? 'Clear' : v === 'VERIFY' ? 'Verify' : 'Hold'}</Pill>}
        </div>
        <div className="min-h-0 flex-1">
          <VoiceBars3D active={live} tone={v ?? 'listening'} orbit bars={60} className="h-full w-full" />
        </div>
        <div className="min-h-[72px] px-8 pb-6 text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={line ? line.slice(0, 24) : 'idle'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="mx-auto line-clamp-2 max-w-[900px] text-[22px] leading-snug text-ink"
            >
              {line ? `“${line}”` : live ? 'Listening…' : 'Press ⇧1 for Margaret’s call, or M to use the microphone.'}
            </motion.p>
          </AnimatePresence>
        </div>
      </section>
      <SuggestionBox />
    </div>
  )
}
