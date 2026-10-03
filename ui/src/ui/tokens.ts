// Shared design tokens: verdict copy and colours (light theme), easing, durations, reduced motion.
import { useSyncExternalStore } from 'react'

export type Verdict = 'HOLD' | 'VERIFY' | 'NO_HOLD'

/** color: dots, bars, big words. soft: pastel fill. deep: small text on the pastel fill. */
export const VERDICT: Record<Verdict, { title: string; short: string; color: string; soft: string; deep: string }> = {
  HOLD: {
    title: 'Hold this wire', short: 'Hold',
    color: 'var(--color-hold)', soft: 'var(--color-hold-soft)', deep: 'var(--color-hold-deep)',
  },
  VERIFY: {
    title: 'Verify before sending', short: 'Verify',
    color: 'var(--color-verify)', soft: 'var(--color-verify-soft)', deep: 'var(--color-verify-deep)',
  },
  NO_HOLD: {
    title: 'No hold needed', short: 'No hold',
    color: 'var(--color-clear)', soft: 'var(--color-clear-soft)', deep: 'var(--color-clear-deep)',
  },
}

/** Card shadow for inline styles (same as the --shadow-card token). */
export const SHADOW_CARD = '0 1px 2px rgb(22 26 46 / 0.06), 0 8px 28px rgb(22 26 46 / 0.07)'

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
export const DUR = { fast: 0.2, base: 0.4, slow: 0.6 } as const

const QUERY = '(prefers-reduced-motion: reduce)'

function mql(): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null
}

export function prefersReducedMotion(): boolean {
  return mql()?.matches ?? false
}

function subscribe(cb: () => void) {
  const m = mql()
  if (!m) return () => {}
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

/** Live value: follows the OS setting while the page is open. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
