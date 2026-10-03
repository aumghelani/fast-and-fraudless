// Investigator agent: the shown SAR draft as ring id, the agent's last steps, verified citations and the analyst's call.
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { useShownSar } from '../../flow/derive'
import { api } from '../../lib/api'
import { DASH, cx, hms } from '../../lib/format'
import type { Case, Sar } from '../../lib/types'
import { caseSteps } from '../../scenes/investigation/CaseSteps'
import { EASE, usePrefersReducedMotion } from '../../ui/tokens'
import { BTN_GHOST, BTN_PRIMARY, Card, Pill, type PillTone } from './kit'

const TITLE = 'Investigator agent · OpenShell sandbox'

const STATUS: Record<string, { text: string; tone: PillTone }> = {
  woke: { text: 'Woke on its own', tone: 'accent' },
  investigating: { text: 'Investigating', tone: 'accent' },
  sar_drafted: { text: 'Needs review', tone: 'verify' },
  approved: { text: 'Approved', tone: 'clear' },
  rejected: { text: 'Rejected', tone: 'hold' },
}

function Waiting() {
  return (
    <Card title={TITLE}>
      <p className="text-sm text-mute">Waiting for an escalated ring…</p>
      {/* skeleton rows, as in the reference queue */}
      <div className="mt-5 flex flex-col gap-3" aria-hidden>
        {[0.7, 0.45, 0.25].map((o) => (
          <div key={o} className="flex items-center gap-3" style={{ opacity: o }}>
            <span className="h-6 w-6 shrink-0 rounded-full bg-surface-2" />
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="h-2 w-3/5 rounded-full bg-surface-2" />
              <span className="h-2 w-2/5 rounded-full bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Approve or reject, same endpoint as the SAR document (POST /api/sar/{id}/decision). */
function Decision({ sar }: { sar: Sar }) {
  const reduced = usePrefersReducedMotion()
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null)
  const [sent, setSent] = useState<null | 'approved' | 'rejected'>(null)
  const [err, setErr] = useState<string | null>(null)
  const decided = sar.decision ?? sent
  const decide = async (d: 'approve' | 'reject') => {
    setBusy(d)
    setErr(null)
    try {
      await api.sarDecision(sar.sar_id, d)
      setSent(d === 'approve' ? 'approved' : 'rejected')
    } catch (e) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }
  const fade = { initial: reduced ? false : { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease: EASE } } as const

  return (
    <div className="flex h-8 shrink-0 items-center gap-2">
      <AnimatePresence mode="wait" initial={false}>
        {decided ? (
          <motion.span key="done" {...fade} className={cx('flex items-center gap-1.5 text-sm font-medium', decided === 'approved' ? 'text-clear' : 'text-hold')}>
            {decided === 'approved' ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> : <X className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
            {decided === 'approved' ? 'Approved by the analyst' : 'Rejected by the analyst'}
          </motion.span>
        ) : (
          <motion.div key="act" {...fade} className="flex items-center gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={!!busy} onClick={() => void decide('approve')}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button type="button" className={BTN_GHOST} disabled={!!busy} onClick={() => void decide('reject')}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="ml-auto truncate text-right text-[0.6875rem] text-mute" title={err ?? undefined}>
        {err ? 'Could not save. Try again.' : 'Nothing is filed automatically'}
      </span>
    </div>
  )
}

function Steps({ kase }: { kase?: Case }) {
  const steps = caseSteps(kase).slice(-4)
  if (!steps.length) return <div className="text-sm text-mute">{DASH}</div>
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <li key={s.key} title={s.title} className="grid grid-cols-[0.375rem_3.75rem_minmax(0,1fr)] items-center gap-2.5">
            <span className={cx('h-1.5 w-1.5 rounded-full', last ? 'bg-accent' : 'bg-faint')} />
            <span className="tnum font-mono text-[0.6875rem] text-mute">{hms(s.ts)}</span>
            <span className={cx('truncate text-[0.8125rem]', last ? 'font-medium text-ink' : 'text-ink-2')}>{s.text}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function InvestigatorCard() {
  const { sar, kase } = useShownSar()
  const cites = useMemo(() => {
    const list = sar?.citations ?? []
    const valid = list.filter((c) => c.valid).length
    const ids: { id: string; ok: boolean }[] = []
    const seen = new Set<string>()
    for (const c of list) {
      if (!c.txn_id || seen.has(c.txn_id)) continue
      seen.add(c.txn_id)
      ids.push({ id: c.txn_id, ok: !!c.valid })
      if (ids.length >= 4) break
    }
    return { total: list.length, valid, rejected: list.length - valid, ids }
  }, [sar?.citations])

  if (!sar) return <Waiting />

  const st = STATUS[String(sar.decision ?? kase?.status ?? '')]

  return (
    <Card title={TITLE}>
      <div className="flex shrink-0 items-center justify-between gap-3">
        <span className="font-mono text-[0.9375rem] font-medium text-ink">Ring {sar.ring_id}</span>
        {st && <Pill tone={st.tone}>{st.text}</Pill>}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-hidden">
        <Steps kase={kase} />
      </div>

      <div className="mt-3 flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-1.5 font-mono text-xs text-ink">
          <Check className="h-3.5 w-3.5 text-clear" strokeWidth={2.5} aria-hidden />
          <span className="tnum">{cites.total ? `${cites.valid}/${cites.total}` : DASH}</span>
          <span className="text-ink-2">citations verified</span>
          {cites.rejected > 0 && (
            <span className="flex items-center gap-1 text-hold">
              · <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> {cites.rejected} rejected
            </span>
          )}
        </div>
        {cites.ids.length > 0 && (
          <div className="flex min-w-0 gap-1.5 overflow-hidden">
            {cites.ids.map((c) => (
              <Pill key={c.id} tone={c.ok ? 'neutral' : 'hold'}>
                <span className={c.ok ? 'text-clear' : 'text-hold'}>{c.ok ? '✓' : '✗'}</span>
                {c.id}
              </Pill>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <Decision key={sar.sar_id} sar={sar} />
      </div>
    </Card>
  )
}
