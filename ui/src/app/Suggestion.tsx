// Suggestion box: what the banker should do and ask right now, updated while the customer talks.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Lightbulb } from 'lucide-react'
import { api } from '../lib/api'
import { cx } from '../lib/format'
import { Button, Pill } from './kit'
import { EASE } from './interact'
import { heardOf, useActiveCall, verdictOf } from './selectors'
import { customerName } from './call/helpers'
import { cueLabel } from './pipeline/checks'

const HEADLINE = { HOLD: 'Hold this wire', VERIFY: 'Verify before sending', NO_HOLD: 'No hold needed' } as const

export function SuggestionBox() {
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
  const [asked, setAsked] = useState<Record<string, boolean>>({})
  useEffect(() => setAsked({}), [call?.call_id])
  const heardCues = Array.from(new Set((call?.cues ?? []).map((q) => String(q?.cue).toUpperCase()))).filter((k) => k !== 'AMOUNT_STATED')
  return (
    <section data-block="suggestion" className="card flex h-full w-[440px] shrink-0 flex-col overflow-hidden px-5 py-4 max-[1700px]:w-[380px] max-[1450px]:w-[330px]">
      <header className="flex items-center gap-2 font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-ink-2">
        <Lightbulb className="size-4 text-accent" /> Suggestion
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={v ?? 'none'}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mt-2 flex min-h-0 flex-1 flex-col"
        >
          {!call ? (
            <p className="text-[17px] leading-relaxed text-ink-2">Start a call. Suggestions for the banker appear here while the customer is still talking.</p>
          ) : !v ? (
            <div className="flex flex-col gap-4">
              <p className="text-[17px] leading-relaxed text-ink-2">
                {heardOf(call) ? `Listening to ${customerName(call) ?? 'the customer'}… suggestions appear once the payment is asked for.` : `Waiting for ${customerName(call) ?? 'the customer'} to speak…`}
              </p>
              {heardCues.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {heardCues.map((k) => <Pill key={k} tone="verify">heard: {cueLabel(k)}</Pill>)}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className={`text-[21px] font-semibold leading-tight ${v === 'HOLD' ? 'text-hold' : v === 'VERIFY' ? 'text-verify' : 'text-clear'}`}>
                  {HEADLINE[v]}
                </span>
              </div>
              {call.reasons?.[0] && <p className="mt-1 line-clamp-1 text-[14.5px] leading-snug text-ink-2" title={call.reasons[0]}>{call.reasons[0]}</p>}
              {qs.length > 0 && (
                <>
                  <ol aria-label="Ask the customer" className="mt-2.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                    {qs.map((q, i) => (
                      <motion.li
                        key={q}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 * i }}
                        className="shrink-0"
                      >
                        {/* click to tick a question off once it has been asked */}
                        <button
                          onClick={() => setAsked((m) => ({ ...m, [q]: !m[q] }))}
                          className={cx('flex w-full gap-2.5 rounded-lg px-1.5 py-1 text-left text-[15px] leading-[1.35] transition-colors hover:bg-surface-2',
                            asked[q] ? 'text-mute line-through decoration-faint' : 'text-ink')}
                        >
                          <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border font-mono text-[12px]',
                            asked[q] ? 'border-clear bg-clear text-white' : 'border-line-2 text-accent')}>
                            {asked[q] ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                          </span>
                          <span className="line-clamp-2">{q}</span>
                        </button>
                      </motion.li>
                    ))}
                  </ol>
                </>
              )}
              <div className="mt-auto flex shrink-0 items-center gap-3 pt-2">
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
                {err && <span className="text-[14px] text-hold">{err}</span>}
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}

