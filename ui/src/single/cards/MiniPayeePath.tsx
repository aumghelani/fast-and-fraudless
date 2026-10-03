// Compact payee path for the ring card: customer -> payee -> ring hub, with up to 6 ring members as dots.
// Same model as scenes/decision/PayeePath.tsx, drawn small for a 400px card.
import { useMemo } from 'react'
import { motion } from 'motion/react'
import { useRing } from '../../flow/derive'
import type { Call } from '../../lib/types'
import { usePrefersReducedMotion } from '../../ui/tokens'

const MAX = 6
const Y = 52
const X = { cust: 26, payee: 160, hub: 292 }
const ARC_R = 46

const tail = (s: string) => (s.length > 8 ? s.slice(-8) : s)

export function MiniPayeePath({ call }: { call: Call }) {
  const reduced = usePrefersReducedMotion()
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
      const add = (a?: string) => {
        if (a && !seen.has(a) && members.length < MAX) {
          seen.add(a)
          members.push(a)
        }
      }
      for (const e of ring.edges || []) {
        add(e.src)
        add(e.dst)
      }
      if (!members.length) for (const a of ring.accounts || []) add(a)
    }
    return { cust, payee, hub, members }
  }, [call.customer_account, call.payee_account, pc, inRing, ring])

  const hubIsPayee = !!model.hub && model.hub === model.payee
  const hubX = hubIsPayee ? X.payee : X.hub
  const n = model.members.length
  const pts = model.members.map((m, i) => {
    const deg = n === 1 ? 0 : -70 + (140 * i) / (n - 1)
    const a = (deg * Math.PI) / 180
    return { id: m, x: hubX + Math.cos(a) * ARC_R, y: Y + Math.sin(a) * ARC_R }
  })
  const hops = pc?.hops
  const hold = 'var(--color-hold)'

  return (
    <svg viewBox="0 0 400 108" className="h-full w-full" role="img" aria-label="Payee path to the ring">
      <motion.g
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {/* dotted wire: customer -> payee */}
        <line x1={X.cust} y1={Y} x2={X.payee} y2={Y} style={{ stroke: 'var(--color-line-2)' }} strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" />
        {model.hub && !hubIsPayee && <line x1={X.payee} y1={Y} x2={X.hub} y2={Y} style={{ stroke: hold }} strokeWidth={1.5} />}
        {pts.map((p) => (
          <line key={`l${p.id}`} x1={hubX} y1={Y} x2={p.x} y2={p.y} style={{ stroke: hold, opacity: 0.35 }} strokeWidth={1} />
        ))}
        {pts.map((p) => (
          <circle key={`n${p.id}`} cx={p.x} cy={p.y} r={4.5} style={{ fill: 'var(--color-surface)', stroke: hold }} strokeWidth={1.25}>
            <title>{p.id}</title>
          </circle>
        ))}
        {/* customer */}
        <circle cx={X.cust} cy={Y} r={6} style={{ fill: 'var(--color-surface)', stroke: 'var(--color-ink-2)' }} strokeWidth={1.5} />
        <text x={X.cust} y={Y - 14} textAnchor="middle" style={{ fill: 'var(--color-ink-2)', fontSize: 11 }}>
          Customer
        </text>
        {inRing && hops != null && (
          <text x={(X.cust + X.payee) / 2} y={Y - 8} textAnchor="middle" className="font-mono" style={{ fill: 'var(--color-mute)', fontSize: 10 }}>
            {hops} {hops === 1 ? 'hop' : 'hops'}
          </text>
        )}
        {/* payee */}
        {!hubIsPayee && (
          <g>
            <circle cx={X.payee} cy={Y} r={6} style={{ fill: 'var(--color-ink)' }} />
            <text x={X.payee} y={Y - 14} textAnchor="middle" style={{ fill: 'var(--color-ink-2)', fontSize: 11 }}>
              Payee
            </text>
            <text x={X.payee} y={Y + 22} textAnchor="middle" className="font-mono" style={{ fill: 'var(--color-mute)', fontSize: 10 }}>
              {tail(model.payee)}
            </text>
          </g>
        )}
        {/* ring hub */}
        {model.hub && (
          <g>
            <circle cx={hubX} cy={Y} r={9} style={{ fill: hold }} />
            <text x={hubX} y={Y + 26} textAnchor="middle" style={{ fill: hold, fontSize: 11, fontWeight: 600 }}>
              {hubIsPayee ? 'Payee · ring hub' : 'Ring hub'}
            </text>
            <text x={hubX} y={Y + 39} textAnchor="middle" className="font-mono" style={{ fill: 'var(--color-mute)', fontSize: 10 }}>
              {tail(model.hub)}
            </text>
          </g>
        )}
      </motion.g>
    </svg>
  )
}
