// Egress counts for the Proof scene, from the store's egress rows (newest first).
import type { EgressRow } from '../../lib/store'

export interface EgressSummary {
  polls: number // ALLOWED Telegram long-polls
  otherAllowed: number // every other ALLOWED row
  deniedLive?: EgressRow // newest DENIED row that arrived in this session
}

/** baseKey is store.egressBaseKey: rows with a larger _k arrived after the first hydrate. */
export function egressSummary(egress: EgressRow[], baseKey?: number): EgressSummary {
  let polls = 0
  let otherAllowed = 0
  let deniedLive: EgressRow | undefined
  for (const r of egress) {
    if (r.verdict === 'ALLOWED') {
      if (r.kind === 'poll') polls++
      else otherAllowed++
    } else if (r.verdict === 'DENIED' && !deniedLive && baseKey != null && r._k > baseKey) {
      deniedLive = r
    }
  }
  return { polls, otherAllowed, deniedLive }
}
