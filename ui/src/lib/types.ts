// Shapes from README.md (the contract) plus the extra fields the backend actually emits
// (backend/calls.py, worker_feed.py, agent_api.py). Every field is optional on purpose:
// the UI shows "—" for anything that has not arrived yet.

export interface Tick {
  tx_total?: number
  tx_per_sec?: number
  replay_time?: string
  cycle_s?: number
}

export interface Edge {
  src: string
  dst: string
  amount?: number
  currency?: string
  usd?: number
  ts?: string
  txn_id?: string
}

export interface Ring {
  ring_id: string
  type?: string
  hub?: string
  accounts?: string[]
  edges?: Edge[]
  total_usd?: number
  n_txns?: number
  tier?: string
  span_h?: number
  amt_med_usd?: number
  found_at?: string
  sim_time?: string
  status?: string
}

export type CaseStatus = 'woke' | 'investigating' | 'sar_drafted' | 'approved' | 'rejected' | 'error'

export interface Case {
  ring_id: string
  status?: CaseStatus | string
  timeline?: { ts: number | string; msg: string }[]
}

export interface Citation {
  txn_id?: string | null
  amount?: number | null
  valid: boolean
  reason?: string
}

export interface Sar {
  sar_id: string
  ring_id: string
  narrative?: string
  citations?: Citation[]
  valid_all?: boolean
  decision?: null | 'approved' | 'rejected'
}

export interface Cue {
  cue: string
  quote?: string
  reader?: 'llm' | 'keywords' | string
}

export interface PayeeCheck {
  in_ring?: boolean
  ring_id?: string | null
  hops?: number | null
  path?: string[]
  payee_account?: string
  ring_type?: string
  ring_tier?: string
  error?: string
}

export interface CallWindow {
  i: number
  t0_s?: number
  t1_s?: number
  text: string
  asr_latency_s?: number | null
  fallback?: boolean
}

export interface Call {
  call_id: string
  label?: string
  scenario?: string | null
  synthetic?: boolean
  customer?: {
    name?: string
    age?: number | null
    tenure_years?: number | null
    prior_wires?: number | null
    typical_monthly_outflow_usd?: number | null
  }
  customer_account?: string
  payee_account?: string
  amount?: number | null
  source?: 'mic' | 'replay' | string
  clip?: string | null
  asr?: string
  asr_error?: string | null
  transcript?: string
  transcript_final?: string
  partial?: string
  windows?: CallWindow[]
  audio_s?: number
  cues?: Cue[]
  cue_source?: string | null
  payee_check?: PayeeCheck
  recommendation?: 'HOLD' | 'VERIFY' | 'NO_HOLD' | null
  reasons?: string[]
  questions?: string[]
  features?: {
    first_wire?: boolean
    amount_ratio?: number | null
    high_risk_cues?: string[]
    payee_in_ring?: boolean
  }
  banker_decision?: null | 'hold' | 'release'
  ended?: boolean
  started_at?: string
}

export interface Egress {
  ts?: string
  verdict?: 'ALLOWED' | 'DENIED' | string
  process?: string | null
  dest?: string | null
  policy?: string | null
  reason?: string | null
}

export interface Counters {
  customer_data_out?: number
  alerts_sent?: number
  denied_total?: number
}

export interface Telemetry {
  gpu_util?: number | null
  temp_c?: number | null
  power_w?: number | null
  mem_used_gb?: number | null
  mem_total_gb?: number | null
}

export interface Bench {
  rows?: number
  cpu_s?: number
  gpu_s?: number
  [k: string]: unknown
}

export interface EvalData {
  // eval_rings
  rings_recovered?: number
  rings_total?: number
  rings_total_all?: number
  by_type?: Record<string, [number, number]>
  flagged_precision?: number
  flagged_precision_all?: number
  rings_found?: number
  rings_escalated?: number
  rings_recovered_escalated?: number
  sim_time?: string
  // eval_calls
  scam_caught?: number
  scam_total?: number
  false_holds?: number
  normal_total?: number
  verify_flags?: number
  label?: string
  per_call?: unknown[]
  [k: string]: unknown
}

export interface Net {
  online?: boolean
}

export interface Health {
  uptime_s?: number
  restored?: boolean
}

export interface SseMessage {
  type: string
  ts: number
  data: any
}
