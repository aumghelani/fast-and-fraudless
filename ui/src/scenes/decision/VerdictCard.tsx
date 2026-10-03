// The verdict card: one per call. A verdict change crossfades the title and colour in place.
import { useRef, useState } from 'react'
import { api } from '../../lib/api'
import { DASH, usd } from '../../lib/format'
import type { Call } from '../../lib/types'
import type { Verdict } from '../../flow/derive'
import { Button, Eyebrow } from '../../ui/primitives'
import { VERDICT } from '../../ui/tokens'

const ORDER: Verdict[] = ['HOLD', 'VERIFY', 'NO_HOLD']

function hhmm(ms: number) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function VerdictCard({ call, v }: { call: Call; v: Verdict }) {
  const color = VERDICT[v].color
  const [pending, setPending] = useState<'hold' | 'release' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const decidedAt = useRef<number | null>(null)
  const bd = call.banker_decision
  if (bd && decidedAt.current == null) decidedAt.current = Date.now()

  const decide = async (d: 'hold' | 'release') => {
    setPending(d)
    setErr(null)
    try {
      await api.callDecision(call.call_id, d)
    } catch {
      setErr('The decision did not reach the box · try again')
    } finally {
      setPending(null)
    }
  }

  const reasons = [...(call.reasons || [])]
    .map((r, i) => ({ r, i, ring: /ring/i.test(r) }))
    .sort((a, b) => Number(b.ring) - Number(a.ring) || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.r)

  const holdFirst = v !== 'NO_HOLD'

  return (
    <div
      className="relative flex h-full min-h-0 flex-col gap-6 overflow-hidden rounded-xl bg-surface p-8 pl-10"
      style={{
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        boxShadow: '0 24px 48px -24px rgba(0,0,0,.6)',
        transition: 'border-color 350ms ease-out',
      }}
    >
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: color, transition: 'background-color 350ms ease-out' }} />
      <div className="grid">
        {ORDER.map((x) => (
          <h2
            key={x}
            aria-hidden={x !== v}
            className="text-hero font-bold [grid-area:1/1]"
            style={{ color: VERDICT[x].color, opacity: x === v ? 1 : 0, transition: 'opacity 350ms ease-out' }}
          >
            {VERDICT[x].title}
          </h2>
        ))}
      </div>
      <div>
        <div className="tnum text-title font-bold">
          {usd(call.amount)} → <span className="font-mono font-semibold">{call.payee_account ?? DASH}</span>
        </div>
        <div className="mt-1 text-meta text-mute">Rules decide, not the model</div>
      </div>
      <div className="min-h-0 flex-1">
        <Eyebrow className="mb-3">Why</Eyebrow>
        <ul className="flex flex-col gap-3">
          {reasons.map((r) => (
            <li key={r} className="flex gap-3 text-lead text-ink">
              <span className="mt-[0.7em] size-1.5 shrink-0 rounded-full" style={{ background: color }} />
              <span className="line-clamp-2">{r}</span>
            </li>
          ))}
          {!reasons.length && <li className="text-lead text-mute">{DASH}</li>}
        </ul>
      </div>
      <div className="grid">
        <div
          className="flex flex-wrap items-center gap-4 [grid-area:1/1]"
          style={{ opacity: bd ? 0 : 1, pointerEvents: bd ? 'none' : 'auto', transition: 'opacity 350ms ease-out' }}
        >
          {holdFirst ? (
            <>
              <Button variant="hold" size="lg" disabled={!!pending || !!bd} onClick={() => decide('hold')}>
                {pending === 'hold' ? 'Holding…' : 'Hold wire'}
              </Button>
              <Button variant="ghost" size="lg" disabled={!!pending || !!bd} onClick={() => decide('release')}>
                {pending === 'release' ? 'Releasing…' : 'Release'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" disabled={!!pending || !!bd} onClick={() => decide('release')}>
                {pending === 'release' ? 'Releasing…' : 'Release wire'}
              </Button>
              <Button variant="ghost" size="lg" disabled={!!pending || !!bd} onClick={() => decide('hold')}>
                {pending === 'hold' ? 'Holding…' : 'Hold'}
              </Button>
            </>
          )}
          <span className="text-meta text-mute">{err || 'The banker decides. Nothing is sent automatically.'}</span>
        </div>
        <div
          className="flex items-center text-lead font-semibold [grid-area:1/1]"
          style={{ color, opacity: bd ? 1 : 0, transition: 'opacity 350ms ease-out' }}
          aria-hidden={!bd}
        >
          {bd === 'hold' ? 'Held' : 'Released'} by the banker at {decidedAt.current ? hhmm(decidedAt.current) : DASH}
        </div>
      </div>
    </div>
  )
}
