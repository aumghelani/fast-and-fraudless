// Dev-only demo fixtures: window.__ffDemo(name) plays timed fake events through __ffInject.
// Names: margaret, david, sar, denied, offline, online, restored, healed. Nothing here reaches the backend.
import { getState, patchLocal } from '../lib/store'
import type { Call, Cue, SseMessage } from '../lib/types'

type PerCall = { call?: string; transcript?: string; cue_quotes?: Cue[]; reasons?: string[]; audio_s?: number }

const send = (type: string, data: unknown) =>
  (window as any).__ffInject?.({ type, ts: Date.now() / 1000, data } satisfies SseMessage)

let timers: number[] = []
let seq = 0
let offlineTimer: number | undefined

function clearTimers() {
  for (const t of timers) window.clearTimeout(t)
  timers = []
}

function at(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms))
}

function perCall(name: string): PerCall | undefined {
  const list = getState().eval?.per_call
  return Array.isArray(list) ? (list as PerCall[]).find((x) => x?.call === name) : undefined
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean)
}

/** Split a transcript into n growing steps. */
function steps(text: string, n: number): string[] {
  const s = sentences(text)
  const size = Math.ceil(s.length / n)
  const out: string[] = []
  for (let i = 1; i <= n; i++) out.push(s.slice(0, Math.min(s.length, i * size)).join(' '))
  return out
}

const MARGARET_TEXT =
  'Hello. This is Margaret Doyle. I have banked with you for 31 years. I need to send a wire today. ' +
  'Forty thousand dollars. It is for my grandson. He has been arrested, and the lawyer says. ' +
  'The bail has to be paid today or he stays in jail. It is for a renovation. A home renovation. ' +
  'The lawyer said not to tell anyone in the family. He is embarrassed. Can you do it right now? Please, it is urgent.'

const MARGARET_CUES: Cue[] = [
  { cue: 'URGENCY', quote: 'The bail has to be paid today or he stays in jail', reader: 'llm' },
  { cue: 'SECRECY', quote: 'He is embarrassed', reader: 'llm' },
  { cue: 'STORY_CHANGE', quote: 'It is for a renovation', reader: 'llm' },
  { cue: 'AUTHORITY', quote: 'He has been arrested, and the lawyer says', reader: 'keywords' },
  { cue: 'AMOUNT_STATED', quote: 'Forty thousand dollars', reader: 'keywords' },
]

const MARGARET_REASONS = [
  'Payee 802225A40 feeds ring R-5338 found by the GPU ring finder',
  '5 high-risk cues: URGENCY, SECRECY, STORY_CHANGE, COACHING, AUTHORITY',
  'First-ever wire at 15.4x typical monthly outflow, with a high-risk cue',
  'First wire in 31 years',
  'Amount $40,000 is 15.4x typical monthly outflow ($2,600)',
]

const DAVID_TEXT = 'Hi, it is David Akifer. I would like to send my monthly rent. $2,100 to Harbor View Rentals. Same as every month.'

/** Play a call: the first patch goes out at once, then each step at its time. */
function playCall(base: Partial<Call>, timeline: [number, Partial<Call>][]) {
  clearTimers()
  const id = `DEMO-${++seq}`
  let call: Call = { ...base, call_id: id, started_at: new Date().toISOString() }
  patchLocal({ activeCallId: id })
  send('call', call)
  for (const [ms, patch] of timeline) {
    at(ms, () => {
      call = { ...call, ...patch }
      send('call', call)
    })
  }
  return id
}

