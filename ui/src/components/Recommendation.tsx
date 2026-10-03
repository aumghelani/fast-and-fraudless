import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShieldAlert, ShieldCheck, ShieldQuestion, Hand, Send, GitFork, HelpCircle, CheckCircle2 } from 'lucide-react'
import { useActiveCall } from '../lib/store'
import { api } from '../lib/api'
import { cx, usd } from '../lib/format'
import { PayeeGraph } from './PayeeGraph'

const STYLE = {
  HOLD: {
    title: 'HOLD THIS WIRE', icon: ShieldAlert, text: 'text-danger', ring: 'border-danger/70',
    bg: 'bg-[linear-gradient(135deg,rgba(255,59,59,0.22),rgba(255,59,59,0.04)_60%)]', glow: 'shadow-[0_0_60px_rgba(255,59,59,0.28)]',
  },
  VERIFY: {
    title: 'VERIFY BEFORE RELEASE', icon: ShieldQuestion, text: 'text-amber', ring: 'border-amber/70',
    bg: 'bg-[linear-gradient(135deg,rgba(245,165,36,0.2),rgba(245,165,36,0.03)_60%)]', glow: 'shadow-[0_0_50px_rgba(245,165,36,0.2)]',
  },
  NO_HOLD: {
    title: 'NO HOLD', icon: ShieldCheck, text: 'text-safe', ring: 'border-safe/60',
    bg: 'bg-[linear-gradient(135deg,rgba(47,210,122,0.16),rgba(47,210,122,0.02)_60%)]', glow: 'shadow-[0_0_40px_rgba(47,210,122,0.15)]',
  },
} as const

