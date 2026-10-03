// Calm audio-reactive voice orb: Canvas 2D reading the shared AnalyserNode.
// Two soft pastel layers on white (no halo), wobble at most 6% of the radius, tone colour eased over 600 ms.
// Tones come from the CSS colour tokens, so the orb follows the theme.
// The rAF loop runs only while active; otherwise one static frame is drawn.
import { useEffect, useRef } from 'react'
import { getAnalyser } from '../lib/audio'
import { prefersReducedMotion } from '../ui/tokens'

export type OrbTone = 'idle' | 'listening' | 'HOLD' | 'VERIFY' | 'NO_HOLD'

const TONE_VAR: Record<OrbTone, string> = {
  idle: '--color-mute',
  listening: '--color-accent',
  HOLD: '--color-hold',
  VERIFY: '--color-verify',
  NO_HOLD: '--color-clear',
}

type RGB = [number, number, number]

function toneRgb(t: OrbTone): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(TONE_VAR[t] || TONE_VAR.idle).trim()
  const m = /^#?([0-9a-f]{6})$/i.exec(v)
  if (!m) return [138, 144, 166] // --color-mute
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const TONE_MS = 600
const REST_MS = 600

export function VoiceOrb({ tone, active, size }: { tone: OrbTone; active: boolean; size?: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const api = useRef<{ setTone: (t: OrbTone) => void; setActive: (a: boolean) => void } | null>(null)
  const init = useRef({ tone, active })

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const reduced = prefersReducedMotion()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let w = 0
    let h = 0
    let raf = 0
    let running = false
    let active = init.current.active
    let restFrom = 0 // when active turned off, ease to rest from here
    let lastReduced = 0

    let analyser: AnalyserNode | null = null
    try {
      analyser = getAnalyser()
    } catch {
      analyser = null
    }
    const freq = new Uint8Array(analyser ? analyser.frequencyBinCount : 512)
    const time = new Uint8Array(analyser ? analyser.fftSize : 1024)
    const bands = new Float32Array(64)
    let level = 0

    // tone colour easing
    let from: RGB = toneRgb(init.current.tone)
    let to: RGB = from
    let toneAt = 0
    const color = (now: number): RGB => {
      const k = Math.min(1, (now - toneAt) / TONE_MS)
      const e = 1 - Math.pow(1 - k, 3)
      return [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e]
    }

    // radial gradients cached per radius and colour
    const cache = new Map<string, CanvasGradient>()
    const grad = (key: string, make: () => CanvasGradient) => {
      let x = cache.get(key)
      if (!x) {
        if (cache.size > 64) cache.clear()
        x = make()
        cache.set(key, x)
      }
      return x
    }

    const readAudio = () => {
      if (!analyser) return 0
      analyser.getByteFrequencyData(freq)
      analyser.getByteTimeDomainData(time)
      let s = 0
      for (let i = 0; i < time.length; i++) {
        const v = (time[i] - 128) / 128
        s += v * v
      }
      // 64 log-spaced bands over the speech range (about 80 Hz to 6 kHz)
      const n = freq.length
      for (let b = 0; b < 64; b++) {
        const lo = Math.floor(2 + Math.pow(b / 64, 1.8) * n * 0.28)
        const hi = Math.max(lo + 1, Math.floor(2 + Math.pow((b + 1) / 64, 1.8) * n * 0.28))
        let m = 0
        for (let i = lo; i < hi; i++) m = Math.max(m, freq[i])
        bands[b] += (m / 255 - bands[b]) * 0.18
      }
      return Math.sqrt(s / time.length)
    }

    const draw = (now: number, motion: number) => {
      if (!w || !h) return
      const [r, gg, b] = color(now)
      const rgb = `${r | 0},${gg | 0},${b | 0}`
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.34
      const Rk = Math.round(R)

      if (reduced) {
        // static ring whose opacity follows the level
        g.lineWidth = Math.max(2, R * 0.04)
        g.strokeStyle = `rgba(${rgb},${0.35 + Math.min(0.6, level * 2) * motion})`
        g.beginPath()
        g.arc(cx, cy, R, 0, Math.PI * 2)
        g.stroke()
        return
      }

      const t = now / 1000
      // two layers, no halo (flat light theme)
      for (let L = 0; L < 2; L++) {
        const pts = 96
        const phase = t * (0.25 + L * 0.12) * (L ? -1 : 1)
        g.beginPath()
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * Math.PI * 2
          const bi = Math.floor(((i % pts) / pts) * 32)
          const band = (bands[bi] + bands[63 - bi]) * 0.5
          const wob = Math.sin(a * (3 + L) + phase) * 0.6 + Math.sin(a * 2 - phase * 0.7) * 0.4
          // wobble and band push together stay within 6% of the radius
          const d = Math.max(-0.06, Math.min(0.06, (wob * 0.025 + band * 0.05) * motion))
          const rr = R * (1 - L * 0.06) * (1 + d + level * 0.04 * motion)
          const x = cx + Math.cos(a) * rr
          const y = cy + Math.sin(a) * rr
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.closePath()
        g.fillStyle = grad(`f${L}${Rk}${rgb}`, () => {
          const x = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R * 1.1)
          x.addColorStop(0, `rgba(${rgb},${L ? 0.3 : 0.16})`)
          x.addColorStop(1, `rgba(${rgb},0.06)`)
          return x
        })
        g.fill()
        g.lineWidth = 1.5
        g.strokeStyle = `rgba(${rgb},${L ? 0.75 : 0.35})`
        g.stroke()
      }
    }

    const frame = (now: number) => {
      raf = 0
      let motion = 1
      if (!active) {
        const k = Math.min(1, (now - restFrom) / REST_MS)
        motion = 1 - k
        level *= 0.85
      } else {
        const rms = readAudio()
        const target = Math.min(1, rms * 4.5)
        level += (target - level) * (target > level ? 0.3 : 0.08)
      }
      const toneMoving = now - toneAt < TONE_MS
      if (reduced) {
        // at most 10 updates a second, only while active
        if (active && now - lastReduced < 100 && !toneMoving) {
          raf = requestAnimationFrame(frame)
          return
        }
        lastReduced = now
      }
      draw(now, motion)
      if (active || motion > 0 || toneMoving) raf = requestAnimationFrame(frame)
      else running = false
    }

    const kick = () => {
      if (raf) return
      running = true
      raf = requestAnimationFrame(frame)
    }

    const ro = new ResizeObserver(() => {
      const r = cv.getBoundingClientRect()
      w = r.width
      h = r.height
      cv.width = Math.max(1, Math.round(w * dpr))
      cv.height = Math.max(1, Math.round(h * dpr))
      cache.clear()
      if (!running) draw(performance.now(), 0)
    })
    ro.observe(cv)

    api.current = {
      setTone: (t) => {
        from = color(performance.now())
        to = toneRgb(t)
        toneAt = performance.now()
        kick()
      },
      setActive: (a) => {
        if (a === active) return
        active = a
        if (!a) restFrom = performance.now()
        kick()
      },
    }
    if (active) kick()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      api.current = null
    }
  }, [])

  const lastTone = useRef(tone)
  useEffect(() => {
    if (lastTone.current !== tone) {
      lastTone.current = tone
      api.current?.setTone(tone)
    }
  }, [tone])
  useEffect(() => {
    api.current?.setActive(active)
  }, [active])

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={size ? 'block shrink-0' : 'block h-full w-full'}
      style={size ? { width: `${size}rem`, height: `${size}rem` } : undefined}
    />
  )
}
