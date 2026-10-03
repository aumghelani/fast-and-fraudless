// Egress counts for the proof card, from the store's egress rows (newest first).
import type { EgressRow } from '../../lib/store'

export interface EgressSummary {
  denied: number // DENIED rows held in the store
  deniedLive?: EgressRow // newest DENIED row that arrived in this session
}

/** baseKey is store.egressBaseKey: rows with a larger _k arrived after the first hydrate. */
export function egressSummary(egress: EgressRow[], baseKey?: number): EgressSummary {
  let denied = 0
  let deniedLive: EgressRow | undefined
  for (const r of egress) {
    if (r.verdict !== 'DENIED') continue
    denied++
    if (!deniedLive && baseKey != null && r._k > baseKey) deniedLive = r
  }
  return { denied, deniedLive }
}
