// Pure: live call objects (+ screened payments) -> DecisionPipeline props. No store, no clock.
import type { Call, Integration } from '../../lib/types'
import { usd } from '../../lib/format'
import type { Verdict } from '../../ui/tokens'
import {
  HIGH_RISK_CUES, TRUST_CUES, type HighRiskCue, type PipelineCase, type PipelineCheck, type PipelineData,
  type QueueItem, type QueueStatus, type TrustCue,
} from './types'

const RATIO_FLAG = 5 // same threshold as backend/rules.py RATIO_HOLD
const MAX_QUEUE = 3

const CUE_LABEL: Record<HighRiskCue | TrustCue, string> = {
  URGENCY: 'Pressure to send now',
  SECRECY: 'Told to keep it secret',
  AUTHORITY: 'Claims authority',
  STORY_CHANGE: 'Story changed',
  COACHING: 'Third party steering',
  REMOTE_CONTROL: 'Remote access',
  VERIFIED_INDEPENDENTLY: 'Verified on a known number',
  ROUTINE_PAYEE: 'Routine payee',
}

/** Risk index from the decision and the rule hits only (rules decide; this just places the knob). */
export function riskIndex(verdict: Verdict | null, hits: number): number | null {
  const h = Math.max(0, hits) * 6
  if (verdict === 'HOLD') return 70 + Math.min(29, h)
  if (verdict === 'VERIFY') return 40 + Math.min(29, h)
  if (verdict === 'NO_HOLD') return Math.min(39, h)
  return null
}

export function verdictOfCall(c?: Call): Verdict | null {
  const r = c?.recommendation
  return r === 'HOLD' || r === 'VERIFY' || r === 'NO_HOLD' ? r : null
}

