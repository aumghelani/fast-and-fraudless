// Investigator agent: the escalated ring, what the agent did, the citation check, and the analyst's call.
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { DASH, cx, hms, num } from '../lib/format'
import type { Sar } from '../lib/types'
import { Button, Card, Pill } from './kit'
import { usePrefersReducedMotion, useRing, useShownSar } from './selectors'
import { caseSteps, citationCheck } from './agent/steps'

const EASE = [0.22, 1, 0.36, 1] as const

export function AgentCard() {
  const { sar, kase, linked } = useShownSar()
  const ring = useRing(sar?.ring_id)
  const cases = useStore((s) => s.cases)
  const reduced = usePrefersReducedMotion()
  const steps = useMemo(() => caseSteps(kase, 4), [kase])
  const openCases = useMemo(
    () => Object.values(cases).filter((c) => c.status !== 'approved' && c.status !== 'rejected').length,
    [cases],
  )

  return (
    <Card title="Investigator agent" right="OpenShell sandbox" className="h-full" bodyClassName="flex flex-col px-5 pb-4 pt-3">
      {!sar ? (
        <div className="flex flex-1 flex-col justify-center gap-2">
          <p className="text-[16px] text-ink-2">Waiting for an escalated ring…</p>
          <p className="font-mono text-[13px] text-mute">
            <span className="tnum">{num(openCases)}</span> open {openCases === 1 ? 'case' : 'cases'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[15px] font-medium text-ink">{sar.ring_id}</span>
            {ring?.type && <span className="truncate text-[14px] text-ink-2">{ring.type.replace(/_/g, ' ')}</span>}
            {linked && (
              <Pill tone="accent" className="ml-auto shrink-0 px-2 py-0.5 text-[12px]">
                payee's ring
              </Pill>
            )}
          </div>

          <ol className="mt-2.5 flex flex-col gap-1">
            {steps.length === 0 && <li className="font-mono text-[13px] text-mute">{DASH}</li>}
            <AnimatePresence initial={false}>
              {steps.map((s, i) => {
                const last = i === steps.length - 1
                return (
                  <motion.li
                    key={s.key}
                    title={s.title}
                    className="grid grid-cols-[6px_64px_minmax(0,1fr)] items-center gap-2.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: reduced ? 0 : 0.3, ease: EASE }}
                  >
                    <span className={cx('h-1.5 w-1.5 rounded-full', last ? 'bg-accent' : 'bg-faint')} />
                    <span className="tnum font-mono text-[13px] text-mute">{hms(s.ts)}</span>
                    <span className={cx('truncate text-[14px]', last ? 'text-ink' : 'text-ink-2')}>{s.text}</span>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>

          <Citations sar={sar} />

          <Decision key={sar.sar_id} sar={sar} />
        </>
      )}
    </Card>
  )
}

function Citations({ sar }: { sar: Sar }) {
  const { cites, total, valid, invalid } = citationCheck(sar)
  const ids = cites.filter((c) => c.txn_id).slice(0, 4)
  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
      <div className="flex items-center gap-2 font-mono text-[14px] text-ink">
        {total > 0 && invalid === 0 ? (
          <Check className="h-4 w-4 text-clear" strokeWidth={2.5} aria-hidden />
        ) : total > 0 ? (
          <X className="h-4 w-4 text-hold" strokeWidth={2.5} aria-hidden />
        ) : null}
        <span className="tnum">{total ? `${valid}/${total}` : DASH}</span>
        <span>citations verified</span>
        {invalid > 0 && <span className="tnum text-hold">· {invalid} rejected</span>}
      </div>
      {ids.length > 0 && (
        <div className="flex gap-1.5 overflow-hidden">
          {ids.map((c, i) => (
            <span
              key={`${c.txn_id}-${i}`}
              title={c.reason || undefined}
              className={cx(
                'inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[12px]',
                c.valid ? 'bg-surface-2 text-ink-2' : 'bg-hold-soft text-hold',
              )}
            >
              <span className="truncate">{c.txn_id}</span>
              {c.valid ? (
                <Check className="h-3 w-3 shrink-0 text-clear" strokeWidth={2.5} aria-hidden />
              ) : (
                <X className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Approve / Reject, with a pending state and the analyst's decision once made. */
function Decision({ sar }: { sar: Sar }) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [sent, setSent] = useState<null | 'approved' | 'rejected'>(null)
  const [err, setErr] = useState(false)
  const decided = sar.decision ?? sent

  async function decide(d: 'approve' | 'reject') {
    setBusy(d)
    setErr(false)
    try {
      await api.sarDecision(sar.sar_id, d)
      setSent(d === 'approve' ? 'approved' : 'rejected')
    } catch {
      setErr(true)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-auto flex h-10 items-center gap-3">
      {decided ? (
        <Pill tone={decided === 'approved' ? 'clear' : 'mute'} className="shrink-0">
          {decided === 'approved' ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> : <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />}
          {decided === 'approved' ? 'Approved by analyst' : 'Rejected by analyst'}
        </Pill>
      ) : (
        <>
          <Button variant="primary" className="shrink-0" disabled={!!busy} onClick={() => void decide('approve')}>
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
          <Button variant="ghost" className="shrink-0" disabled={!!busy} onClick={() => void decide('reject')}>
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </Button>
        </>
      )}
      {err ? (
        <p className="text-[13px] leading-snug text-hold">Not saved · try again</p>
      ) : (
        <p className="text-[13px] leading-snug text-mute">
          Draft for analyst review ·<br />
          never filed automatically
        </p>
      )}
    </div>
  )
}
