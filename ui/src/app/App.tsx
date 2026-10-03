// Fast and Fraudless: a landing hero, then one light fraud-desk page. The live call flows left to right
// through the rules to a decision; the ring finder, the investigator agent, the proof and the results sit underneath.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { connect, useStore } from '../lib/store'
import { DASH, num } from '../lib/format'
import { BAR_H, EASE, Expandable, Section } from './interact'
import { useActiveCall, useShownSar, verdictOf, VERDICT_LABEL } from './selectors'
import { CallControlsProvider, runExfil, useCtl } from './controls'
import { Landing } from './Landing'
import { SuggestionBox } from './Suggestion'
import { Header } from './Header'
import { CallPanel } from './CallPanel'
import { Pipeline } from './Pipeline'
import { RingCard } from './RingCard'
import { AgentCard } from './AgentCard'
import { ResultsCard } from './ResultsCard'

function useShortcuts(onEnter: () => void, onHome: () => void) {
  const ctl = useCtl()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.shiftKey && e.code === 'Digit1') ctl.replay('CALL-01')
      else if (e.shiftKey && e.code === 'Digit2') ctl.replay('CALL-02')
      else if (!e.shiftKey && e.code === 'KeyM') ctl.toggleMic()
      else if (e.shiftKey && e.code === 'KeyM') ctl.startMicCall('CALL-01')
      else if (!e.shiftKey && e.code === 'KeyE') runExfil()
      else if (e.code === 'Escape') ctl.end()
      else if (e.code === 'Enter') onEnter()
      else if (e.code === 'Home') onHome()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl, onEnter, onHome])
}

function WhySummary() {
  const call = useActiveCall()
  const v = verdictOf(call)
  if (!call) return <>No call yet · press ⇧1 to play Margaret's call</>
  if (!v) return <>Listening · the rules decide after the first words</>
  const tone = v === 'HOLD' ? 'text-hold' : v === 'VERIFY' ? 'text-verify' : 'text-clear'
  return (
    <>
      <span className={tone}>{VERDICT_LABEL[v]}</span>
      {call.reasons?.[0] ? ` · ${call.reasons[0]}` : ''}
    </>
  )
}

function BehindSummary() {
  const ev = useStore((s) => s.eval)
  const out = useStore((s) => s.counters?.customer_data_out)
  const { sar } = useShownSar()
  const cits = sar?.citations || []
  const ok = cits.filter((c) => c.valid).length
  return (
    <>
      {num(ev?.rings_found)} rings found · {sar ? `${ok}/${cits.length} citations verified` : 'no report yet'} ·{' '}
      <span className={out === 0 ? 'text-clear' : ''}>{num(out)} records sent out</span> ·{' '}
      {ev?.scam_caught != null ? `${ev.scam_caught}/${ev.scam_total} scam calls held` : DASH}
    </>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
type Open = 'why' | 'behind' | null

/** One detail section open at a time; whatever space is left goes to the live call. */
function useAccordion(): [Open, (k: Exclude<Open, null>) => void] {
  const [open, setOpen] = useState<Open>(() => {
    try {
      const v = localStorage.getItem('ff.acc')
      return v === 'why' || v === 'behind' ? v : v === 'none' ? null : 'why'
    } catch {
      return 'why'
    }
  })
  const toggle = (k: Exclude<Open, null>) =>
    setOpen((o) => {
      const n = o === k ? null : k
      try {
        localStorage.setItem('ff.acc', n ?? 'none')
      } catch {
        /* private mode */
      }
      return n
    })
  return [open, toggle]
}

function Desk() {
  const [open, toggle] = useAccordion()
  const vh = useViewportH()
  const whyOpen = Math.round(clamp(vh * 0.35, 280, 420)) // queue, proof and decision + label row
  const behindOpen = Math.round(clamp(vh * 0.34, 250, 340)) // metric cards + label row
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, ease: EASE, delay: 0.06 * i },
  })
  return (
    <div className="dot-grid grid h-full min-h-[800px] grid-cols-[minmax(0,1fr)] grid-rows-[56px_minmax(0,1fr)_auto] gap-4 overflow-x-hidden px-6 pb-5">
      <motion.div {...rise(0)} data-block="header" className="min-h-0 min-w-0">
        <Header />
      </motion.div>
      <motion.div {...rise(1)} className="flex min-h-0 min-w-0 gap-4">
        <div className="min-w-0 flex-1">
          <CallPanel />
        </div>
        <SuggestionBox />
      </motion.div>
      <motion.div {...rise(2)} data-block="details" className="flex min-w-0 flex-col gap-4">
        <Section block="why" title="Why this decision" summary={<WhySummary />} open={open === 'why'} onToggle={() => toggle('why')}
          height={open === 'why' ? whyOpen : BAR_H}>
          <Pipeline />
        </Section>
        <Section block="behind" title="Behind the scenes" summary={<BehindSummary />} open={open === 'behind'} onToggle={() => toggle('behind')}
          height={open === 'behind' ? behindOpen : BAR_H}>
          <div className="grid h-full min-h-0 grid-cols-3 gap-4">
            <Expandable id="ring">
              <RingCard />
            </Expandable>
            <Expandable id="agent">
              <AgentCard />
            </Expandable>
            <Expandable id="results">
              <ResultsCard />
            </Expandable>
          </div>
        </Section>
      </motion.div>
    </div>
  )
}

/** Height of the window, for sections that scale with the screen instead of zooming the page. */
function useViewportH(): number {
  const [h, setH] = useState(() => window.innerHeight)
  useEffect(() => {
    document.documentElement.style.zoom = '' // an older build zoomed the page; never again
    const f = () => setH(window.innerHeight)
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return h
}

function Shell() {
  const ctl = useCtl()
  const [entered, setEntered] = useState(false)
  const enter = () => setEntered(true)
  const home = () => setEntered(false)
  useShortcuts(enter, home)
  // a call starting from anywhere opens the desk
  useEffect(() => {
    if (ctl.mode !== 'idle') setEntered(true)
  }, [ctl.mode])
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={entered ? 'desk' : 'landing'}
        className="h-full"
        initial={{ opacity: 0, y: entered ? 16 : -16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: entered ? 16 : -16, transition: { duration: 0.25 } }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        {entered ? <Desk /> : <Landing onEnter={enter} />}
      </motion.div>
    </AnimatePresence>
  )
}

export function App() {
  useEffect(() => {
    connect()
  }, [])
  return (
    <CallControlsProvider>
      <Shell />
    </CallControlsProvider>
  )
}
