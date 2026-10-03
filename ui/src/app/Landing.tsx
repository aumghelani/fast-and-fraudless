// Landing hero: one sentence, the 3-D voice bars, live proof numbers, and the way into the fraud desk.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Play, ShieldCheck } from 'lucide-react'
import { VoiceBars3D } from '../components/VoiceBars3D'
import { useStore } from '../lib/store'
import { DASH, compact, num } from '../lib/format'
import { useCtl } from './controls'
import { Button, Kbd } from './kit'

const EASE = [0.22, 1, 0.36, 1] as const

function Stat({ value, label, good }: { value: string; label: string; good?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`font-mono text-[34px] font-semibold tnum ${good ? 'text-clear' : 'text-ink'}`}>{value}</span>
      <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-mute">{label}</span>
    </div>
  )
}

export function Landing({ onEnter }: { onEnter: () => void }) {
  const ctl = useCtl()
  const ev = useStore((s) => s.eval)
  const dataOut = useStore((s) => s.counters?.customer_data_out)
  const live = useStore((s) => s.sse === 'live')
  const scanned = useStore((s) => s.tick?.tx_total ?? s.bench?.rows)
  const rings = useStore((s) => s.rings)
  const order = useStore((s) => s.ringOrder)
  // real data for the hero bars: the newest rings, height = accounts in each ring
  const ringBars = useMemo(() => {
    const sizes = order.slice(-56).map((id) => rings[id]?.accounts?.length ?? 0).filter((n) => n > 0)
    const max = Math.max(1, ...sizes)
    return sizes.map((n) => n / max)
  }, [rings, order])
  const frac = (a?: number | null, b?: number | null) => (a == null || b == null ? DASH : `${num(a)}/${num(b)}`)
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: EASE, delay: 0.08 * i },
  })

  return (
    <div className="dot-grid relative flex h-full min-h-[900px] flex-col overflow-hidden px-12 pb-10">
      <header className="flex h-20 shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-accent text-white">
            <ShieldCheck className="size-5" strokeWidth={2.2} />
          </span>
          <span className="font-brand text-[26px] text-ink">Fast and Fraudless</span>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 font-mono text-[13px] text-ink-2 shadow-card">
          <span className={`size-2 rounded-full ${live ? 'bg-clear' : 'bg-faint'}`} />
          {live ? 'Live on the GB10' : 'Connecting to the GB10'}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
        <motion.span {...rise(0)} className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent-soft px-4 py-1.5 font-mono text-[13px] text-accent">
          Dell Pro Max GB10 · runs inside the bank
        </motion.span>
        <motion.h1 {...rise(1)} className="max-w-[1100px] text-[72px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink">
          Stop the scam wire
          <br />
          <span className="text-ink-2">while they're still on the phone.</span>
        </motion.h1>
        <motion.p {...rise(2)} className="mt-6 max-w-[760px] text-[20px] leading-[1.6] text-ink-2">
          It listens to the call, checks the payee against laundering rings found on the GPU, and tells the banker what to
          ask. Every model runs on one box. Nothing leaves it.
        </motion.p>
        <motion.div {...rise(3)} className="mt-9 flex items-center gap-3">
          <Button variant="primary" className="h-12 px-6 text-[16px]" onClick={onEnter}>
            Open the fraud desk <ArrowRight className="size-4" /> <Kbd>⏎</Kbd>
          </Button>
          <Button
            className="h-12 px-6 text-[16px]"
            disabled={ctl.mode === 'starting'}
            onClick={() => {
              ctl.replay('CALL-01')
              onEnter()
            }}
          >
            <Play className="size-4" /> Play Margaret's call <Kbd>⇧1</Kbd>
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.35 }}
          className="mt-4 w-full max-w-[1500px]"
        >
          <VoiceBars3D active={false} orbit values={ringBars} bars={56} className="h-[240px] w-full" />
          <p className="mt-1 text-center font-mono text-[12px] text-mute">
            {ringBars.length ? `each bar is a laundering ring the GPU found · height = accounts in the ring` : 'rings appear here as the GPU finds them'}
          </p>
        </motion.div>

        <motion.div {...rise(5)} className="flex items-start gap-16">
          <Stat value={frac(ev?.scam_caught, ev?.scam_total)} label="scam calls held" />
          <Stat value={frac(ev?.false_holds, ev?.normal_total)} label="false holds" />
          <Stat value={dataOut == null ? DASH : num(dataOut)} label="customer records sent out" good={dataOut === 0} />
          <Stat value={scanned ? compact(scanned) : DASH} label="transactions scanned" />
        </motion.div>
      </main>

      <footer className="shrink-0 text-center font-mono text-[12px] tracking-[0.06em] text-mute">
        NVIDIA Nemotron · Parakeet speech · RAPIDS on the GPU · OpenClaw agent in an OpenShell sandbox · all local
      </footer>
    </div>
  )
}
