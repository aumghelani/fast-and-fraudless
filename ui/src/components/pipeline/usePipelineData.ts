// Store glue for the pipeline: the story call (else the newest), recent calls and screened payments.
import { useMemo } from 'react'
import { useStore } from '../../lib/store'
import { toPipeline } from './adapter'
import type { PipelineData } from './types'

export function usePipelineData(): PipelineData {
  const calls = useStore((s) => s.calls)
  const activeId = useStore((s) => s.story.storyCallId)
  const integrations = useStore((s) => s.integrations)
  return useMemo(() => toPipeline(calls, { activeId, integrations }), [calls, activeId, integrations])
}
