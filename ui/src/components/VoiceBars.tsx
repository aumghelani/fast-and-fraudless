// Live voice bars: mirrored frequency bars from the shared analyser (mic or replay audio).
// Flat row of dots when idle; colour follows the verdict tone via CSS vars.
import { useEffect, useRef } from 'react'
import { getAnalyser } from '../lib/audio'
import { usePrefersReducedMotion } from '../app/selectors'

export type BarsTone = 'idle' | 'listening' | 'HOLD' | 'VERIFY' | 'NO_HOLD'

const TONE_VAR: Record<BarsTone, string> = {
  idle: '--color-faint',
  listening: '--color-accent',
  HOLD: '--color-hold',
  VERIFY: '--color-verify',
  NO_HOLD: '--color-clear',
}

function cssColor(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function VoiceBars({
  active,
  tone = 'listening',
  bars = 40,
  className,
}: {
  active: boolean
  tone?: BarsTone
  bars?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const color = cssColor(TONE_VAR[active ? tone : 'idle'], '#4f46e5')
    let analyser: AnalyserNode | null = null
    try {
      analyser = getAnalyser()
    } catch {
      analyser = null
    }
    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 512)
    const heights = new Float32Array(bars)
    let raf = 0
    let last = 0

    const resize = () => {
      const r = cv.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.max(1, Math.round(r.width * dpr))
      cv.height = Math.max(1, Math.round(r.height * dpr))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (reduced && t - last < 100) return
      last = t
      const W = cv.width
      const H = cv.height
      g.clearRect(0, 0, W, H)
      if (active && analyser) analyser.getByteFrequencyData(freq)
      // voice band: roughly the first third of the bins
      const band = Math.floor(freq.length / 3)
      const step = W / bars
      const bw = Math.max(2, step * 0.42)
      const mid = H / 2
      g.fillStyle = color
      for (let i = 0; i < bars; i++) {
        // fold so the loudest band sits in the middle
        const k = Math.abs(i - (bars - 1) / 2) / (bars / 2)
        const bin = Math.floor((1 - k) * band * 0.9)
        const target = active && analyser ? Math.pow(freq[bin] / 255, 1.4) : 0
        heights[i] += (target - heights[i]) * (target > heights[i] ? 0.45 : 0.12)
        const h = Math.max(bw, heights[i] * H * 0.92)
        const x = i * step + (step - bw) / 2
        g.globalAlpha = active ? 0.35 + 0.65 * Math.min(1, heights[i] * 1.6) : 0.6
        g.beginPath()
        g.roundRect(x, mid - h / 2, bw, h, bw / 2)
        g.fill()
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [active, tone, bars, reduced])

  return <canvas ref={ref} aria-hidden className={className ?? 'h-12 w-full'} />
}
