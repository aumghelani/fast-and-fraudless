import { useEffect, useMemo, useRef } from 'react'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { useStore } from '../lib/store'
import type { Call } from '../lib/types'

cytoscape.use(fcose)

const MAX_MEMBERS = 14

export function PayeeGraph({ call }: { call?: Call }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const pc = call?.payee_check
  const ringId = pc?.in_ring ? pc.ring_id || null : null
  const ring = useStore((s) => (ringId ? s.rings[ringId] : undefined))

  const model = useMemo(() => {
    if (!call) return null
    const cust = call.customer_account || 'customer'
    const payee = call.payee_account || pc?.payee_account || 'payee'
    const path = pc?.path && pc.path.length ? pc.path : [cust, payee]
    const hub = pc?.in_ring ? (pc.hops === 1 ? payee : path[path.length - 1]) : null
    const members: string[] = []
    const memberEdges: [string, string][] = []
    if (ring && hub) {
      const seen = new Set([cust, payee, hub])
      for (const e of ring.edges || []) {
        for (const a of [e.src, e.dst]) {
          if (a && !seen.has(a) && members.length < MAX_MEMBERS) {
            seen.add(a)
            members.push(a)
          }
        }
        if (e.src && e.dst && (members.includes(e.src) || e.src === hub || e.src === payee) &&
          (members.includes(e.dst) || e.dst === hub || e.dst === payee)) memberEdges.push([e.src, e.dst])
      }
      if (!members.length) for (const a of ring.accounts || []) if (!seen.has(a) && members.length < MAX_MEMBERS) { seen.add(a); members.push(a) }
    }
    return {
      key: [call.call_id, cust, payee, hub, ringId, ring ? 'r' : '', members.length].join('|'),
      cust, payee, hub, members, memberEdges,
      name: call.customer?.name || 'Customer',
      amount: call.amount,
    }
  }, [call, pc, ring, ringId])

  useEffect(() => {
    if (!ref.current) return
    const cy = cytoscape({
      container: ref.current,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#4a2a30', width: 9, height: 9, label: '', 'border-width': 0,
            color: '#aab4c3', 'font-family': 'Inter Variable, Inter, sans-serif', 'font-size': 14,
            'text-valign': 'bottom', 'text-margin-y': 5, 'text-wrap': 'wrap', 'text-max-width': '140px',
          },
        },
        {
          selector: 'node.customer',
          style: { 'background-color': '#1b2330', 'border-color': '#6b7686', 'border-width': 2, width: 26, height: 26, label: 'data(label)', color: '#e8edf4', 'font-weight': 600, 'text-valign': 'top', 'text-margin-y': -5 },
        },
        {
          selector: 'node.payee',
          style: { 'background-color': '#e8edf4', width: 20, height: 20, label: 'data(label)', color: '#e8edf4', 'font-weight': 600 },
        },
        { selector: 'node.payee.clean', style: { 'background-color': '#2fd27a' } },
        {
          selector: 'node.hub',
          style: { 'background-color': '#ff3b3b', width: 30, height: 30, label: 'data(label)', color: '#ff8a8a', 'font-weight': 700, 'font-size': 15, 'underlay-color': '#ff3b3b', 'underlay-opacity': 0.18, 'underlay-padding': 8, 'underlay-shape': 'ellipse' },
        },
        { selector: 'node.member', style: { 'background-color': '#b8343a', width: 8, height: 8 } },
        {
          selector: 'edge',
          style: { width: 1, 'line-color': '#5a2a30', 'curve-style': 'straight', 'target-arrow-shape': 'none' },
        },
        {
          selector: 'edge.wire',
          style: {
            width: 2.5, 'line-color': '#f5a524', 'line-style': 'dashed', 'target-arrow-shape': 'triangle',
            'target-arrow-color': '#f5a524', label: 'data(label)', color: '#f5a524', 'font-size': 13, 'font-weight': 700,
            'text-background-color': '#0c1016', 'text-background-opacity': 1, 'text-background-padding': '2px',
            'font-family': 'Inter Variable, Inter, sans-serif',
          },
        },
        {
          selector: 'edge.feed',
          style: { width: 2.5, 'line-color': '#ff3b3b', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#ff3b3b' },
        },
      ],
    })
    cyRef.current = cy
    const ro = new ResizeObserver(() => {
      cy.resize()
      cy.fit(undefined, 18)
    })
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      cy.destroy()
      cyRef.current = null
    }
  }, [])

  const key = model?.key
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().remove()
    if (!model) return
    const els: cytoscape.ElementDefinition[] = []
    const inRing = !!model.hub
    els.push({ data: { id: 'c', label: 'customer' }, classes: 'customer' })
    els.push({ data: { id: model.payee, label: 'payee' }, classes: 'payee' + (inRing ? '' : ' clean') })
    els.push({ data: { id: 'w', source: 'c', target: model.payee, label: '' }, classes: 'wire' })
    if (model.hub && model.hub !== model.payee) {
      els.push({ data: { id: model.hub, label: `${ringId ?? 'ring'} hub` }, classes: 'hub' })
      els.push({ data: { id: 'f', source: model.payee, target: model.hub }, classes: 'feed' })
    } else if (model.hub) {
      cy.add(els)
      cy.$id(model.payee).addClass('hub').data('label', `${ringId ?? 'ring'} hub\n${model.payee}`)
      els.length = 0
    }
    for (const m of model.members) els.push({ data: { id: m }, classes: 'member' })
    const ids = new Set([model.payee, model.hub, ...model.members])
    let k = 0
    for (const [s, t] of model.memberEdges) {
      if (ids.has(s) && ids.has(t) && s !== t) els.push({ data: { id: `e${k++}`, source: s, target: t } })
    }
    // members with no drawn edge hang off the hub so the cluster reads as one ring
    const linked = new Set(model.memberEdges.flat())
    for (const m of model.members) if (!linked.has(m) && model.hub) els.push({ data: { id: `h${k++}`, source: model.hub, target: m } })
    cy.add(els)
    const w = cy.width() || 400
    const h = cy.height() || 200
    const fixed = [
      { nodeId: 'c', position: { x: w * 0.05, y: h * 0.5 } },
      { nodeId: model.payee, position: { x: w * (inRing ? 0.47 : 0.9), y: h * 0.5 } },
    ]
    if (model.hub && model.hub !== model.payee) fixed.push({ nodeId: model.hub, position: { x: w * 0.9, y: h * 0.5 } })
    cy.layout({
      name: 'fcose', animate: false, randomize: true, quality: 'default', nodeRepulsion: () => 3500,
      idealEdgeLength: () => 38, fixedNodeConstraint: fixed, padding: 18,
    } as any).run()
    cy.fit(undefined, 18)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return <div ref={ref} className="h-full w-full" />
}