export function PayeeCheck() {
  const call = useActiveCall()
  const pc = call?.payee_check
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-black/20">
      <div className="flex items-center gap-1.5 px-3 pt-2 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink-2">
        <GitFork className="h-3.5 w-3.5 text-mute" /> Payee check
        <span className="truncate font-mono text-[0.66rem] font-normal normal-case tracking-normal text-mute">{call?.payee_account ?? ''}</span>
      </div>
      <div className="relative min-h-[6.5rem] flex-1">
        {call ? <PayeeGraph call={call} /> : <div className="flex h-full items-center justify-center text-sm text-mute">—</div>}
      </div>
      <div className="px-2 pb-2">
        <AnimatePresence mode="wait">
          {pc?.in_ring ? (
            <motion.div key="in" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-lg border border-danger/50 bg-danger/12 px-2.5 py-1.5 text-[0.74rem] font-semibold leading-snug text-danger-ink">
              Payee is in ring <span className="font-mono text-danger">{pc.ring_id}</span> found by the GPU
              <span className="font-normal text-ink-2"> · {pc.hops === 1 ? 'payee is the hub' : `${pc.hops ?? '—'} hops`}</span>
            </motion.div>
          ) : pc?.error ? (
            <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[0.72rem] text-amber">
              {pc.error}
            </motion.div>
          ) : call?.recommendation ? (
            <motion.div key="out" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-lg border border-safe/40 bg-safe/10 px-2.5 py-1.5 text-[0.74rem] font-semibold text-safe">
              Payee not in any ring found by the GPU
            </motion.div>
          ) : (
            <div className="px-1 py-1.5 text-[0.72rem] text-mute">{call ? 'checked at the first analysis' : 'no call'}</div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function Recommendation() {
  const call = useActiveCall()
  const rec = call?.recommendation
  const [pending, setPending] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const decide = async (d: 'hold' | 'release') => {
    if (!call) return
    setPending(d)
    setErr(null)
    try {
      await api.callDecision(call.call_id, d)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-xl">
      <AnimatePresence mode="wait">
        {!rec || !call ? (
          <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="panel flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="panel-title">Recommendation</div>
            <div className="max-w-[22rem] text-[0.86rem] text-mute">
              {call && !call.ended ? 'Listening. The rules decide after the first 10-second window is transcribed and read.' : 'Start or replay a call. Models perceive, code decides, the banker approves.'}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key={call.call_id + rec}
            initial={{ x: 80, opacity: 0, scale: 0.96 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: -40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 220, damping: 24 }}
            className={cx('flex h-full flex-col rounded-xl border-2 bg-panel px-5 py-4', STYLE[rec].ring, STYLE[rec].bg, STYLE[rec].glow)}
          >
            {card(rec)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  function card(rec: "HOLD" | "VERIFY" | "NO_HOLD") {
    const S = STYLE[rec]
    const Icon = S.icon
    const reasons = call!.reasons || []
    const questions = call!.questions || []
    const bd = call!.banker_decision
    return (
      <>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon className={cx('h-11 w-11 shrink-0', S.text)} strokeWidth={2.2} />
            <div className="leading-none">
              <div className={cx('text-[2.25rem] font-black tracking-tight', S.text)}>{S.title}</div>
              <div className="mt-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-ink-2">
                {call!.ended ? 'final · whole call' : 'provisional · call in progress'} · rules decide, not the model
              </div>
            </div>
          </div>
          <div className="text-right leading-none">
            <div className="tnum text-[2rem] font-black text-ink">{usd(call!.amount)}</div>
            <div className="mt-1 font-mono text-[0.72rem] text-ink-2">to {call!.payee_account ?? '—'}</div>
          </div>
        </div>

        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[1.25fr_1fr] gap-4">
          <div className="scroll-thin min-h-0 overflow-y-auto pr-1">
            <div className="mb-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-mute">Why</div>
            <ul className="space-y-1">
              {reasons.slice(0, 6).map((r, i) => (
                <motion.li key={r} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                  className="flex gap-2 text-[0.8rem] leading-snug text-ink">
                  <span className={cx('mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full', rec === 'HOLD' ? 'bg-danger' : rec === 'VERIFY' ? 'bg-amber' : 'bg-safe')} />
                  {r}
                </motion.li>
              ))}
              {reasons.length > 6 && <li className="text-[0.72rem] text-mute">+{reasons.length - 6} more</li>}
            </ul>
          </div>
          <div className="min-h-0">
            <div className="mb-1 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-mute">Ask the customer</div>
            <ol className="space-y-1.5">
              {questions.slice(0, 3).map((q, i) => (
                <li key={q} className="flex gap-2 text-[0.8rem] leading-snug text-ink">
                  <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-2" />
                  <span><span className="font-bold text-ink-2">{i + 1}.</span> {q}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => decide('hold')}
            disabled={!!pending}
            className={cx('btn !px-5 !py-2.5 !text-[0.95rem]', bd === 'hold' ? '!border-danger !bg-danger text-white' : '!border-danger/60 text-danger-ink')}
          >
            <Hand className="h-4 w-4" /> HOLD
          </button>
          <button
            onClick={() => decide('release')}
            disabled={!!pending}
            className={cx('btn !px-5 !py-2.5 !text-[0.95rem]', bd === 'release' ? '!border-safe !bg-safe text-black' : '!border-safe/50 text-safe')}
          >
            <Send className="h-4 w-4" /> RELEASE
          </button>
          <AnimatePresence>
            {bd && (
              <motion.div key={bd} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-[0.86rem] font-semibold text-ink">
                <CheckCircle2 className={cx('h-4 w-4', bd === 'hold' ? 'text-danger' : 'text-safe')} />
                Banker decision: <span className={bd === 'hold' ? 'text-danger-ink' : 'text-safe'}>{bd === 'hold' ? 'WIRE HELD' : 'RELEASED'}</span>
              </motion.div>
            )}
          </AnimatePresence>
          {!bd && <span className="text-[0.74rem] text-mute">The banker decides. Nothing is sent automatically.</span>}
          {err && <span className="text-[0.74rem] text-amber">{err}</span>}
        </div>
      </>
    )
  }
}
