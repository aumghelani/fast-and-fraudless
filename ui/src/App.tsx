import { useEffect, useRef } from 'react'
import { TopBar } from './components/TopBar'
import { BankMap } from './components/BankMap'
import { Throughput } from './components/Throughput'
import { LiveCall } from './components/LiveCall'
import { Recommendation } from './components/Recommendation'
import { AgentPanel } from './components/AgentPanel'
import { EgressLog } from './components/EgressLog'
import { Gauges } from './components/Gauges'
import { EvalStrip } from './components/EvalStrip'
import { OfflineFlash, RestoredBanner } from './components/Banners'
import { connect } from './lib/store'
import { useCallControls } from './lib/useCallControls'

export default function App() {
  const ctl = useCallControls()
  const exfilRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    connect()
  }, [])

  // demo keyboard: 1 / 2 replay, E exfil, M mic
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === '1') ctlRef.current.replay('CALL-01')
      else if (k === '2') ctlRef.current.replay('CALL-02')
      else if (k === 'e') exfilRef.current?.()
      else if (k === 'm') ctlRef.current.toggleMic()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app-bg flex h-full flex-col">
      <TopBar />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,26fr)_minmax(0,41fr)_minmax(0,33fr)] gap-3 p-3">
        <section className="flex min-h-0 flex-col gap-3">
          <BankMap />
          <Throughput />
        </section>
        <section className="flex min-h-0 flex-col gap-3">
          <LiveCall ctl={ctl} />
          <div className="h-[20.5rem] shrink-0">
            <Recommendation />
          </div>
        </section>
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex min-h-0 flex-[1.25] flex-col">
            <AgentPanel />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <EgressLog exfilRef={exfilRef} />
          </div>
          <Gauges />
        </section>
      </main>
      <EvalStrip />
      <RestoredBanner />
      <OfflineFlash />
    </div>
  )
}
