// 3-D voice bars: a gentle arc of rounded bars that rise with the caller's voice (mic or replay audio).
// Calm by design: soft light, one colour that follows the verdict, a slow breathing wave when idle.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { getAnalyser } from '../lib/audio'
import { usePrefersReducedMotion } from '../app/selectors'

export type Bars3DTone = 'idle' | 'listening' | 'HOLD' | 'VERIFY' | 'NO_HOLD'

const TONE_VAR: Record<Bars3DTone, string> = {
  idle: '--color-faint',
  listening: '--color-accent',
  HOLD: '--color-hold',
  VERIFY: '--color-verify',
  NO_HOLD: '--color-clear',
}

function cssColor(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return new THREE.Color(v || fallback)
}

export function VoiceBars3D({ active, tone = 'listening', bars = 44, className }: {
  active: boolean
  tone?: Bars3DTone
  bars?: number
  className?: string
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
    renderer.domElement.style.display = 'block'

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(0, 2.6, 11)
    camera.lookAt(0, 0.7, 0)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3f0, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(4, 7, 6)
    scene.add(key)

    // bars stand on y = 0 and scale upward; a rounded look from a capsule-ish box
    const geo = new THREE.BoxGeometry(0.17, 1, 0.17, 1, 1, 1)
    geo.translate(0, 0.5, 0)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.06 })
    const mesh = new THREE.InstancedMesh(geo, mat, bars)
    scene.add(mesh)

    // soft floor shadow under the arc
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x161a2e, transparent: true, opacity: 0.05 }),
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, -0.01, -0.35)
    scene.add(shadow)

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const heights = new Float32Array(bars)
    const color = cssColor(TONE_VAR[live.current.active ? live.current.tone : 'idle'], '#4f46e5')
    const target = color.clone()
    const tint = new THREE.Color()
    const white = new THREE.Color(0xffffff)

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
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    let last = 0
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (reduced && now - last < 120) return
      last = now
      const { active: on, tone: tn } = live.current
      target.copy(cssColor(TONE_VAR[on ? tn : 'idle'], '#4f46e5'))
      color.lerp(target, 0.08)

      if (on && analyser) analyser.getByteFrequencyData(freq)
      const band = Math.floor(freq.length / 3)
      const t = (now - t0) / 1000
      for (let i = 0; i < bars; i++) {
        const u = i / (bars - 1) // 0..1 across the arc
        const k = Math.abs(u - 0.5) * 2 // 0 centre .. 1 edge
        const bin = Math.floor((1 - k) * band * 0.9)
        const voice = on && analyser ? Math.pow(freq[bin] / 255, 1.35) * 2.4 : 0
        const breathe = reduced ? 0.12 : 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(t * 1.4 - u * 6.2))
        const goal = Math.max(breathe, voice)
        heights[i] += (goal - heights[i]) * (goal > heights[i] ? 0.4 : 0.1)

        const x = (u - 0.5) * 8.6
        const z = -1.1 * Math.pow((u - 0.5) * 2, 2) // gentle arc toward the viewer
        p.set(x, 0, z)
        s.set(1, Math.max(0.06, heights[i]), 1)
        m.compose(p, q, s)
        mesh.setMatrixAt(i, m)
        // edges fade toward white so the arc reads as depth
        tint.copy(color).lerp(white, 0.15 + 0.45 * k)
        mesh.setColorAt(i, tint)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geo.dispose()
      mat.dispose()
      shadow.geometry.dispose()
      ;(shadow.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [bars, reduced])

  return <div ref={host} aria-hidden className={className ?? 'h-40 w-full'} />
}
