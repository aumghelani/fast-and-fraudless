// 3-D voice bars: an arc of bars that rise with the caller's real voice (mic or replay audio).
// No made-up motion: silent means flat. `values` shows real numbers instead (e.g. ring sizes on the landing page).
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

export function VoiceBars3D({ active, tone = 'listening', bars = 48, orbit = false, values, className }: {
  active: boolean
  tone?: Bars3DTone
  bars?: number
  /** slow camera sway so the depth reads */
  orbit?: boolean
  /** real numbers (0..1) to show while no call is live */
  values?: number[]
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ active, tone, orbit, values })
  live.current = { active, tone, orbit, values }
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
      // layout pixels (not getBoundingClientRect): a zoomed page must not shrink the canvas twice
      const w = Math.max(1, el.clientWidth)
      const h = Math.max(1, el.clientHeight)
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
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
      const { active: on, tone: tn, orbit: sway, values: vals } = live.current
      const wave = !!vals && vals.length > 0
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
        } else if (wave) {
          goal = 0.1 + Math.max(0, Math.min(1, vals![i % vals!.length])) * MAX_H * 0.9
        } else {
          goal = 0.1 // silence: flat
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
