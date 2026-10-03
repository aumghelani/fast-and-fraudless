// Circular 3-D voice wave: a ring of bars that rise outward with the caller's real voice (mic or replay audio).
// The middle stays free for the live words (children). Silent means a calm, flat ring.
import { useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { getAnalyser } from '../lib/audio'
import { usePrefersReducedMotion } from '../app/selectors'

export type RingTone = 'idle' | 'listening' | 'HOLD' | 'VERIFY' | 'NO_HOLD'

const TONE_VAR: Record<RingTone, string> = {
  idle: '--color-accent',
  listening: '--color-accent',
  HOLD: '--color-hold',
  VERIFY: '--color-verify',
  NO_HOLD: '--color-clear',
}

const R = 3 // ring radius (world units)
const MAX_H = 0.95 // tallest bar
const FOV = 30
const TILT = 1.08 // radians: the ring lies back into a wide ellipse, so the words fit inside it

function cssColor(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return new THREE.Color(v || fallback)
}

export function VoiceRing3D({ active, tone = 'listening', bars = 120, className, children }: {
  active: boolean
  tone?: RingTone
  bars?: number
  className?: string
  children?: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ active, tone })
  live.current = { active, tone }
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)
    Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', display: 'block' })

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9deee, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(3, 4, 8)
    scene.add(key)

    const tilt = new THREE.Group()
    tilt.rotation.x = -TILT
    scene.add(tilt)
    const group = new THREE.Group() // spins slowly inside the tilt
    tilt.add(group)
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0, 0.5, 0) // grows outward from the ring
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.05 })
    const mesh = new THREE.InstancedMesh(geo, mat, bars)
    group.add(mesh)

    // thin inner circle so the ring reads even in silence
    const circle = new THREE.Mesh(
      new THREE.TorusGeometry(R - 0.06, 0.012, 8, 160),
      new THREE.MeshBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.18 }),
    )
    group.add(circle)

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const zAxis = new THREE.Vector3(0, 0, 1)
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const heights = new Float32Array(bars)
    const color = cssColor(TONE_VAR.listening, '#4f46e5')
    const target = new THREE.Color()
    const tint = new THREE.Color()
    const white = new THREE.Color(0xffffff)
    const barW = ((2 * Math.PI * R) / bars) * 0.5

    let analyser: AnalyserNode | null = null
    try {
      analyser = getAnalyser()
    } catch {
      analyser = null
    }
    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 512)

    const resize = () => {
      const r = el.getBoundingClientRect()
      const w = Math.max(1, r.width)
      const h = Math.max(1, r.height)
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = `${w}px`
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / h
      // fit the whole ellipse (and its tallest bars) whatever the box shape
      const tan = Math.tan(((FOV / 2) * Math.PI) / 180)
      const needV = 2 * (R + MAX_H) * Math.cos(TILT) + 2.2
      const needH = 2 * (R + MAX_H) * 1.08
      const dist = Math.max(needV / (2 * tan), needH / (2 * tan * camera.aspect))
      camera.position.set(0, 0, dist)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      // tell the overlay how big the inside of the ring is on screen
      tilt.updateMatrixWorld(true)
      const px = (v: THREE.Vector3) => v.applyMatrix4(tilt.matrixWorld).project(camera)
      const ix = px(new THREE.Vector3(R * 0.9, 0, 0)).x * w
      const iy = px(new THREE.Vector3(0, R * 0.9, 0)).y * h
      el.style.setProperty('--ring-in-w', `${Math.max(120, Math.round(ix))}px`)
      el.style.setProperty('--ring-in-h', `${Math.max(48, Math.round(Math.abs(iy)))}px`)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    let last = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (reduced && now - last < 120) return
      last = now
      const { active: on, tone: tn } = live.current
      target.copy(cssColor(TONE_VAR[on ? tn : 'idle'], '#4f46e5'))
      if (!on) target.lerp(white, 0.55) // silent ring: soft lavender
      color.lerp(target, 0.07)
      if (!reduced) group.rotation.z += on ? 0.0022 : 0.0008 // slow turn so the depth reads

      if (on && analyser) analyser.getByteFrequencyData(freq)
      const band = Math.floor(freq.length / 3)
      for (let i = 0; i < bars; i++) {
        const u = i / bars
        // mirror the spectrum around the ring so it looks balanced
        const k = Math.abs(u * 2 - 1) // 1 at the top seam .. 0 opposite
        const bin = Math.floor((1 - k) * band * 0.85) + 2
        const goal = on && analyser ? 0.06 + Math.pow(freq[bin] / 255, 1.25) * MAX_H : 0.06
        heights[i] += (goal - heights[i]) * (goal > heights[i] ? 0.4 : 0.09)

        const a = u * Math.PI * 2
        p.set(Math.cos(a) * R, Math.sin(a) * R, 0)
        q.setFromAxisAngle(zAxis, a - Math.PI / 2) // +Y points outward
        s.set(barW, heights[i], barW)
        m.compose(p, q, s)
        mesh.setMatrixAt(i, m)
        tint.copy(color).lerp(white, 0.08 + 0.32 * (0.5 + 0.5 * Math.sin(a))) // light from above
        mesh.setColorAt(i, tint)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      ;(circle.material as THREE.MeshBasicMaterial).color.copy(color)
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geo.dispose()
      mat.dispose()
      circle.geometry.dispose()
      ;(circle.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [bars, reduced])

  return (
    <div ref={host} className={className ?? 'relative h-80 w-full'}>
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">{children}</div>
    </div>
  )
}
