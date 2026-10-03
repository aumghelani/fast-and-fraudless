// Deterministic payee path: customer -> payee -> ring hub, with up to 8 ring members on an arc.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useRing } from '../../flow/derive'
import type { Call } from '../../lib/types'
import { DASH } from '../../lib/format'

const MAX = 8
const Y = 180
const X = { cust: 60, payee: 330, hub: 560 }
const ARC_R = 120

const tail = (s: string) => (s.length > 8 ? s.slice(-8) : s)

export function PayeePath({ call, color }: { call: Call; color: string }) {
  const pc = call.payee_check
  const inRing = !!pc?.in_ring
  const ring = useRing(inRing ? pc?.ring_id : null)

  const model = useMemo(() => {
    const cust = call.customer_account || 'customer'
    const payee = call.payee_account || pc?.payee_account || 'payee'
    const path = pc?.path && pc.path.length ? pc.path : [cust, payee]
    const hub = inRing ? (pc?.hops === 1 ? payee : path[path.length - 1]) : null
    const members: string[] = []
    if (ring && hub) {
      const seen = new Set([cust, payee, hub])
      for (const e of ring.edges || []) {
        for (const a of [e.src, e.dst]) {
          if (a && !seen.has(a) && members.length < MAX) {
            seen.add(a)
            members.push(a)
          }
        }
      }
      if (!members.length) {
        for (const a of ring.accounts || []) {
          if (!seen.has(a) && members.length < MAX) {
            seen.add(a)
            members.push(a)
          }
        }
      }
    }
    return { cust, payee, hub, members }
  }, [call.customer_account, call.payee_account, pc, inRing, ring])

  const hubIsPayee = !!model.hub && model.hub === model.payee
  const hubX = hubIsPayee ? X.payee : X.hub
  const ringStroke = inRing ? color : 'var(--color-line-2)'
  const ringText = inRing ? color : 'var(--color-ink-2)'
  const n = model.members.length
  const pts = model.members.map((m, i) => {
    const deg = n === 1 ? 0 : -70 + (140 * i) / (n - 1)
    const a = (deg * Math.PI) / 180
    return { id: m, x: hubX + Math.cos(a) * ARC_R, y: Y + Math.sin(a) * ARC_R }
  })
  const hops = pc?.hops

  return (
    <svg viewBox="0 0 746 360" className="h-auto w-full" role="img" aria-label="Payee path to the ring">
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        {/* wire: customer -> payee */}
        <line x1={X.cust} y1={Y} x2={X.payee} y2={Y} style={{ stroke: 'var(--color-line-2)' }} strokeWidth={2} />
        {model.hub && !hubIsPayee && (
          <line x1={X.payee} y1={Y} x2={X.hub} y2={Y} style={{ stroke: ringStroke }} strokeWidth={2} />
        )}
        {pts.map((p) => (
          <line key={`l${p.id}`} x1={hubX} y1={Y} x2={p.x} y2={p.y} style={{ stroke: ringStroke, opacity: 0.6 }} strokeWidth={1} />
        ))}
        {pts.map((p) => (
          <g key={`n${p.id}`}>
            <circle cx={p.x} cy={p.y} r={10} style={{ fill: 'var(--color-surface-2)', stroke: ringStroke }} strokeWidth={1.5} />
            <text x={p.x + 16} y={p.y + 5} className="font-mono" style={{ fill: 'var(--color-mute)', fontSize: 14 }}>
              {tail(p.id)}
            </text>
          </g>
        ))}
        {/* customer */}
        <circle cx={X.cust} cy={Y} r={10} style={{ fill: 'var(--color-surface-2)', stroke: 'var(--color-ink-2)' }} strokeWidth={1.5} />
        <text x={X.cust} y={Y - 22} textAnchor="middle" style={{ fill: 'var(--color-ink-2)', fontSize: 14 }}>
          Customer
        </text>
        {/* payee */}
        {!hubIsPayee && (
          <g>
            <circle cx={X.payee} cy={Y} r={10} style={{ fill: 'var(--color-ink)' }} />
            <text x={X.payee} y={Y - 22} textAnchor="middle" style={{ fill: 'var(--color-ink-2)', fontSize: 14 }}>
              Payee
            </text>
            <text x={X.payee} y={Y + 34} textAnchor="middle" className="font-mono" style={{ fill: 'var(--color-ink-2)', fontSize: 14 }}>
              {tail(model.payee)}
            </text>
          </g>
        )}
        {/* hub */}
        {model.hub && (
          <g>
            <circle cx={hubX} cy={Y} r={16} style={{ fill: ringStroke }} />
            <text x={hubX} y={Y + 40} textAnchor="middle" style={{ fill: ringText, fontSize: 14, fontWeight: 600 }}>
              {hubIsPayee ? 'Payee · ring hub' : 'Ring hub'}
            </text>
            <text x={hubX} y={Y + 58} textAnchor="middle" className="font-mono" style={{ fill: 'var(--color-mute)', fontSize: 14 }}>
              {tail(model.hub)}
            </text>
          </g>
        )}
        {/* hops on the wire segment */}
        {inRing && (
          <text x={(X.cust + X.payee) / 2} y={Y - 12} textAnchor="middle" style={{ fill: 'var(--color-ink-2)', fontSize: 14 }}>
            {hops != null ? `${hops} ${hops === 1 ? 'hop' : 'hops'}` : DASH}
          </text>
        )}
      </motion.g>
    </svg>
  )
}
