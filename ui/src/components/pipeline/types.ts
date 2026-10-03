// Props for the decision pipeline. Built by adapter.ts from the live call objects; never hand-filled in scenes.
import type { Verdict } from '../../ui/tokens'

export type { Verdict }

/** How one check reads: a risk signal (flag), a large-wire signal (warn), passed, lowers risk, or neutral. */
export type CheckTone = 'flag' | 'warn' | 'pass' | 'mitigate' | 'info'

export type CheckId =
  | 'ring'
  | 'first_wire'
  | 'ratio'
  | 'large'
  | `cue:${HighRiskCue}`
  | `cue:${TrustCue}`

export const HIGH_RISK_CUES = ['URGENCY', 'SECRECY', 'AUTHORITY', 'STORY_CHANGE', 'COACHING', 'REMOTE_CONTROL'] as const
export const TRUST_CUES = ['VERIFIED_INDEPENDENTLY', 'ROUTINE_PAYEE'] as const
export type HighRiskCue = (typeof HIGH_RISK_CUES)[number]
export type TrustCue = (typeof TRUST_CUES)[number]

export interface PipelineCheck {
  id: CheckId
  label: string // "Payee in GPU ring map"
  value: string // "R-5338 · 2 hops", "15.4×", "First ever"
  quote?: string // the customer's words, for cues
  tone: CheckTone
}

/** A queue card's status line. 'processing' until the rules have spoken. */
export type QueueStatus = 'processing' | Verdict | 'unscreened'

export interface QueueItem {
  id: string
  kind: 'call' | 'payment'
  title: string // "Wire $40,000 · Margaret Doyle"
  sub: string // "to 802225A40 · Replay"
  status: QueueStatus
}

/** The active wire, ready to draw. */
export interface PipelineCase {
  id: string
  title: string
  verdict: Verdict | null // null while the call is still being read
  checks: PipelineCheck[]
  flagged: number // checks that are flag or warn
  risk: number | null // risk index 0-99, derived only from verdict + flagged
  reason: string | null // first reason line from the rules
  ended: boolean
}

export interface PipelineData {
  call: PipelineCase | null
  queue: QueueItem[] // active first, at most 3
}

export interface DecisionPipelineProps extends PipelineData {
  /** Denser layout for a small slot: no quotes, smaller cards and numbers. */
  compact?: boolean
  className?: string
}
