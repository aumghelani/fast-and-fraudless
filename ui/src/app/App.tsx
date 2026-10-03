// Fast and Fraudless: one light page. The live call flows left to right through the rules to a decision;
// the GPU ring finder, the investigator agent, the proof and the results sit underneath.
import { useEffect } from 'react'
import { connect } from '../lib/store'
import { CallControlsProvider, runExfil, useCtl } from './controls'
import { Header } from './Header'
import { CallPanel } from './CallPanel'
import { Pipeline } from './Pipeline'
import { RingCard } from './RingCard'
import { AgentCard } from './AgentCard'
import { ProofCard } from './ProofCard'
import { ResultsCard } from './ResultsCard'

function useShortcuts() {
  const ctl = useCtl()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.shiftKey && e.code === 'Digit1') ctl.replay('CALL-01')
      else if (e.shiftKey && e.code === 'Digit2') ctl.replay('CALL-02')
      else if (!e.shiftKey && e.code === 'KeyM') ctl.toggleMic()
      else if (!e.shiftKey && e.code === 'KeyE') runExfil()
      else if (e.code === 'Escape') ctl.end()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl])
}

function Page() {
  useShortcuts()
  return (
    <div className="dot-grid grid h-full min-h-[960px] grid-rows-[64px_auto_minmax(0,1fr)_300px] gap-6 px-8 pb-8">
      <Header />
      <CallPanel />
      <Pipeline />
      <div className="grid min-h-0 grid-cols-4 gap-6">
        <RingCard />
        <AgentCard />
        <ProofCard />
        <ResultsCard />
      </div>
    </div>
  )
}

export function App() {
  useEffect(() => {
    connect()
  }, [])
  return (
    <CallControlsProvider>
      <Page />
    </CallControlsProvider>
  )
}
