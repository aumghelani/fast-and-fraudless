export const DASH = '—'

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function usd(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function compact(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(digits) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(digits) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(digits) + 'k'
  return v.toFixed(0)
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return DASH
  return (v * 100).toFixed(digits) + '%'
}

/** Accepts epoch ms, epoch s, or an ISO string. */
export function toDate(t: number | string | null | undefined): Date | null {
  if (t == null || t === '') return null
  if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t)
  const n = Number(t)
  if (Number.isFinite(n)) return toDate(n)
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d
}

export function hms(t: number | string | null | undefined): string {
  const d = toDate(t)
  if (!d) return DASH
  return d.toLocaleTimeString('en-US', { hour12: false })
}

/** Replay (sim) clock: the worker sends naive ISO strings in dataset time; show them as-is, no TZ shift. */
export function simClock(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return { date: `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`, time: `${m[4]}:${m[5]}:${m[6]}` }
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}
