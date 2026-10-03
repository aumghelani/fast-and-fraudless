// The agent's latest run as 3-5 plain steps, mapped from the case timeline. No spinners.
import { AnimatePresence, motion } from 'motion/react'
import { Check } from 'lucide-react'
import { summariseError } from '../../flow/derive'
import { DASH, cx, hms } from '../../lib/format'
import type { Case, Sar } from '../../lib/types'
import { EASE } from '../../ui/tokens'

interface Step {
  key: string
  ts?: number | string
  text: string
  title?: string
}

const STATUS_ROW: Record<string, string> = {
  sar_drafted: 'Waiting for an analyst',
  approved: 'Approved',
  rejected: 'Rejected',
}

/** Steps from the last wake-up on, so earlier retries do not crowd the stage. */
export function caseSteps(kase?: Case): Step[] {
  const tl = kase?.timeline ?? []
  let start = 0
  for (let i = tl.length - 1; i >= 0; i--) {
    if (/^woke/i.test(String(tl[i]?.msg ?? ''))) {
      start = i
      break
    }
  }
  const out: Step[] = []
  let drafted = false
  let checked = false
  for (let i = start; i < tl.length; i++) {
    const e = tl[i]
    const msg = String(e?.msg ?? '')
    if (/^woke/i.test(msg)) {
      out.push({ key: `w${i}`, ts: e.ts, text: 'Woke on its own' + (/restart/i.test(msg) ? ' · after a restart' : '') })
    } else if (/reading case file/i.test(msg)) {
      out.push({ key: `r${i}`, ts: e.ts, text: 'Read the case file' })
    } else if (/^error/i.test(msg)) {
      out.push({ key: `e${i}`, ts: e.ts, text: summariseError(msg), title: msg })
    }
    if (!drafted && /SAR draft received/i.test(msg)) {
      drafted = true
      out.push({ key: `d${i}`, ts: e.ts, text: 'Drafted the SAR' })
    }
    const m = /(\d+)\/(\d+) citations verified/.exec(msg)
    if (m && !checked) {
      checked = true
      out.push({ key: `c${i}`, ts: e.ts, text: `Checked ${m[1]}/${m[2]} citations` })
    }
  }
  const steps = out.slice(-4)
  const last = STATUS_ROW[String(kase?.status ?? '')]
  if (last) steps.push({ key: `s-${kase?.status}`, ts: tl[tl.length - 1]?.ts, text: last })
  return steps
}

export function CaseSteps({ kase, sar }: { kase?: Case; sar?: Sar }) {
  const steps = caseSteps(kase)
  const cites = sar?.citations ?? []
  const total = cites.length
  const valid = cites.filter((c) => c.valid).length
  const rejected = total - valid
  return (
    <div className="flex h-full min-h-0 flex-col gap-10">
      <ol className="flex flex-col gap-5">
        {steps.length === 0 && <li className="text-body text-mute">{DASH}</li>}
        <AnimatePresence initial={false}>
          {steps.map((s, i) => (
            <motion.li
              key={s.key}
              title={s.title}
              className="grid grid-cols-[0.5rem_5.5rem_minmax(0,1fr)] items-center gap-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <span className={cx('h-2 w-2 rounded-full', i === steps.length - 1 ? 'bg-accent' : 'bg-faint')} />
              <span className="tnum font-mono text-meta text-mute">{hms(s.ts)}</span>
              <span className={cx('text-body', i === steps.length - 1 ? 'text-ink' : 'text-ink-2')}>{s.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      <div className="flex items-start gap-4 border-t border-line pt-8">
        <Check className="mt-1 h-7 w-7 shrink-0 text-clear" strokeWidth={2.5} aria-hidden />
        <div className="flex flex-col gap-1">
          <div className="tnum text-lead text-ink">
            {total ? `${valid}/${total}` : DASH} citations verified
            {rejected > 0 && <span className="text-hold"> · {rejected} rejected</span>}
          </div>
          <div className="text-body text-ink-2">Every number checked against the database</div>
        </div>
      </div>
    </div>
  )
}
