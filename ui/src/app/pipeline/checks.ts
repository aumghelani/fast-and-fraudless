// Pure mapping: a live call -> the checks, status and risk index the hero shows.
import type { Call } from '../../lib/types'
import { usd } from '../../lib/format'
import { heardOf, verdictOf, type Verdict } from '../selectors'

export type CheckTone = 'flag' | 'pass' | 'info'
export interface Check { id: string; label: string; value: string; quote?: string; tone: CheckTone }

const RATIO_FLAG = 5 // same threshold as the backend rules
const HIGH = ['URGENCY', 'SECRECY', 'AUTHORITY', 'STORY_CHANGE', 'COACHING', 'REMOTE_CONTROL'] as const
const TRUST = ['VERIFIED_INDEPENDENTLY', 'ROUTINE_PAYEE'] as const
const CUE_LABEL: Record<string, string> = {
  URGENCY: 'Pressure to send now',
  SECRECY: 'Told to keep it secret',
  AUTHORITY: 'Claims authority',
  STORY_CHANGE: 'Story changed',
  COACHING: 'Third party steering',
  REMOTE_CONTROL: 'Remote access',
  VERIFIED_INDEPENDENTLY: 'Verified on a known number',
  ROUTINE_PAYEE: 'Routine payee',
}

const clip = (s: string, n: number) => {
  const t = s.trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

export function customerName(c: Call): string {
  return (c.customer?.name || '').replace(/\s*\(fictional\)\s*$/i, '').trim() || 'Customer'
}

export const wireTitle = (c: Call) => `Wire · ${c.amount != null ? usd(c.amount) : '—'}`

/** Real checks behind the decision, in reveal order. */
export function checksOf(c: Call): Check[] {
  const out: Check[] = []
  // nothing is checked on screen before the customer has spoken
  if (!heardOf(c)) return out
  // account checks (payee ring, first wire, amount) appear once the rules have run on heard words;
  // before that the payee check is only an empty default
  if (c.recommendation || c.ended) accountChecks(c, out)
  cueChecks(c, out)
  return out
}

function accountChecks(c: Call, out: Check[]) {
  const pc = c.payee_check
  const label = 'Payee in GPU ring map'
  if (!pc || Object.keys(pc).length === 0) out.push({ id: 'ring', label, value: 'Checking…', tone: 'info' })
  else if (pc.error) out.push({ id: 'ring', label, value: 'Map unavailable', tone: 'info' })
  else if (pc.in_ring)
    out.push({
      id: 'ring', label, tone: 'flag',
      value: `${pc.ring_id ?? 'ring'}${pc.hops != null ? ` · ${pc.hops} hop${pc.hops === 1 ? '' : 's'}` : ''}`,
    })
  else out.push({ id: 'ring', label, value: 'Not linked', tone: 'pass' })

  const prior = c.customer?.prior_wires
  const first = c.features?.first_wire ?? (prior != null ? prior === 0 : null)
  out.push(
    first == null
      ? { id: 'first', label: 'First wire', value: '—', tone: 'info' }
      : first
        ? { id: 'first', label: 'First wire', value: 'First ever', tone: 'flag' }
        : { id: 'first', label: 'First wire', value: prior != null ? `${prior} before` : 'No', tone: 'pass' },
  )

  const typical = c.customer?.typical_monthly_outflow_usd
  const ratio = c.features?.amount_ratio ?? (c.amount != null && typical ? c.amount / typical : null)
  out.push(
    ratio == null || !Number.isFinite(ratio)
      ? { id: 'ratio', label: 'Amount vs usual', value: '—', tone: 'info' }
      : { id: 'ratio', label: 'Amount vs usual', value: `${ratio.toFixed(1)}×`, tone: ratio >= RATIO_FLAG ? 'flag' : 'pass' },
  )
}

function cueChecks(c: Call, out: Check[]) {
  // distinct cues, first quote wins (as the rules do)
  const quotes = new Map<string, string>()
  for (const q of c.cues ?? []) {
    const k = String(q?.cue || '').toUpperCase()
    if (k && !quotes.has(k)) quotes.set(k, q.quote || '')
  }
  for (const k of c.features?.high_risk_cues ?? []) if (!quotes.has(k)) quotes.set(k, '')
  for (const [k, q] of quotes)
    if ((HIGH as readonly string[]).includes(k))
      out.push({ id: `cue:${k}`, label: CUE_LABEL[k], value: 'Heard', quote: q ? clip(q, 44) : undefined, tone: 'flag' })
  for (const [k, q] of quotes)
    if ((TRUST as readonly string[]).includes(k))
      out.push({ id: `cue:${k}`, label: CUE_LABEL[k], value: 'Lowers risk', quote: q ? clip(q, 44) : undefined, tone: 'pass' })
}

/** Risk index from the decision and the rule hits only (rules decide; this just places the knob). */
export function riskIndex(v: Verdict | null, flagged: number): number | null {
  const h = Math.max(0, flagged) * 6
  if (v === 'HOLD') return 70 + Math.min(29, h)
  if (v === 'VERIFY') return 40 + Math.min(29, h)
  if (v === 'NO_HOLD') return Math.min(39, h)
  return null
}

export type QueueStatus = Verdict | 'processing' | 'unscreened'

export function statusOf(c: Call): QueueStatus {
  return verdictOf(c) ?? (c.ended ? 'unscreened' : 'processing')
}

export const STATUS_TEXT: Record<QueueStatus, string> = {
  processing: 'Processing…',
  HOLD: 'Hold advised',
  VERIFY: 'Verify with customer',
  NO_HOLD: 'Cleared',
  unscreened: 'Not screened',
}
