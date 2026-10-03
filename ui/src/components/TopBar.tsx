import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Cpu, ShieldCheck, Send, Ban, Wifi, WifiOff } from 'lucide-react'
import { useStore } from '../lib/store'
import { num } from '../lib/format'
import { AnimatedNumber } from './ui'

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="text-right leading-tight">
      <div className="tnum font-mono text-[1.55rem] font-semibold text-ink">
        {now.toLocaleTimeString('en-US', { hour12: false })}
      </div>
      <div className="text-[0.68rem] uppercase tracking-widest text-mute">
        {now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })} · Boston
      </div>
    </div>
  )
}

function NetPill() {
  const net = useStore((s) => s.net)
  const online = net?.online
  const unknown = online === undefined
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={unknown ? 'u' : online ? 'on' : 'off'}
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 1.1, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        className={
          'flex items-center gap-3 rounded-full border-2 px-6 py-2 ' +
          (unknown
            ? 'border-line-2 text-mute'
            : online
              ? 'border-safe/60 bg-safe/10 text-safe'
              : 'border-danger bg-danger text-white shadow-[0_0_40px_rgba(255,59,59,0.55)]')
        }
      >
        {online === false ? <WifiOff className="h-7 w-7" strokeWidth={2.5} /> : <Wifi className="h-7 w-7" strokeWidth={2.5} />}
        <div className="leading-none">
          <div className="text-[1.9rem] font-black tracking-[0.12em]">
            {unknown ? 'NETWORK —' : online ? 'ONLINE' : 'OFFLINE'}
          </div>
          {online === false && (
            <div className="mt-1 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-white/85">
              no internet · everything still runs on the box
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function Counter({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: number | undefined; sub?: string; tone: 'safe' | 'ink' | 'danger'
}) {
  const color = tone === 'safe' ? 'text-safe' : tone === 'danger' ? 'text-danger-ink' : 'text-ink'
  return (
    <div className="flex items-center gap-3 border-l border-line px-5">
      <span className="text-mute">{icon}</span>
      <div className="leading-tight">
        <div className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-ink-2">{label}</div>
        <div className="flex items-baseline gap-2">
          <AnimatedNumber value={value} format={(v) => num(Math.round(v))} className={`text-[1.9rem] font-bold ${color}`} />
          {sub && <span className="text-[0.68rem] text-mute">{sub}</span>}
        </div>
      </div>
    </div>
  )
}

export function TopBar() {
  const counters = useStore((s) => s.counters)
  const sse = useStore((s) => s.sse)
  const dataOut = counters?.customer_data_out
  return (
    <header className="flex h-[5.6rem] shrink-0 items-center gap-6 border-b border-line bg-[#080b10] px-6">
      <div className="flex min-w-0 items-center gap-4">
        <svg viewBox="0 0 32 32" className="h-11 w-11 shrink-0">
          <rect width="32" height="32" rx="8" fill="#11161e" stroke="#2a3342" />
          <path d="M5 20h7l3-9 4 14 3-5h5" fill="none" stroke="#ff3b3b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-3">
            <span className="text-[1.8rem] font-black tracking-[0.06em] text-ink">
              Fast <span className="font-light text-ink-2">and</span> Fraud<span className="text-danger">less</span>
            </span>
            <span className="rounded border border-amber/60 bg-amber/10 px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-amber">
              Synthetic data
            </span>
          </div>
          <div className="truncate text-[0.92rem] text-ink-2">Stops a scam wire while the customer is still on the phone</div>
          <div className="flex items-center gap-1.5 text-[0.68rem] text-mute">
            <Cpu className="h-3 w-3 text-nv" />
            Running on <span className="text-ink-2">Dell Pro Max GB10</span> · all inference local
            <span className="mx-1">·</span>
            <span className={sse === 'live' ? 'text-safe' : 'text-amber'}>● {sse === 'live' ? 'live stream' : sse}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 justify-center">
        <NetPill />
      </div>

      <div className="flex items-center">
        <Counter
          icon={<ShieldCheck className="h-6 w-6" />}
          label="Customer data sent out"
          value={dataOut}
          tone={dataOut ? 'danger' : 'safe'}
        />
        <Counter icon={<Send className="h-5 w-5" />} label="Alerts sent" value={counters?.alerts_sent} sub="no PII" tone="ink" />
        <Counter icon={<Ban className="h-5 w-5" />} label="Egress denied" value={counters?.denied_total} tone="ink" />
        <div className="ml-2 border-l border-line pl-5">
          <Clock />
        </div>
      </div>
    </header>
  )
}