function margaret() {
  const pc = perCall('CALL-01')
  const text = pc?.transcript || MARGARET_TEXT
  const quotes = (pc?.cue_quotes?.length ? pc.cue_quotes : MARGARET_CUES).filter((q) =>
    ['URGENCY', 'SECRECY', 'AUTHORITY', 'STORY_CHANGE', 'AMOUNT_STATED'].includes(q.cue),
  )
  const reasons = pc?.reasons?.length ? pc.reasons : MARGARET_REASONS
  const audio = pc?.audio_s ?? 57.6
  const parts = steps(text, 4)
  const cuesFor = (said: string) => quotes.filter((q) => !q.quote || said.includes(q.quote))
  const win = (i: number) => ({
    i, t0_s: (audio / 4) * i, t1_s: (audio / 4) * (i + 1), text: parts[i].slice(i ? parts[i - 1].length : 0).trim(),
    asr_latency_s: 0.31, fallback: false,
  })
  const questions = [
    'Can you call your grandson back on a number you already have?',
    'Has anyone asked you to keep this payment a secret?',
    'Who gave you the account details for this payee?',
  ]
  playCall(
    {
      label: 'CALL-01', scenario: 'CALL-01', synthetic: true, source: 'replay', clip: 'CALL-01_scam_grandparent.wav',
      asr: 'parakeet-http', cue_source: 'llm+keywords', amount: 40000, customer_account: '7001A2B30',
      payee_account: '802225A40',
      customer: { name: 'Margaret Doyle', age: 78, tenure_years: 31, prior_wires: 0, typical_monthly_outflow_usd: 2600 },
      transcript: '', partial: 'Hello', windows: [], audio_s: 0, cues: [], recommendation: null, reasons: [],
      questions: [], ended: false,
      features: { first_wire: true, amount_ratio: 15.4, high_risk_cues: [], payee_in_ring: false },
    },
    [
      [3000, { transcript: parts[0], partial: 'Forty thousand', windows: [win(0)], audio_s: audio / 4, cues: cuesFor(parts[0]) }],
      [6000, {
        payee_check: {
          in_ring: true, ring_id: 'R-5338', hops: 2, path: ['802225A40', '80251D930', '8041F18B0'],
          payee_account: '802225A40', ring_type: 'FAN-IN', ring_tier: 'escalated',
        },
        features: { first_wire: true, amount_ratio: 15.4, high_risk_cues: [], payee_in_ring: true },
      }],
      [9000, {
        transcript: parts[1], partial: 'The bail', windows: [win(0), win(1)], audio_s: (audio / 4) * 2, cues: cuesFor(parts[1]),
        recommendation: 'VERIFY', reasons: reasons.slice(0, 3), questions,
      }],
      [15000, {
        transcript: parts[2], partial: 'The lawyer', windows: [win(0), win(1), win(2)], audio_s: (audio / 4) * 3,
        cues: cuesFor(parts[2]), recommendation: 'HOLD', reasons,
        features: { first_wire: true, amount_ratio: 15.4, high_risk_cues: ['URGENCY', 'AUTHORITY', 'STORY_CHANGE'], payee_in_ring: true },
      }],
      [20000, {
        transcript: parts[3], partial: '', windows: [win(0), win(1), win(2), win(3)], audio_s: audio, cues: cuesFor(parts[3]),
        features: { first_wire: true, amount_ratio: 15.4, high_risk_cues: ['URGENCY', 'SECRECY', 'AUTHORITY', 'STORY_CHANGE'], payee_in_ring: true },
      }],
      [25000, { ended: true, transcript_final: parts[3] }],
    ],
  )
}

