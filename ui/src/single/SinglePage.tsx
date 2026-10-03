// The whole story on one page: header, live call strip, the decision pipeline as the hero, four quiet cards.
// Sized for 1920x1080 without scrolling; smaller screens scroll the main area.
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Header } from '../shell/Header'
import { DecisionPipeline } from '../components/pipeline/DecisionPipeline'
import { usePipelineData } from '../components/pipeline/usePipelineData'
import { usePrefersReducedMotion } from '../ui/tokens'
import { CallStrip } from './CallStrip'
import { RingFinderCard } from './cards/RingFinderCard'
import { InvestigatorCard } from './cards/InvestigatorCard'
import { ProofCard } from './cards/ProofCard'
import { ResultsCard } from './cards/ResultsCard'

// faint ink dot grid, 22px
const DOTS = {
  backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--color-ink) 5%, transparent) 1px, transparent 1.5px)',
  backgroundSize: '22px 22px',
}

/** Fades and lifts 8px in once on load; later renders never re-animate. */
function Enter({ i, className, children }: { i: number; className?: string; children: ReactNode }) {
  const reduced = usePrefersReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: 0.06 * i }}
    >
      {children}
    </motion.div>
  )
}

function Hero() {
  const { call, queue } = usePipelineData()
  return <DecisionPipeline call={call} queue={queue} />
}

export function SinglePage() {
  return (
    <div className="flex h-full flex-col bg-bg text-ink" style={DOTS}>
      <Header />
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="grid h-full min-h-[56rem] grid-rows-[auto_minmax(26rem,1fr)_18rem] gap-6 px-8 py-6">
          <Enter i={0}>
            <CallStrip />
          </Enter>
          <Enter i={1} className="h-full min-h-0">
            <Hero />
          </Enter>
          <div className="grid min-h-0 grid-cols-4 gap-6">
            <Enter i={2} className="h-full min-h-0">
              <RingFinderCard />
            </Enter>
            <Enter i={3} className="h-full min-h-0">
              <InvestigatorCard />
            </Enter>
            <Enter i={4} className="h-full min-h-0">
              <ProofCard />
            </Enter>
            <Enter i={5} className="h-full min-h-0">
              <ResultsCard />
            </Enter>
          </div>
        </div>
      </main>
    </div>
  )
}
