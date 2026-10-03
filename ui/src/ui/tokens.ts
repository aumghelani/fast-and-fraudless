// Shared design tokens for scenes: verdict copy and colours, easing, durations, reduced motion.
import { useSyncExternalStore } from 'react'

export type Verdict = 'HOLD' | 'VERIFY' | 'NO_HOLD'

export const VERDICT: Record<Verdict, { title: string; short: string; color: string }> = {
  HOLD: { title: 'Hold this wire', short: 'Hold', color: 'var(--color-hold)' },
  VERIFY: { title: 'Verify before sending', short: 'Verify', color: 'var(--color-verify)' },
  NO_HOLD: { title: 'No hold needed', short: 'No hold', color: 'var(--color-clear)' },
}

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
