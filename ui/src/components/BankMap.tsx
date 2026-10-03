import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { AnimatePresence, motion } from 'motion/react'
import { Network } from 'lucide-react'
import { useActiveCall, useStore } from '../lib/store'
import type { Ring } from '../lib/types'
import { hms, num, usd } from '../lib/format'
import { AnimatedNumber, PanelHeader, Tag } from './ui'

// 3-D bank map: escalated rings from the GPU ring finder as glowing clusters; money flows as particles
// along the edges of the focused ring; the camera flies to the newest ring (or the live call's payee ring).

const MAX_RINGS = 140 // newest N rings on screen keeps the scene at 60 fps
const RECENT_MS = 90_000

interface GNode {
  id: string
  ring: string
  hub: boolean
  kind?: 'customer'
  x?: number
  y?: number
  z?: number
}
interface GLink {
  source: string | GNode
  target: string | GNode
  ring: string
  amount: number
}

const COL = {
  member: '#46536a',
  hub: '#c2363d',
  focusHub: '#ff2d2d',
  focusMember: '#e2575c',
  recentHub: '#ff5a5a',
  payee: '#ffffff',
  link: '#2b3444',
  focusLink: '#ff3b3b',
}

export function BankMap() {
  const storeRings = useStore((s) => s.rings)
  const ringOrder = useStore((s) => s.ringOrder)
  const hydrated = useStore((s) => s.hydrated)
  const ev = useStore((s) => s.eval)
  const cases = useStore((s) => s.cases)
  const call = useActiveCall()

  const box = useRef<HTMLDivElement | null>(null)
  const fgRef = useRef<ForceGraph3DInstance | null>(null)
  const nodes = useRef<Map<string, GNode>>(new Map())
  const links = useRef<Map<string, GLink>>(new Map())
  const shown = useRef<Set<string>>(new Set())
  const arrived = useRef<Map<string, number>>(new Map())
  const focusRef = useRef<{ ring: string | null; payee: string | null }>({ ring: null, payee: null })
  const pulse = useRef<THREE.Mesh | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [liveCount, setLiveCount] = useState(0)

  const pcRing = call?.payee_check?.in_ring ? call.payee_check.ring_id || null : null
  const pcPayee = call?.payee_account || null
  const payeeFocus = useMemo(() => (pcRing ? { ring: pcRing, payee: pcPayee } : null), [pcRing, pcPayee])
  const pcPath = (call?.payee_check?.path || []).join('>')
  const pcHops = call?.payee_check?.hops
  const custAcct = call?.customer_account || null
  // The payee's ring may be older than the rings streamed to the map: draw what the payee check knows
  // (payee -> hub) so the camera still has somewhere real to fly to.
  const rings = useMemo(() => {
    if (!pcRing || storeRings[pcRing] || !pcPayee) return storeRings
    const path = pcPath ? pcPath.split('>') : []
    const hub = pcHops === 1 ? pcPayee : path[path.length - 1] || pcPayee
    const r: Ring = {
      ring_id: pcRing, hub, type: call?.payee_check?.ring_type, tier: call?.payee_check?.ring_tier,
      accounts: Array.from(new Set([pcPayee, hub])), edges: hub !== pcPayee ? [{ src: pcPayee, dst: hub }] : [],
    }
    return { ...storeRings, [pcRing]: r }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeRings, pcRing, pcPayee, pcPath, pcHops])

  // ---------------------------------------------------------------- mount the 3-D scene once
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fg = new ForceGraph3D(el, { controlType: 'orbit', rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })
    fgRef.current = fg
    fg.backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeId('id')
      .nodeRelSize(2.2)
      .nodeResolution(10)
      .nodeOpacity(0.95)
      .nodeVal((n: any) => {
        const f = focusRef.current
        if (n.kind === 'customer') return 6
        if (f.payee && n.id === f.payee) return 6
        if (n.ring === f.ring) return n.hub ? 9 : 1.6
        return n.hub ? 5 : 0.9
      })
      .nodeColor((n: any) => {
        const f = focusRef.current
        if (n.kind === 'customer') return '#f5a524'
        if (f.payee && n.id === f.payee) return COL.payee
        if (n.ring === f.ring) return n.hub ? COL.focusHub : COL.focusMember
        if (n.hub && Date.now() - (arrived.current.get(n.ring) || 0) < RECENT_MS) return COL.recentHub
        return n.hub ? COL.hub : COL.member
      })
      .nodeLabel((n: any) => n.kind === 'customer' ? `<div style="font:600 12px Inter Variable,Inter,sans-serif;color:#f5a524;background:#0c1016e6;border:1px solid #2a3342;border-radius:6px;padding:4px 8px">customer ${n.id}<br/>wire pending</div>` : `<div style="font:600 12px Inter Variable,Inter,sans-serif;color:#e8edf4;background:#0c1016e6;border:1px solid #2a3342;border-radius:6px;padding:4px 8px">${n.hub ? 'hub ' : ''}${n.id}<br/><span style="color:#ff8a8a">${n.ring}</span></div>`)
      .linkColor((l: any) => (l.ring === '__wire' ? '#f5a524' : l.ring === focusRef.current.ring ? COL.focusLink : COL.link))
      .linkOpacity(0.55)
      .linkWidth((l: any) => (l.ring === '__wire' ? 1.2 : l.ring === focusRef.current.ring ? 0.9 : 0))
      .linkCurvature(0.18)
      .linkDirectionalParticles((l: any) => (l.ring === '__wire' ? 6 : l.ring === focusRef.current.ring ? 4 : Date.now() - (arrived.current.get(l.ring) || 0) < RECENT_MS ? 1 : 0))
      .linkDirectionalParticleWidth((l: any) => (l.ring === focusRef.current.ring ? 2.4 : 1.2))
      .linkDirectionalParticleSpeed((l: any) => 0.004 + Math.min(0.012, Math.log10(1 + (l.amount || 0)) * 0.0015))
      .linkDirectionalParticleColor((l: any) => (l.ring === '__wire' ? '#ffd27a' : l.ring === focusRef.current.ring ? '#ffb3b3' : '#ff6b6b'))
      .linkDirectionalParticleResolution(6)
      .enableNodeDrag(false)
      .warmupTicks(60)
      .cooldownTicks(220)
      .d3VelocityDecay(0.35)

    const charge: any = fg.d3Force('charge')
    if (charge?.strength) charge.strength(-18).distanceMax(160)
    const link: any = fg.d3Force('link')
    if (link?.distance) link.distance(9).strength(0.9)

    const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth || 800, el.clientHeight || 600), 0.7, 0.4, 0.3)
    fg.postProcessingComposer().addPass(bloom)

    const scene = fg.scene()
    scene.fog = new THREE.FogExp2(0x06080c, 0.0016)
    // pulsing halo around the focused hub (one mesh, reused)
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.25, depthWrite: false }),
    )
    halo.visible = false
    scene.add(halo)
    pulse.current = halo

    const controls: any = fg.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.55
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    let raf = 0
    const animatePulse = () => {
      raf = requestAnimationFrame(animatePulse)
      const f = focusRef.current
      const hubId = f.ring ? findHub(f.ring) : null
      const n = hubId ? nodes.current.get(hubId) : undefined
      if (n && n.x != null) {
        const t = performance.now() / 1000
        const s = 7 + Math.sin(t * 3.2) * 2
        halo.visible = true
        halo.position.set(n.x, n.y || 0, n.z || 0)
        halo.scale.setScalar(s)
        ;(halo.material as THREE.MeshBasicMaterial).opacity = 0.08 + (Math.sin(t * 3.2) + 1) * 0.05
      } else halo.visible = false
    }
    raf = requestAnimationFrame(animatePulse)

    const ro = new ResizeObserver(() => {
      fg.width(el.clientWidth).height(el.clientHeight)
      bloom.setSize(el.clientWidth, el.clientHeight)
    })
    ro.observe(el)
    fg.cameraPosition({ x: 0, y: 0, z: 420 })
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      fg._destructor()
      fgRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ringsRef = useRef(rings)
  ringsRef.current = rings
  function findHub(ringId: string): string | null {
    return ringsRef.current[ringId]?.hub || null
  }

  // ---------------------------------------------------------------- feed rings into the graph
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const keep = ringOrder.slice(-MAX_RINGS)
    // always keep the payee's ring on the map if we have it
    if (payeeFocus && rings[payeeFocus.ring] && !keep.includes(payeeFocus.ring)) keep.unshift(payeeFocus.ring)
    const keepSet = new Set(keep)
    let changed = false
    let added = 0
    for (const id of Array.from(shown.current)) {
      if (!keepSet.has(id)) {
        shown.current.delete(id)
        changed = true
      }
    }
    for (const id of keep) {
      if (shown.current.has(id)) continue
      const r = rings[id]
      if (!r) continue
      shown.current.add(id)
      if (hydrated && shown.current.size > 1) arrived.current.set(id, Date.now())
      changed = true
      added++
    }
    if (!changed) return
    // rebuild the node/link lists, reusing node objects so existing positions are kept (no jumps)
    const nextNodes = new Map<string, GNode>()
    const nextLinks = new Map<string, GLink>()
    for (const id of keep) {
      const r: Ring | undefined = rings[id]
      if (!r) continue
      const accts = new Set([...(r.accounts || []), ...(r.edges || []).flatMap((e) => [e.src, e.dst])])
      // seed new rings near a random direction on a shell so they fly in from the edge
      const seed = new THREE.Vector3().randomDirection().multiplyScalar(140)
      for (const a of accts) {
        if (!a || nextNodes.has(a)) continue
        const old = nodes.current.get(a)
        const n: GNode = old || { id: a, ring: id, hub: a === r.hub, x: seed.x + Math.random() * 6, y: seed.y + Math.random() * 6, z: seed.z + Math.random() * 6 }
        if (a === r.hub) n.hub = true
        nextNodes.set(a, n)
      }
      for (const e of r.edges || []) {
        if (!e.src || !e.dst || e.src === e.dst) continue
        const k = `${e.src}>${e.dst}`
        if (nextLinks.has(k)) {
          nextLinks.get(k)!.amount += e.usd ?? e.amount ?? 0
          continue
        }
        const old = links.current.get(k)
        nextLinks.set(k, old ? { ...old, source: e.src, target: e.dst, amount: e.usd ?? e.amount ?? 0 } : { source: e.src, target: e.dst, ring: id, amount: e.usd ?? e.amount ?? 0 })
      }
    }
    // the live wire: customer -> payee, drawn in amber with money particles
    if (payeeFocus?.payee && custAcct && nextNodes.has(payeeFocus.payee)) {
      const p = nextNodes.get(payeeFocus.payee)!
      const old = nodes.current.get(custAcct)
      nextNodes.set(custAcct, old || { id: custAcct, ring: '__wire', hub: false, kind: 'customer', x: (p.x || 0) + 25, y: (p.y || 0) + 25, z: (p.z || 0) + 25 })
      nextLinks.set('__wire', { source: custAcct, target: payeeFocus.payee, ring: '__wire', amount: call?.amount || 0 })
    }
    nodes.current = nextNodes
    links.current = nextLinks
    fg.graphData({ nodes: Array.from(nextNodes.values()), links: Array.from(nextLinks.values()) as any })
    if (added && hydrated) setLiveCount((c) => c + (shown.current.size > added ? added : 0))
  }, [rings, ringOrder, hydrated, payeeFocus, custAcct])

  // ---------------------------------------------------------------- choose focus (debounced)
  const newest = ringOrder.length ? ringOrder[ringOrder.length - 1] : null
  const target = payeeFocus && rings[payeeFocus.ring] ? payeeFocus.ring : newest
  useEffect(() => {
    if (!target) return
    const t = setTimeout(() => setFocus(target), 700)
    return () => clearTimeout(t)
  }, [target])

  // ---------------------------------------------------------------- highlight + camera fly-to
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !focus) return
    focusRef.current = {
      ring: focus,
      payee: payeeFocus && payeeFocus.ring === focus && payeeFocus.payee && nodes.current.has(payeeFocus.payee) ? payeeFocus.payee : null,
    }
    // re-evaluate accessors (colours, sizes, particles)
    fg.nodeColor(fg.nodeColor()).nodeVal(fg.nodeVal()).linkColor(fg.linkColor()).linkWidth(fg.linkWidth())
      .linkDirectionalParticles(fg.linkDirectionalParticles())
    let tries = 0
    const fly = () => {
      const hub = findHub(focus)
      const n = hub ? nodes.current.get(hub) : undefined
      if (!n || n.x == null) {
        if (tries++ < 20) setTimeout(fly, 250)
        return
      }
      const d = 170
      const len = Math.hypot(n.x, n.y || 0, n.z || 0) || 1
      const k = 1 + d / len
      fg.cameraPosition({ x: n.x * k, y: (n.y || 0) * k + 18, z: (n.z || 0) * k }, { x: n.x, y: n.y || 0, z: n.z || 0 }, 2200)
    }
    const t = setTimeout(fly, 900) // let freshly added nodes settle first
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, payeeFocus])

  const fr = focus ? rings[focus] : undefined
  const fcase = focus ? cases[focus] : undefined
  const isPayeeRing = !!(payeeFocus && focus === payeeFocus.ring)

  return (
    <div className="panel relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        title="Bank map"
        icon={<Network className="h-4 w-4" />}
        
        right={
          <div className="flex items-center gap-5 text-right">
            <div className="leading-none">
              <AnimatedNumber value={ev?.rings_found} format={(v) => num(Math.round(v))} className="text-[1.4rem] font-bold text-ink" />
              <div className="mt-0.5 text-[0.58rem] uppercase tracking-widest text-mute">rings found</div>
            </div>
            <div className="leading-none">
              <AnimatedNumber value={ev?.rings_escalated} format={(v) => num(Math.round(v))} className="text-[1.4rem] font-bold text-danger-ink" />
              <div className="mt-0.5 text-[0.58rem] uppercase tracking-widest text-mute">escalated</div>
            </div>
          </div>
        }
      />
      <div className="relative min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(255,59,59,0.07) 0%, rgba(6,8,12,0) 65%)' }}
        />
        <div ref={box} className="absolute inset-0" />
        {ringOrder.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-mute">Waiting for the GPU ring finder…</div>
        )}
        <div className="pointer-events-none absolute top-1 left-4 text-[0.68rem] text-mute">
          newest <span className="tnum text-ink-2">{num(Math.min(ringOrder.length, MAX_RINGS))}</span> of{' '}
          <span className="tnum text-ink-2">{num(ringOrder.length)}</span> escalated rings shown
          {liveCount > 0 && <span className="ml-2 font-semibold text-danger-ink">+{num(liveCount)} live</span>}
        </div>
        <AnimatePresence mode="wait">
          {fr && (
            <motion.div
              key={fr.ring_id + (isPayeeRing ? 'p' : '')}
              initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className="glass pointer-events-none absolute bottom-3 left-3 max-w-[88%] rounded-xl border border-danger/40 px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger" />
                </span>
                <span className="font-mono text-[1rem] font-bold text-ink">{fr.ring_id}</span>
                <Tag tone="red">{fr.type || '—'}</Tag>
                {isPayeeRing ? <Tag tone="red">payee's ring</Tag> : <Tag>newest</Tag>}
                {fcase?.status && <Tag tone="blue">agent: {String(fcase.status).replace('_', ' ')}</Tag>}
              </div>
              {!storeRings[fr.ring_id] ? (
                <div className="mt-1 text-[0.74rem] text-ink-2">
                  found earlier in the replay · payee <span className="font-mono text-ink">{pcPayee}</span> → hub <span className="font-mono text-ink">{fr.hub}</span>
                  {custAcct && <span className="text-amber"> · wire from {custAcct} pending</span>}
                </div>
              ) : (
              <div className="mt-1 flex flex-wrap gap-x-3 text-[0.74rem] text-ink-2">
                <span>{num(fr.accounts?.length)} accounts</span>
                <span>{num(fr.n_txns ?? fr.edges?.length)} txns</span>
                <span className="font-semibold text-ink">{usd(fr.total_usd)}</span>
                <span>span {num(fr.span_h, 1)} h</span>
                <span>median {usd(fr.amt_med_usd)}</span>
                <span>found {hms(fr.found_at)}</span>
              </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