function clip(s: string, n: number) {
  const t = s.trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

export function shortAcct(a?: string | null): string {
  if (!a) return '—'
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a
}

function customerName(c: Call): string {
  const n = (c.customer?.name || '').replace(/\s*\(fictional\)\s*$/i, '').trim()
  return n || 'Customer'
}

export function callTitle(c: Call): string {
  return `Wire${c.amount != null ? ' ' + usd(c.amount) : ''} · ${customerName(c)}`
}

function isHigh(x: string): x is HighRiskCue {
  return (HIGH_RISK_CUES as readonly string[]).includes(x)
}

function isTrust(x: string): x is TrustCue {
  return (TRUST_CUES as readonly string[]).includes(x)
}

/** The real checks behind the decision, in reveal order. */
export function checksOf(c: Call): PipelineCheck[] {
  const out: PipelineCheck[] = []
  const pc = c.payee_check
  const analysed = !!pc && Object.keys(pc).length > 0
  if (!analysed) out.push({ id: 'ring', label: 'Payee in GPU ring map', value: 'Checking…', tone: 'info' })
  else if (pc.error) out.push({ id: 'ring', label: 'Payee in GPU ring map', value: 'Map unavailable', tone: 'info' })
  else if (pc.in_ring)
    out.push({
      id: 'ring', label: 'Payee in GPU ring map', tone: 'flag',
      value: `${pc.ring_id ?? 'ring'}${pc.hops != null ? ` · ${pc.hops} hop${pc.hops === 1 ? '' : 's'}` : ''}`,
    })
  else out.push({ id: 'ring', label: 'Payee in GPU ring map', value: 'Not linked', tone: 'pass' })

  const prior = c.customer?.prior_wires
  const first = c.features?.first_wire ?? (prior != null ? prior === 0 : null)
  out.push(
    first == null
      ? { id: 'first_wire', label: 'First wire', value: '—', tone: 'info' }
      : first
        ? { id: 'first_wire', label: 'First wire', value: 'First ever', tone: 'flag' }
        : { id: 'first_wire', label: 'First wire', value: prior != null ? `${prior} before` : 'No', tone: 'pass' },
  )

  const typical = c.customer?.typical_monthly_outflow_usd
  const ratio = c.features?.amount_ratio ?? (c.amount != null && typical ? c.amount / typical : null)
  out.push(
    ratio == null || !Number.isFinite(ratio)
      ? { id: 'ratio', label: 'Amount vs usual', value: '—', tone: 'info' }
      : { id: 'ratio', label: 'Amount vs usual', value: `${ratio.toFixed(1)}×`, tone: ratio >= RATIO_FLAG ? 'flag' : 'pass' },
  )

  // distinct cues, first quote wins (as the rules do)
  const quotes = new Map<string, string>()
  for (const q of c.cues ?? []) {
    const k = String(q?.cue || '').toUpperCase()
    if (k && !quotes.has(k)) quotes.set(k, q.quote || '')
  }
  for (const k of c.features?.high_risk_cues ?? []) if (!quotes.has(k)) quotes.set(k, '')
  for (const [k, q] of quotes) {
    if (isHigh(k)) out.push({ id: `cue:${k}`, label: CUE_LABEL[k], value: 'Heard', quote: q ? clip(q, 56) : undefined, tone: 'flag' })
  }
  for (const [k, q] of quotes) {
    if (isTrust(k)) out.push({ id: `cue:${k}`, label: CUE_LABEL[k], value: 'Lowers risk', quote: q ? clip(q, 56) : undefined, tone: 'mitigate' })
  }
  return out
}

export function caseOf(c: Call): PipelineCase {
  const checks = checksOf(c)
  const verdict = verdictOfCall(c)
  const flagged = checks.filter((x) => x.tone === 'flag' || x.tone === 'warn').length
  return {
    id: c.call_id, title: callTitle(c), verdict, checks, flagged, risk: riskIndex(verdict, flagged),
    reason: c.reasons?.[0] ?? null, ended: !!c.ended,
  }
}

function callStatus(c: Call): QueueStatus {
  return verdictOfCall(c) ?? (c.ended ? 'unscreened' : 'processing')
}

function callItem(c: Call): QueueItem {
  const src = c.source === 'replay' ? ' · Replay' : c.source === 'mic' ? ' · Live' : ''
  return { id: c.call_id, kind: 'call', title: callTitle(c), sub: `to ${shortAcct(c.payee_account)}${src}`, status: callStatus(c) }
}

function paymentItem(p: Integration, i: number): QueueItem | null {
  const kind = String(p.kind || '')
  if (!/pacs|pain/i.test(kind)) return null // batch ingests are not payments
  const r = p.result || {}
  const status: QueueStatus = r.hold_recommended === true ? 'HOLD' : r.hold_recommended === false ? 'NO_HOLD' : 'unscreened'
  return {
    id: `pay:${p.ref ?? i}`, kind: 'payment', title: `ISO 20022 ${kind} · ${shortAcct(String(p.ref ?? ''))}`,
    sub: r.ring_id ? `ring ${r.ring_id}` : String(r.screening ?? 'Screened'), status,
  }
}

function newestFirst(calls: Record<string, Call>): Call[] {
  return Object.values(calls).sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
}

/** Active = calls[activeId] if given, else the newest call. Queue = active, newer-first calls, then payments. */
export function toPipeline(
  calls: Record<string, Call>,
  opts: { activeId?: string | null; integrations?: Integration[] } = {},
): PipelineData {
  const list = newestFirst(calls)
  const active = (opts.activeId && calls[opts.activeId]) || list[0]
  const queue: QueueItem[] = []
  if (active) queue.push(callItem(active))
  for (const c of list) {
    if (queue.length >= MAX_QUEUE) break
    if (c !== active) queue.push(callItem(c))
  }
  for (const [i, p] of (opts.integrations ?? []).entries()) {
    if (queue.length >= MAX_QUEUE) break
    const it = paymentItem(p, i)
    if (it) queue.push(it)
  }
  return { call: active ? caseOf(active) : null, queue }
}
