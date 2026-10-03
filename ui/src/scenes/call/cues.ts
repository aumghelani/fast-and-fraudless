// Cue names, labels and where each cue quote sits in the transcript.
import type { Cue } from '../../lib/types'

export const HIGH_RISK = ['URGENCY', 'SECRECY', 'AUTHORITY', 'STORY_CHANGE', 'COACHING', 'REMOTE_CONTROL']
export const LOW_RISK = ['VERIFIED_INDEPENDENTLY', 'ROUTINE_PAYEE']
export const CUE_LABEL: Record<string, string> = {
  URGENCY: 'Urgency', SECRECY: 'Secrecy', AUTHORITY: 'Authority', STORY_CHANGE: 'Story change',
  COACHING: 'Coaching', REMOTE_CONTROL: 'Remote control', VERIFIED_INDEPENDENTLY: 'Verified independently',
  ROUTINE_PAYEE: 'Routine payee', AMOUNT_STATED: 'Amount stated',
}

export interface CueSpan {
  s: number
  e: number
  cue: string
}

/** First non-overlapping, case-insensitive hit of each cue quote, in text order. */
export function cueSpans(text: string, cues: Cue[] | undefined): CueSpan[] {
  if (!text || !cues?.length) return []
  const lower = text.toLowerCase()
  const spans: CueSpan[] = []
  for (const c of cues) {
    const q = (c.quote || '').trim().toLowerCase()
    if (q.length < 3) continue
    let from = 0
    while (from < lower.length) {
      const i = lower.indexOf(q, from)
      if (i < 0) break
      const e = i + q.length
      if (!spans.some((sp) => i < sp.e && e > sp.s)) {
        spans.push({ s: i, e, cue: c.cue })
        break
      }
      from = i + 1
    }
  }
  return spans.sort((a, b) => a.s - b.s)
}

export function cueLabel(cue: string): string {
  return CUE_LABEL[cue] || cue.replace(/_/g, ' ').toLowerCase()
}
