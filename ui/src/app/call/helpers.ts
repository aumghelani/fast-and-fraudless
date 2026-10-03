// Small helpers for the call panel: names, the clock, caption sentences, plain errors, live detection.
import { useEffect, useRef, useState } from 'react'
import { DASH } from '../../lib/format'
import type { Call } from '../../lib/types'

export function mmss(s?: number | null): string {
  if (s == null || !Number.isFinite(s)) return DASH
  const t = Math.max(0, Math.round(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

export function customerName(c?: Call): string | undefined {
  return c?.customer?.name?.replace(/\s*\(fictional\)\s*/i, '').trim() || c?.label || undefined
}

/** Raw errors stay in the tooltip; this is the plain-word line. */
export function plainError(e?: string | null): string {
  if (!e) return ''
  if (/secure context|getUserMedia|NotAllowed|Permission/i.test(e)) return 'Microphone is not available here'
  if (/audio playback/i.test(e)) return 'Audio could not play on this screen'
  return 'The call could not start · try again'
}

const clean = (x?: string | null) => (x || '').replace(/\s+/g, ' ').trim()

/** Newest finished sentences (index of the first kept) and the words still being heard. */
export function captionOf(c?: Call): { done: string[]; first: number; total: number; partial: string } {
  const fin = clean(c?.transcript_final || c?.transcript)
  const all = fin ? fin.split(/(?<=[.!?])\s+/).filter(Boolean) : []
  const first = Math.max(0, all.length - 2)
  return { done: all.slice(first), first, total: all.length, partial: clean(c?.partial) }
}

/** Wall clock that ticks once a second while `on`. */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [on])
  return now
}

/** True while the call's audio or words changed in the last few seconds (e.g. a call run from another screen). */
export function useRecentActivity(c?: Call, windowMs = 15000): boolean {
  const id = c?.call_id ?? ''
  const sig = c ? [c.audio_s ?? '', c.windows?.length ?? 0, c.partial ?? '', (c.transcript || '').length].join('|') : ''
  const prev = useRef<{ id: string; sig: string } | null>(null)
  const [at, setAt] = useState(0)
  useEffect(() => {
    // only growth within the same call counts; a call first seen (page load, hydrate) does not
    if (id && prev.current?.id === id && prev.current.sig !== sig) setAt(Date.now())
    prev.current = { id, sig }
  }, [id, sig])
  const now = useNow(at > 0)
  const recent = at > 0 && now - at < windowMs
  useEffect(() => {
    if (at > 0 && !recent) setAt(0) // stop the clock once it goes quiet
  }, [at, recent])
  return recent
}
