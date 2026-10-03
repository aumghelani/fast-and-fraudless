// The agent's latest run as a few plain steps, read from the case timeline.
import type { Case, Sar } from '../../lib/types'

export interface Step {
  key: string
  ts?: number | string
  text: string
  title?: string
}

/** Raw agent errors become calm words; the full message stays in the tooltip. */
export function summariseError(msg?: string): string {
  return msg && /no SAR submitted/i.test(msg) ? 'No report submitted · will retry' : 'Run failed · will retry'
}

/** Steps from the last wake-up on (woke, fetched evidence, drafted, validated), at most `max`. */
export function caseSteps(kase?: Case, max = 4): Step[] {
  const tl = kase?.timeline ?? []
  let start = 0
  for (let i = tl.length - 1; i >= 0; i--) {
    if (/^woke/i.test(String(tl[i]?.msg ?? ''))) {
      start = i
      break
    }
  }
  const out: Step[] = []
  let fetched = false
  let drafted = false
  let checked = false
  for (let i = start; i < tl.length; i++) {
    const e = tl[i]
    const msg = String(e?.msg ?? '')
    if (/^woke/i.test(msg)) {
      out.push({ key: `w${i}`, ts: e.ts, text: 'Woke on its own' + (/restart/i.test(msg) ? ' · after a restart' : '') })
    } else if (/^error/i.test(msg)) {
      out.push({ key: `e${i}`, ts: e.ts, text: summariseError(msg), title: msg })
    } else if (!fetched && /case file|evidence|fetch/i.test(msg)) {
      fetched = true
      out.push({ key: `f${i}`, ts: e.ts, text: 'Fetched the evidence' })
    }
    if (!drafted && /SAR draft received/i.test(msg)) {
      drafted = true
      out.push({ key: `d${i}`, ts: e.ts, text: 'Drafted the report' })
    }
    const m = /(\d+)\/(\d+) citations verified/.exec(msg)
    if (m && !checked) {
      checked = true
      out.push({ key: `c${i}`, ts: e.ts, text: 'Validated the citations' })
    }
  }
  // the analyst's part shows as the buttons / decision pill, not as a step
  return out.slice(-max)
}

/** Valid vs total citations on the draft. */
export function citationCheck(sar?: Sar) {
  const cites = sar?.citations ?? []
  const valid = cites.filter((c) => c.valid).length
  return { cites, total: cites.length, valid, invalid: cites.length - valid }
}
