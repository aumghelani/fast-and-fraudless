// Scene modules by id. Each scene exports a Stage component and a Details component (no props).
import type { ComponentType } from 'react'
import type { SceneId } from '../flow/scenes'
import { WatchingDetails, WatchingScene } from './watching/WatchingScene'
import { CallDetails, CallScene } from './call/CallScene'
import { DecisionDetails, DecisionScene } from './decision/DecisionScene'
import { InvestigationDetails, InvestigationScene } from './investigation/InvestigationScene'
import { ProofDetails, ProofScene } from './proof/ProofScene'
import { ResultsDetails, ResultsScene } from './results/ResultsScene'

export const registry: Record<SceneId, { Stage: ComponentType; Details: ComponentType }> = {
  watching: { Stage: WatchingScene, Details: WatchingDetails },
  call: { Stage: CallScene, Details: CallDetails },
  decision: { Stage: DecisionScene, Details: DecisionDetails },
  investigation: { Stage: InvestigationScene, Details: InvestigationDetails },
  proof: { Stage: ProofScene, Details: ProofDetails },
  results: { Stage: ResultsScene, Details: ResultsDetails },
}
