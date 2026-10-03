// A mono number that rolls up once when it first arrives ("—" until then).
import { NumberTicker } from '../../components/magicui/number-ticker'
import { DASH, num } from '../../lib/format'
import { usePrefersReducedMotion } from '../selectors'

export function Roll({ value, digits = 0, suffix, className }: {
  value?: number | null; digits?: number; suffix?: string; className?: string
}) {
  const still = usePrefersReducedMotion()
  if (value == null || !Number.isFinite(value)) return <span className={className}>{DASH}</span>
  return (
    <span className={className}>
      {still ? (
        <span className="tnum">{num(value, digits)}</span>
      ) : (
        // `!` beats the ticker's own black / dark-mode colours
        <NumberTicker value={value} decimalPlaces={digits} className="text-inherit! tnum" />
      )}
      {suffix}
    </span>
  )
}