function david() {
  const pc = perCall('CALL-02')
  const text = pc?.transcript || DAVID_TEXT
  const parts = steps(text, 2)
  const audio = pc?.audio_s ?? 21.3
  const reasons = pc?.reasons?.length
    ? pc.reasons
    : ['Customer describes a routine, repeat payee: “Same as every month”', 'Not enough risk to advise a hold']
  playCall(
    {
      label: 'CALL-02', scenario: 'CALL-02', synthetic: true, source: 'replay', clip: 'CALL-02_normal_rent.wav',
      asr: 'parakeet-http', cue_source: 'llm+keywords', amount: 2100, customer_account: '7002C4D10',
      payee_account: '80A61C2F0',
      customer: { name: 'David Akifer', age: 41, tenure_years: 6, prior_wires: 24, typical_monthly_outflow_usd: 4200 },
      transcript: '', partial: 'Hi', windows: [], audio_s: 0, cues: [], recommendation: null, reasons: [], questions: [],
      ended: false, features: { first_wire: false, amount_ratio: 0.5, high_risk_cues: [], payee_in_ring: false },
    },
    [
      [3000, { transcript: parts[0], partial: 'Same as', audio_s: audio / 2 }],
      [5000, { payee_check: { in_ring: false, ring_id: null, hops: null, path: [], payee_account: '80A61C2F0' } }],
      [8000, {
        transcript: parts[1], partial: '', audio_s: audio, recommendation: 'NO_HOLD', reasons,
        cues: [
          { cue: 'ROUTINE_PAYEE', quote: 'Same as every month', reader: 'llm' },
          { cue: 'AMOUNT_STATED', quote: '$2,100', reader: 'llm' },
        ],
        questions: ['Is Harbor View Rentals the landlord you pay every month?'],
      }],
      [12000, { ended: true, transcript_final: parts[1] }],
    ],
  )
}

function sar() {
  const now = Date.now()
  const ring = 'R-24301'
  const txns = Array.from({ length: 10 }, (_, i) => ({
    txn_id: `T2580${5643 + i * 7}`,
    amount: Math.round((9400 + ((i * 337) % 600) + i * 13.37) * 100) / 100,
  }))
  const lines = txns.map((t) => `${t.txn_id} · ${t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
  send('case', {
    ring_id: ring, status: 'sar_drafted',
    timeline: [
      { ts: now - 92000, msg: 'woke via new ring (queued 2 s)' },
      { ts: now - 90000, msg: 'agent reading case file (inline)' },
      { ts: now - 61000, msg: 'agent fetched case evidence (10 transactions)' },
      { ts: now - 4000, msg: 'SAR draft received (rev 1): 10/10 citations verified' },
    ],
  })
  send('sar', {
    sar_id: `SAR-${ring}`, ring_id: ring, valid_all: true, decision: null,
    citations: txns.map((t) => ({ ...t, valid: true, reason: 'matches the ledger' })),
    narrative: [
      `Ring ${ring} (fan-in, escalated) moved funds from 10 accounts into hub 8041F18B0 within 36 hours.`,
      `Each transfer sits just under the 10,000 reporting threshold, a structuring pattern. Transfer ${txns[0].txn_id} was the first.`,
      'Supporting transactions:',
      ...lines,
      'The hub forwarded most of the balance out within a day of receipt. We recommend filing.',
    ].join('\n'),
  })
}

function denied() {
  const c = getState().counters || {}
  send('egress', {
    ts: new Date().toISOString(), verdict: 'DENIED', process: 'python3', dest: 'paste.example.net:443',
    policy: 'tripwire-sandbox', reason: 'host not in allowlist', kind: 'event',
  })
  send('counters', { ...c, denied_total: (c.denied_total ?? 0) + 1 })
}

function setOnline(on: boolean) {
  window.clearInterval(offlineTimer)
  offlineTimer = undefined
  send('net', { online: on })
  // the box reports its own net state; keep the fake one until 'online'
  if (!on) offlineTimer = window.setInterval(() => send('net', { online: false }), 1000)
}

function restored() {
  send('health', { uptime_s: 3, restored: true })
}

function healed() {
  const w = getState().watchdog || {}
  send('watchdog', {
    ...w, recoveries: (w.recoveries ?? 0) + 1, ts: new Date().toISOString(),
    last_recovery: { ts: new Date().toISOString(), target: 'ring finder', action: 'restarted', reason: 'demo', ok: true },
  })
}

const DEMOS: Record<string, () => void> = {
  margaret, david, sar, denied, restored, healed,
  offline: () => setOnline(false),
  online: () => setOnline(true),
}

;(window as any).__ffDemo = (name: string) => {
  const fn = DEMOS[name]
  if (!fn) return `unknown demo; try ${Object.keys(DEMOS).join(', ')}`
  fn()
  return `playing ${name}`
}
