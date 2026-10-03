// The 3-D bank map under the stage: the newest rings from the GPU ring finder. Live only in Watching.
import { useEffect, useRef } from 'react'
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import { useStore } from '../../lib/store'
import { useRing, useStoryCall, verdictOf } from '../../flow/derive'
import { prefersReducedMotion } from '../../ui/tokens'
import type { Ring } from '../../lib/types'
import { buildGraph, type MapLink, type MapNode } from './mapModel'

const MAX_RINGS = 50
const BATCH_MS = 1500
const FADE_MS = 400
const RECENT_MS = 20_000
const SHOT_MS = 1600

/** A theme colour from CSS, so the map follows the tokens (and a bank accent). */
function token(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  } catch {
    return fallback
  }
}

function withAlpha(color: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

function palette() {
  const accent = token('--color-accent', 'deepskyblue')
  return { member: token('--color-mute', 'slategray'), accent, link: withAlpha(accent, 0.28), hold: token('--color-hold', 'red') }
}

export function MapLayer({ active }: { active: boolean }) {
  const hydrated = useStore((s) => s.hydrated)
  const rings = useStore((s) => s.rings)
  const ringOrder = useStore((s) => s.ringOrder)
  const call = useStoryCall()
  const pc = call?.payee_check
  const payeeRing = useRing(pc?.in_ring ? pc.ring_id : null)

  const boxRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraph3DInstance | null>(null)
  const data = useRef({ rings, ringOrder, payeeRing, call })
  data.current = { rings, ringOrder, payeeRing, call }
  const st = useRef({
    nodes: new Map<string, MapNode>(),
    links: new Map<string, MapLink>(),
    key: '',
    drawn: new Set<string>(),
    arrived: new Map<string, number>(),
    first: true,
    running: false,
    colorKey: '',
    colors: palette(),
    hold: null as string | null,
    shotFor: undefined as string | undefined,
    pendingShot: null as string | null,
    pauseTimer: 0,
  }).current
  const apply = useRef<() => void>(() => {})
  const shot = useRef<() => void>(() => {})

  const isRecent = (ring: string) => {
    const t = st.arrived.get(ring)
    return t != null && Date.now() - t < RECENT_MS
  }

  // create the graph once
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const fg = new ForceGraph3D(el, {
      controlType: 'orbit',
      rendererConfig: { antialias: false, alpha: true, powerPreference: 'high-performance' },
    })
    fgRef.current = fg
    fg.renderer().setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))
    fg.backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .enableNodeDrag(false)
      .enablePointerInteraction(false)
      .nodeId('id')
      .nodeRelSize(2.4)
      .nodeResolution(6)
      .nodeOpacity(0.95)
      .nodeVal((n: any) => (n.hub ? 4 : 1))
      .nodeColor((n: any) => {
        const c = st.colors
        if (n.ring === st.hold) return c.hold
        return n.hub || isRecent(n.ring) ? c.accent : c.member
      })
      .linkColor((l: any) => {
        const c = st.colors
        if (l.ring === st.hold) return c.hold
        return isRecent(l.ring) ? c.accent : c.link
      })
      .linkOpacity(1)
      .linkWidth(0)
      .linkCurvature(0)
      .linkDirectionalParticles(0)
      .cooldownTicks(80)
      .d3AlphaDecay(0.05)
      .d3VelocityDecay(0.35)
      .onEngineStop(() => {
        st.running = false
        // pin settled nodes so later batches move only the new rings
        for (const n of st.nodes.values()) {
          if (n.x != null) {
            n.fx = n.x
            n.fy = n.y
            n.fz = n.z
          }
        }
        if (st.first) {
          st.first = false
          fg.zoomToFit(prefersReducedMotion() ? 0 : 800, 24)
        }
        shot.current()
        if (prefersReducedMotion()) {
          window.clearTimeout(st.pauseTimer)
          st.pauseTimer = window.setTimeout(() => fg.pauseAnimation(), 120)
        }
      })
    const charge: any = fg.d3Force('charge')
    charge?.strength?.(-18)
    charge?.distanceMax?.(160)
    const linkForce: any = fg.d3Force('link')
    linkForce?.distance?.(9)
    linkForce?.strength?.(0.9)

    const controls: any = fg.controls()
    controls.autoRotate = !prefersReducedMotion()
    controls.autoRotateSpeed = 0.15
    controls.enableZoom = false
    controls.enablePan = false
    controls.enableRotate = false

    const ro = new ResizeObserver(() => {
      if (el.clientWidth && el.clientHeight) fg.width(el.clientWidth).height(el.clientHeight)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.clearTimeout(st.pauseTimer)
      fg._destructor()
      fgRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // one batch: apply the ring set if it changed, and refresh colours in the same step
  apply.current = () => {
    const fg = fgRef.current
    if (!fg) return
    const { rings, ringOrder, payeeRing } = data.current
    const ids = ringOrder.slice(-MAX_RINGS)
    let src: Record<string, Ring | undefined> = rings
    if (payeeRing && !ids.includes(payeeRing.ring_id)) {
      ids.push(payeeRing.ring_id)
      if (!rings[payeeRing.ring_id]) src = { ...rings, [payeeRing.ring_id]: payeeRing }
    }
    const now = Date.now()
    for (const [id, t] of st.arrived) if (now - t >= RECENT_MS) st.arrived.delete(id)
    const key = ids.join(',')
    if (ids.length && key !== st.key) {
      if (st.key) for (const id of ids) if (!st.drawn.has(id)) st.arrived.set(id, now)
      st.drawn = new Set(ids)
      st.key = key
      st.colors = palette()
      const graph = buildGraph(ids, src, st.nodes, st.links)
      st.nodes = graph.byId
      st.links = graph.linkById
      fg.warmupTicks(st.first || prefersReducedMotion() ? 80 : 0)
      st.running = true
      fg.graphData({ nodes: graph.nodes as any[], links: graph.links as any[] })
      st.colorKey = colorKey()
      fg.resumeAnimation()
      return
    }
    const ck = colorKey()
    if (ck !== st.colorKey) {
      st.colorKey = ck
      st.colors = palette()
      fg.nodeColor(fg.nodeColor()).linkColor(fg.linkColor())
      if (prefersReducedMotion() && !st.running) {
        // render the new colours once, then stop again
        fg.resumeAnimation()
        window.clearTimeout(st.pauseTimer)
        st.pauseTimer = window.setTimeout(() => fg.pauseAnimation(), 120)
      }
    }
  }

  function colorKey() {
    return `${Array.from(st.arrived.keys()).join(',')}|${st.hold ?? ''}`
  }

  // closing shot: ease the camera to the held payee ring's hub, once it has settled
  shot.current = () => {
    const fg = fgRef.current
    const rid = st.pendingShot
    if (!fg || !rid) return
    const r = data.current.rings[rid] ?? data.current.payeeRing
    let n = r?.hub ? st.nodes.get(r.hub) : undefined
    if (!n) for (const x of st.nodes.values()) if (x.ring === rid) { n = x; break }
    if (!n || n.fx == null) return // not settled yet; onEngineStop tries again
    st.pendingShot = null
    const x = n.x ?? 0
    const y = n.y ?? 0
    const z = n.z ?? 0
    const len = Math.hypot(x, y, z)
    const [dx, dy, dz] = len > 1 ? [x / len, y / len, z / len] : [0, 0, 1]
    fg.cameraPosition({ x: x + dx * 150, y: y + dy * 150 + 20, z: z + dz * 150 }, { x, y, z }, prefersReducedMotion() ? 0 : SHOT_MS)
  }

  // live only in Watching: fade out, then pause the loop; resume, then fade in
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    window.clearTimeout(st.pauseTimer)
    if (!active) {
      st.pauseTimer = window.setTimeout(() => fg.pauseAnimation(), FADE_MS)
      return
    }
    fg.resumeAnimation()
    const c = data.current.call
    if (c && st.shotFor && c.call_id !== st.shotFor) st.hold = null
    const rid = c?.payee_check?.in_ring ? c.payee_check.ring_id : null
    if (c && rid && verdictOf(c) === 'HOLD' && st.shotFor !== c.call_id) {
      st.shotFor = c.call_id
      st.hold = rid
      st.pendingShot = rid
    }
    apply.current()
    shot.current()
    if (prefersReducedMotion() && !st.running) st.pauseTimer = window.setTimeout(() => fg.pauseAnimation(), 120)
    const iv = window.setInterval(() => apply.current(), BATCH_MS)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 left-140 transition-opacity duration-400 ease-calm"
      style={{ opacity: active ? 1 : 0 }}
    >
      <div ref={boxRef} className="absolute inset-0" />
      <div className="absolute inset-y-0 left-0 w-50 bg-linear-to-r from-bg to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-bg to-transparent" />
      {!hydrated && (
        <div className="absolute inset-0 flex items-center justify-center text-meta text-mute">Loading the ring graph…</div>
      )}
    </div>
  )
}
