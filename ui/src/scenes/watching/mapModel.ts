// Graph model for the 3-D map. Node and link objects are reused across batches, so settled positions survive.
import type { Ring } from '../../lib/types'

export interface MapNode {
  id: string
  ring: string
  hub: boolean
  x?: number
  y?: number
  z?: number
  fx?: number
  fy?: number
  fz?: number
}

export interface MapLink {
  source: string | MapNode
  target: string | MapNode
  ring: string
}

export interface MapGraph {
  nodes: MapNode[]
  links: MapLink[]
  byId: Map<string, MapNode>
  linkById: Map<string, MapLink>
}

const SHELL = 120 // a new ring starts on this shell and drifts in

/** Nodes and links for these rings. Links come from ring edges, else hub -> each account. */
export function buildGraph(
  ringIds: string[],
  rings: Record<string, Ring | undefined>,
  prevNodes: Map<string, MapNode>,
  prevLinks: Map<string, MapLink> = new Map(),
): MapGraph {
  const byId = new Map<string, MapNode>()
  const linkById = new Map<string, MapLink>()
  const link = (a: string | undefined, b: string | undefined, ring: string) => {
    if (!a || !b || a === b) return
    const k = a < b ? `${a}|${b}` : `${b}|${a}`
    if (linkById.has(k)) return
    const old = prevLinks.get(k)
    if (old) {
      old.source = a
      old.target = b
      linkById.set(k, old)
    } else linkById.set(k, { source: a, target: b, ring })
  }
  for (const id of ringIds) {
    const r = rings[id]
    if (!r) continue
    const hub = r.hub || undefined
    const accts = new Set<string>(r.accounts || [])
    for (const e of r.edges || []) {
      if (e.src) accts.add(e.src)
      if (e.dst) accts.add(e.dst)
    }
    if (hub) accts.add(hub)
    // one random point on the shell per ring, so its new nodes arrive together
    const u = Math.random() * 2 - 1
    const t = Math.random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const seed = { x: SHELL * s * Math.cos(t), y: SHELL * u, z: SHELL * s * Math.sin(t) }
    for (const a of accts) {
      if (!a || byId.has(a)) continue
      const n: MapNode = prevNodes.get(a) ?? {
        id: a, ring: id, hub: false,
        x: seed.x + Math.random() * 8 - 4, y: seed.y + Math.random() * 8 - 4, z: seed.z + Math.random() * 8 - 4,
      }
      if (a === hub) n.hub = true
      byId.set(a, n)
    }
    const before = linkById.size
    for (const e of r.edges || []) link(e.src, e.dst, id)
    if (linkById.size === before && hub) for (const a of accts) link(hub, a, id)
  }
  return { nodes: Array.from(byId.values()), links: Array.from(linkById.values()), byId, linkById }
}
