import { useEffect, useRef } from 'react'
import { getAnalyser } from '../lib/audio'

// Audio-reactive voice orb (Canvas 2D + Web Audio AnalyserNode). Layered blobs deform with the
// frequency spectrum; overall size breathes with loudness. Tint follows the recommendation.

export type OrbTone = 'idle' | 'listening' | 'HOLD' | 'VERIFY' | 'NO_HOLD'

const TONES: Record<OrbTone, [number, number, number][]> = {
  idle: [[120, 140, 170], [70, 90, 120], [180, 195, 215]],
  listening: [[150, 185, 235], [90, 120, 200], [215, 230, 250]],
  HOLD: [[255, 59, 59], [190, 20, 45], [255, 150, 140]],
  VERIFY: [[245, 165, 36], [200, 110, 10], [255, 215, 140]],
  NO_HOLD: [[47, 210, 122], [10, 140, 90], [160, 245, 200]],
}

export function VoiceOrb({ tone, active }: { tone: OrbTone; active: boolean }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const toneRef = useRef(tone)
  const activeRef = useRef(active)
  toneRef.current = tone
  activeRef.current = active

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const g = cv.getContext('2d')!
    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect()
      w = r.width
      h = r.height
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    })
    ro.observe(cv)

    let analyser: AnalyserNode | null = null
    try {
      analyser = getAnalyser()
    } catch {
      analyser = null
    }
    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 512)
    const time = new Uint8Array(analyser ? analyser.fftSize : 1024)
    // smoothed state
    let level = 0
    const color = TONES.idle.map((c) => [...c]) as number[][]
    const bands = new Float32Array(64)
    const t0 = performance.now()

    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (!w || !h) return
      const t = (performance.now() - t0) / 1000
      // audio
      let rms = 0
      if (analyser) {
        analyser.getByteFrequencyData(freq)
        analyser.getByteTimeDomainData(time)
        let s = 0
        for (let i = 0; i < time.length; i++) {
          const v = (time[i] - 128) / 128
          s += v * v
        }
        rms = Math.sqrt(s / time.length)
        // 64 log-spaced bands over the speech range (~80 Hz .. 6 kHz)
        const n = freq.length
        for (let b = 0; b < 64; b++) {
          const lo = Math.floor(2 + Math.pow(b / 64, 1.8) * n * 0.28)
          const hi = Math.max(lo + 1, Math.floor(2 + Math.pow((b + 1) / 64, 1.8) * n * 0.28))
          let m = 0
          for (let i = lo; i < hi; i++) m = Math.max(m, freq[i])
          bands[b] += ((m / 255) - bands[b]) * 0.25
        }
      }
      const target = Math.min(1, rms * 4.5)
      level += (target - level) * (target > level ? 0.35 : 0.08)

      // colour easing toward the current tone
      const tgt = TONES[toneRef.current] || TONES.idle
      for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) color[k][c] += (tgt[k][c] - color[k][c]) * 0.05
      const rgba = (k: number, a: number) => `rgba(${color[k][0] | 0},${color[k][1] | 0},${color[k][2] | 0},${a})`

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const base = Math.min(w, h) * 0.26
      const R = base * (1 + level * 0.22)

      // outer halo
      const halo = g.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 2.1)
      halo.addColorStop(0, rgba(0, 0.22 + level * 0.25))
      halo.addColorStop(1, rgba(1, 0))
      g.fillStyle = halo
      g.fillRect(0, 0, w, h)

      g.globalCompositeOperation = 'lighter'
      const layers = 4
      for (let L = 0; L < layers; L++) {
        const pts = 96
        const phase = t * (0.35 + L * 0.17) * (L % 2 ? -1 : 1)
        const amp = (0.06 + L * 0.025) * (activeRef.current ? 1 : 0.35)
        g.beginPath()
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2
          const bi = Math.floor(((i % pts) / pts) * 32)
          const band = (bands[bi] + bands[63 - bi]) * 0.5 // mirror so the blob is closed smoothly
          const wobble =
            Math.sin(a * (3 + L) + phase) * 0.5 + Math.sin(a * (5 + L * 2) - phase * 1.3) * 0.3 + Math.sin(a * 2 + t * 0.7) * 0.2
          const r = R * (0.9 + L * 0.035) + R * amp * wobble + R * band * (0.35 + L * 0.08) * (0.4 + level)
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.closePath()
        const grad = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * 1.25)
        grad.addColorStop(0, rgba(2, 0.32 - L * 0.04))
        grad.addColorStop(0.55, rgba(0, 0.18 - L * 0.02))
        grad.addColorStop(1, rgba(1, 0.02))
        g.fillStyle = grad
        g.fill()
        g.lineWidth = 1.2
        g.strokeStyle = rgba(L === 0 ? 2 : 0, 0.45 - L * 0.08)
        g.stroke()
      }
      // bright core
      const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75)
      core.addColorStop(0, rgba(2, 0.35 + level * 0.4))
      core.addColorStop(1, rgba(0, 0))
      g.fillStyle = core
      g.beginPath()
      g.arc(cx, cy, R * 0.75, 0, Math.PI * 2)
      g.fill()
      g.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvas} className="h-full w-full" />
}
