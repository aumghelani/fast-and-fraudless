// Two calm SVG views for the ring card: the live payee's path into its ring, or the newest escalated ring.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import type { Call, Ring } from '../../lib/types'
import { usePrefersReducedMotion } from '../selectors'

export const W = 412
export const H = 150
const CY = 75
const tail = (s: string, n = 5) => (s.length > n ? '…' + s.slice(-n) : s)
const MONO = { fontFamily: 'var(--font-mono)', fontSize: 10 }

/** Unique ring accounts other than `skip`, edges first so the drawn members are the connected ones. */
function membersOf(ring: Ring | undefined, skip: string[], max: number): string[] {
  const seen = new Set(skip)
  const out: string[] = []
  const add = (a?: string) => {
    if (a && !seen.has(a) && out.length < max) {
      seen.add(a)
      out.push(a)
    }
  }
  for (const e of ring?.edges || []) {
    add(e.src)
    add(e.dst)
  }
  for (const a of ring?.accounts || []) add(a)
  return out
}

/** customer → payee → ring hub, members fanned out to the right of the hub. */
export function PayeeGraph({ call, ring, color }: { call: Call; ring?: Ring; color: string }) {
  const still = usePrefersReducedMotion()
  const pc = call.payee_check
  const m = useMemo(() => {
    const cust = call.customer_account || 'customer'
    const payee = call.payee_account || pc?.payee_account || 'payee'
    const path = pc?.path?.length ? pc.path : [cust, payee]
    const hub = pc?.hops === 1 ? payee : path[path.length - 1] || payee
    return { cust, payee, hub, members: membersOf(ring, [cust, payee, hub], 7) }
  }, [call.customer_account, call.payee_account, pc, ring])

  const hubIsPayee = m.hub === m.payee
  const X = { cust: 22, payee: 150, hub: hubIsPayee ? 150 : 268 }
  const n = m.members.length
  const pts = m.members.map((id, i) => {
    const a = ((n === 1 ? 0 : -78 + (156 * i) / (n - 1)) * Math.PI) / 180
    return { id, x: X.hub + Math.cos(a) * 60, y: CY + Math.sin(a) * 60 }
  })
  const live = !call.ended && !still
  const fade = (i: number) =>
    still ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.35, delay: 0.05 * i, ease: 'easeOut' as const } }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Payee path into the ring">
      {/* the wire: customer to payee, dotted like the pipeline connectors */}
      <line x1={X.cust} y1={CY} x2={X.payee} y2={CY} stroke="var(--color-line-2)" strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" />
      {!hubIsPayee && <line x1={X.payee} y1={CY} x2={X.hub} y2={CY} stroke={color} strokeWidth={1.5} />}
      {live && (
        <motion.circle
          r={3}
          cy={CY}
          fill={color}
          initial={{ cx: X.cust }}
          animate={{ cx: X.hub }}
          transition={{ duration: 2.2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.8 }}
        />
      )}
      {pts.map((p, i) => (
        <motion.g key={p.id} {...fade(i)}>
          <line x1={X.hub} y1={CY} x2={p.x} y2={p.y} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
          <circle cx={p.x} cy={p.y} r={3.5} fill="var(--color-surface)" stroke={color} strokeWidth={1.25} />
          <text x={p.x + 8} y={p.y + 3.5} style={{ ...MONO, fill: 'var(--color-mute)' }}>{tail(p.id)}</text>
        </motion.g>
      ))}
      <circle cx={X.cust} cy={CY} r={5} fill="var(--color-surface)" stroke="var(--color-ink-2)" strokeWidth={1.5} />
      <text x={X.cust - 4} y={CY - 13} style={{ ...MONO, fill: 'var(--color-mute)' }}>customer</text>
      {!hubIsPayee && (
        <g>
          <circle cx={X.payee} cy={CY} r={5.5} fill="var(--color-ink)" />
          <text x={X.payee} y={CY - 13} textAnchor="middle" style={{ ...MONO, fill: 'var(--color-mute)' }}>payee</text>
          <text x={X.payee} y={CY + 22} textAnchor="middle" style={{ ...MONO, fill: 'var(--color-ink-2)' }}>{tail(m.payee, 6)}</text>
        </g>
      )}
      <circle cx={X.hub} cy={CY} r={9} fill={color} />
      <text x={X.hub} y={CY - 16} textAnchor="middle" style={{ ...MONO, fill: color }}>{hubIsPayee ? 'payee · hub' : 'ring hub'}</text>
      <text x={X.hub} y={CY + 25} textAnchor="middle" style={{ ...MONO, fill: 'var(--color-ink-2)' }}>{tail(m.hub, 6)}</text>
    </svg>
  )
}

/** One ring drawn from its own edges (hub in the middle, members on an ellipse). */
export function RingShape({ ring }: { ring: Ring }) {
  const still = usePrefersReducedMotion()
  const hub = ring.hub || ring.accounts?.[0] || ''
  const members = useMemo(() => membersOf(ring, [hub], 10), [ring, hub])
  const n = members.length
  const pos = new Map<string, { x: number; y: number }>([[hub, { x: W / 2, y: CY }]])
  members.forEach((id, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1)
    pos.set(id, { x: W / 2 + Math.cos(a) * 100, y: CY + Math.sin(a) * 54 })
  })
  // real edges when present, else spokes to the hub
  const links = (ring.edges?.length ? ring.edges.map((e) => [e.src, e.dst] as const) : members.map((id) => [id, hub] as const))
    .filter(([a, b]) => pos.has(a) && pos.has(b) && a !== b)
  const uniq = Array.from(new Map(links.map(([a, b]) => [[a, b].sort().join('|'), [a, b] as const])).values())
  const color = 'var(--color-accent)'

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={`Ring ${ring.ring_id}`}>
      <motion.g key={ring.ring_id} {...(still ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.4, ease: 'easeOut' as const } })}>
        {uniq.map(([a, b]) => {
          const p = pos.get(a)!
          const q = pos.get(b)!
          return <line key={a + b} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeOpacity={0.35} strokeWidth={1} />
        })}
        {members.map((id) => {
          const p = pos.get(id)!
          const right = p.x >= W / 2
          return (
            <g key={id}>
              <circle cx={p.x} cy={p.y} r={3.5} fill="var(--color-surface)" stroke={color} strokeWidth={1.25} />
              <text x={p.x + (right ? 8 : -8)} y={p.y + 3.5} textAnchor={right ? 'start' : 'end'} style={{ ...MONO, fill: 'var(--color-mute)' }}>
                {tail(id)}
              </text>
            </g>
          )
        })}
        <circle cx={W / 2} cy={CY} r={9} fill={color} />
      </motion.g>
    </svg>
  )
}
