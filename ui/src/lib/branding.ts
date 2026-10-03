// Optional white-label config from GET /api/integrations/branding. Any error keeps the defaults.
import { patchLocal, useStore } from './store'
import type { Branding } from './types'

const PRODUCT = 'Fast and Fraudless'
let started = false

/** Hue in degrees for #rgb or #rrggbb; null for greys or bad input. */
function hueOf(color?: string | null): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((color || '').trim())
  if (!m) return null
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return null
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

export async function loadBranding() {
  if (started) return
  started = true
  try {
    const r = await fetch('/api/integrations/branding', { cache: 'no-store' })
    if (!r.ok) return
    const b = (await r.json()) as Branding
    if (!b || typeof b !== 'object') return
    patchLocal({ branding: b })
    // keep the calm blue unless the bank's accent is also a cool hue
    const h = hueOf(b.accent_color)
    if (h != null && h >= 180 && h <= 320) {
      const c = b.accent_color!.trim()
      document.documentElement.style.setProperty('--color-accent', c.startsWith('#') ? c : `#${c}`)
    }
  } catch {
    /* defaults */
  }
}

export function useBranding(): { productName: string; bankName: string | null } {
  const product = useStore((s) => s.branding?.product_name)
  const bank = useStore((s) => s.branding?.bank_name)
  const b = (bank || '').trim()
  return {
    productName: (product || '').trim() || PRODUCT,
    bankName: b && b !== 'Your Bank' ? b : null,
  }
}
