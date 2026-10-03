// Incoming in-app call: a banner over the page (the layout never moves), a soft ring, Answer (A) or Decline.
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Phone, PhoneOff } from 'lucide-react'
import { audioCtx } from '../lib/audio'
import { line, type Line } from '../lib/rtc'
import { useCtl } from './controls'
import { Button } from './kit'
import { EASE } from './interact'

/** Two short tones every three seconds while ringing (only if the page may already play sound). */
function useRing(on: boolean) {
  useEffect(() => {
    if (!on) return
    let stop = false
    const ring = () => {
      try {
        const ctx = audioCtx()
        if (ctx.state !== 'running') return
        for (const [at, f] of [[0, 523], [0.18, 659]] as const) {
          const o = ctx.createOscillator()
          const g = ctx.createGain()
          o.frequency.value = f
          g.gain.setValueAtTime(0, ctx.currentTime + at)
          g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + at + 0.02)
          g.gain.linearRampToValueAtTime(0, ctx.currentTime + at + 0.16)
          o.connect(g).connect(ctx.destination)
          o.start(ctx.currentTime + at)
          o.stop(ctx.currentTime + at + 0.18)
        }
      } catch {
        /* no sound is fine */
      }
    }
    ring()
    const t = setInterval(() => !stop && ring(), 3000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [on])
}

export function IncomingCall() {
  const ctl = useCtl()
  const [ringing, setRinging] = useState<Line | null>(null)
  const busy = useRef(false)

  // watch the desk line
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const l = await line.state()
        if (!alive) return
        setRinging(l.state === 'ringing' && l.id ? l : null)
      } catch {
        /* box unreachable: keep quiet */
      }
    }
    tick()
    const t = setInterval(tick, 800)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const answer = async () => {
    if (!ringing || busy.current) return
    busy.current = true
    const r = ringing
    setRinging(null)
    await ctl.answerPhone(r)
    busy.current = false
  }
  const decline = () => {
    if (ringing?.id) line.hangup(ringing.id).catch(() => {})
    setRinging(null)
  }

  // A answers from anywhere on the page
  useEffect(() => {
    if (!ringing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        answer()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useRing(!!ringing)

  return (
    <AnimatePresence>
      {ringing && (
        <motion.div
          key={ringing.id}
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2"
        >
          <div className="card flex items-center gap-5 py-3 pl-4 pr-3 ring-2 ring-accent/40">
            <span className="relative grid size-12 place-items-center rounded-full bg-accent text-white">
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full bg-accent"
                animate={{ scale: [1, 1.7], opacity: [0.4, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
              />
              <Phone className="relative size-5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[13px] uppercase tracking-[0.08em] text-ink-2">Incoming call</div>
              <div className="truncate text-[18px] font-semibold text-ink">{ringing.name || 'Customer'}</div>
            </div>
            <div className="ml-2 flex items-center gap-2">
              <button
                onClick={answer}
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-clear px-4 text-[15px] font-medium text-white hover:opacity-90"
              >
                <Phone size={15} /> Answer <kbd className="rounded border border-white/30 bg-white/15 px-1.5 font-mono text-[12px]">A</kbd>
              </button>
              <Button onClick={decline}>
                <PhoneOff size={15} /> Decline
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
