// 3-D voice bars: a gentle arc of bars that rise with the caller's voice (mic or replay audio).
// Calm by design: soft light, one colour that follows the verdict. `demo` gives a slow voice-like wave
// for the landing hero; without it, idle bars just breathe.
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

const FOV = 26
const MAX_H = 2.4 // tallest bar in world units
const DIST = 7.2 // camera distance that keeps the tallest bar in view

function cssColor(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return new THREE.Color(v || fallback)
}

export function VoiceBars3D({ active, tone = 'listening', bars = 48, orbit = false, demo = false, className }: {
  active: boolean
  tone?: Bars3DTone
  bars?: number
  /** slow camera sway so the depth reads */
  orbit?: boolean
  /** voice-like wave while no call is live (landing hero) */
  demo?: boolean
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ active, tone, orbit, demo })
  live.current = { active, tone, orbit, demo }
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
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9deee, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(4, 8, 7)
    scene.add(key)

    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.translate(0, 0.5, 0) // bars grow upward from y = 0
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 })
    const mesh = new THREE.InstancedMesh(geo, mat, bars)
    scene.add(mesh)

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const heights = new Float32Array(bars)
    const color = cssColor(TONE_VAR.idle, '#c9cedb')
    const target = new THREE.Color()
    const tint = new THREE.Color()
    const white = new THREE.Color(0xffffff)
    let span = 8 // arc width in world units, set from the box's aspect
    let width = 0.2 // bar width

    let analyser: AnalyserNode | null = null
    try {
      analyser = getAnalyser()
    } catch {
      analyser = null
    }
    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 512)

    const place = (yaw: number) => {
      camera.position.set(DIST * Math.sin(yaw), 1.9, DIST * Math.cos(yaw))
      camera.lookAt(0, MAX_H * 0.42, 0)
    }
    const resize = () => {
      const r = el.getBoundingClientRect()
      const w = Math.max(1, r.width)
      const h = Math.max(1, r.height)
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = `${w}px`
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // fill ~86% of the visible width at the arc's depth
      const visibleW = 2 * DIST * Math.tan(((FOV / 2) * Math.PI) / 180) * camera.aspect
      span = visibleW * 0.86
      width = Math.min(0.32, (span / bars) * 0.5)
    }
    resize()
    place(0)
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    let last = 0
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (reduced && now - last < 120) return
      last = now
      const t = (now - t0) / 1000
      const { active: on, tone: tn, orbit: sway, demo: wave } = live.current
      if (sway && !reduced) place(0.2 * Math.sin(t * 0.22))
      if (on || wave) target.copy(cssColor(TONE_VAR[on ? tn : 'listening'], '#4f46e5'))
      else target.copy(cssColor(TONE_VAR.listening, '#4f46e5')).lerp(white, 0.62) // idle: soft lavender
      color.lerp(target, 0.08)

      if (on && analyser) analyser.getByteFrequencyData(freq)
      const band = Math.floor(freq.length / 3)
      for (let i = 0; i < bars; i++) {
        const u = i / (bars - 1) // 0..1 across the arc
        const k = Math.abs(u - 0.5) * 2 // 0 centre .. 1 edge
        let goal: number
        if (on && analyser) {
          const bin = Math.floor((1 - k) * band * 0.9)
          goal = Math.pow(freq[bin] / 255, 1.3) * MAX_H
        } else if (wave && !reduced) {
          // slow, speech-like envelope: two drifting waves, louder in the middle
          const a = 0.5 + 0.5 * Math.sin(t * 1.9 + u * 9.5)
          const b = 0.5 + 0.5 * Math.sin(t * 0.63 - u * 4.1)
          goal = (0.18 + 1.6 * a * b) * (1 - 0.65 * k * k)
        } else {
          goal = (0.22 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.1 - u * 5.5))) * (1 - 0.4 * k * k)
        }
        goal = Math.max(0.08, goal)
        heights[i] += (goal - heights[i]) * (goal > heights[i] ? 0.35 : 0.1)

        const x = (u - 0.5) * span
        const z = -1.4 * Math.pow((u - 0.5) * 2, 2) // gentle arc toward the viewer
        p.set(x, 0, z)
        s.set(width, heights[i], width)
        m.compose(p, q, s)
        mesh.setMatrixAt(i, m)
        tint.copy(color).lerp(white, 0.1 + 0.4 * k) // edges fade so the arc reads as depth
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
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [bars, reduced])

  return <div ref={host} aria-hidden className={className ?? 'h-40 w-full'} />
}
