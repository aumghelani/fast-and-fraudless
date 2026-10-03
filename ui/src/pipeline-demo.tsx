// Dev fixture for DecisionPipeline: Margaret (HOLD), David (CLEAR), a closing wire (VERIFY), one every 6 s.
// Open /pipeline-demo.html on the dev server. ?w=1100&h=620 sizes the frame, ?compact=1 uses the compact layout.
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import '@fontsource/racing-sans-one/latin-400.css'
import '@fontsource/teko/latin-600.css'
import '@fontsource/teko/latin-700.css'
import './index.css'
import { DecisionPipeline } from './components/pipeline/DecisionPipeline'
import { toPipeline } from './components/pipeline/adapter'
import type { Call } from './lib/types'

const FIXTURES: Call[] = [
  {
    call_id: 'CALL-01', source: 'replay', amount: 40000, payee_account: '802225A40', recommendation: 'HOLD',
    customer: { name: 'Margaret Doyle (fictional)', age: 78, tenure_years: 31, prior_wires: 0, typical_monthly_outflow_usd: 2600 },
    payee_check: { in_ring: true, ring_id: 'R-5338', hops: 2, payee_account: '802225A40' },
    features: { first_wire: true, amount_ratio: 15.38, high_risk_cues: ['URGENCY', 'SECRECY', 'STORY_CHANGE', 'COACHING', 'AUTHORITY'], payee_in_ring: true },
    cues: [
      { cue: 'URGENCY', quote: 'The bail has to be paid today or he stays in jail' },
      { cue: 'SECRECY', quote: 'He is embarrassed' },
      { cue: 'STORY_CHANGE', quote: 'It is for a renovation' },
      { cue: 'COACHING', quote: 'The lawyer said not to tell anyone in the family' },
      { cue: 'AUTHORITY', quote: 'He has been arrested, and the lawyer says' },
      { cue: 'AMOUNT_STATED', quote: 'Forty thousand dollars' },
    ],
    reasons: ['Payee 802225A40 feeds ring R-5338 found by the GPU ring finder'],
  },
  {
    call_id: 'CALL-02', source: 'replay', amount: 2100, payee_account: 'TW-LAND-0001', recommendation: 'NO_HOLD',
    customer: { name: 'David Okafor (fictional)', age: 34, prior_wires: 8, typical_monthly_outflow_usd: 2100 },
    payee_check: { in_ring: false, ring_id: null, hops: null, payee_account: 'TW-LAND-0001' },
    features: { first_wire: false, amount_ratio: 1, high_risk_cues: [], payee_in_ring: false },
    cues: [{ cue: 'ROUTINE_PAYEE', quote: 'Same as every month' }, { cue: 'AMOUNT_STATED', quote: '$2,100' }],
    reasons: ['Customer describes a routine, repeat payee: “Same as every month”'],
  },
  {
    call_id: 'CALL-08', source: 'replay', amount: 85000, payee_account: 'TW-NEWPAYEE-0808', recommendation: 'VERIFY',
    customer: { name: 'Customer CALL-08 (fictional)', tenure_years: 10, prior_wires: 3, typical_monthly_outflow_usd: 3000 },
    payee_check: { in_ring: false, ring_id: null, hops: null, payee_account: 'TW-NEWPAYEE-0808' },
    features: { first_wire: false, amount_ratio: 28.33, high_risk_cues: [], payee_in_ring: false },
    cues: [
      { cue: 'ROUTINE_PAYEE', quote: 'To the title company' },
      { cue: 'VERIFIED_INDEPENDENTLY', quote: 'I confirmed the account number by calling their office number' },
    ],
    reasons: ['Large amount ($85,000) with no scam cues; customer says they verified the account. Do a callback on a known number before release'],
  },
]

/** The k-th call of the loop; the newest one is still being read while pending. */
function callAt(k: number, pending: boolean): Call {
  const f = FIXTURES[k % FIXTURES.length]
  const started_at = new Date(Date.UTC(2026, 9, 3, 19, 0, k)).toISOString()
  const base: Call = { ...f, call_id: `${f.call_id}-${k}`, started_at }
  return pending ? { ...base, recommendation: null, reasons: [], cues: [], payee_check: {}, features: undefined } : base
}

function Demo() {
  const q = new URLSearchParams(location.search)
  const w = q.get('w')
  const h = q.get('h')
  const [n, setN] = useState(1)
  const [pending, setPending] = useState(true)
  useEffect(() => {
    setPending(true)
    const a = window.setTimeout(() => setPending(false), 1200)
    const b = window.setTimeout(() => setN((x) => x + 1), 6000)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [n])
  const data = useMemo(() => {
    const calls: Record<string, Call> = {}
    for (let k = 0; k < n; k++) {
      const c = callAt(k, pending && k === n - 1)
      calls[c.call_id] = c
    }
    return toPipeline(calls)
  }, [n, pending])
  return (
    <div className="flex h-full flex-col gap-6 bg-bg p-12">
      <div className="text-meta tracking-[0.08em] text-mute uppercase">Decision pipeline · dev fixture · synthetic</div>
      <div className="min-h-0" style={{ width: w ? `${w}px` : '100%', height: h ? `${h}px` : '100%' }}>
        <DecisionPipeline call={data.call} queue={data.queue} compact={q.get('compact') === '1'} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <Demo />
  </MotionConfig>,
)
