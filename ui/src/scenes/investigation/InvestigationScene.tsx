// Investigation: one SAR draft the agent wrote on its own, with its steps and verified citations.
import { useMemo, type ReactNode } from 'react'
import { summariseError, useShownSar } from '../../flow/derive'
import { useStore } from '../../lib/store'
import { DASH, cx, hms, num, toDate } from '../../lib/format'
import type { Case } from '../../lib/types'
import { SceneFrame } from '../../shell/SceneFrame'
import { Empty, Eyebrow, Reveal } from '../../ui/primitives'
import { CaseSteps } from './CaseSteps'
import { SarDocument } from './SarDocument'

function openCases(cases: Record<string, Case>) {
  let n = 0
  for (const c of Object.values(cases)) if (c.status !== 'approved' && c.status !== 'rejected') n++
  return n
}

export function InvestigationScene() {
  const { sar, kase, linked } = useShownSar()
  const cases = useStore((s) => s.cases)
  const hydrated = useStore((s) => s.hydrated)
  const open = useMemo(() => openCases(cases), [cases])

  if (!sar) {
    return (
      <SceneFrame headline="The agent investigates on its own" subline="It wakes when the GPU escalates a ring. No one prompts it.">
        <Empty
          title="The investigator agent has not drafted a report yet"
          sub={hydrated ? `${num(open)} ${open === 1 ? 'case' : 'cases'} open` : DASH}
        />
      </SceneFrame>
    )
  }

  return (
    <SceneFrame
      headline={`The agent drafted a report on ring ${sar.ring_id}`}
      subline={linked ? "The payee's ring from this call" : 'The latest case the agent finished on its own'}
    >
      <Reveal order={0} className="col-span-4 h-full min-h-0">
        <CaseSteps kase={kase} sar={sar} />
      </Reveal>
      <Reveal order={1} className="col-span-8 h-full min-h-0">
        <SarDocument key={sar.sar_id} sar={sar} />
      </Reveal>
    </SceneFrame>
  )
}

// --- details

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <Eyebrow className="mb-4">{title}</Eyebrow>
      {children}
    </section>
  )
}

function lastTs(c: Case): number {
  let best = 0
  for (const e of c.timeline ?? []) best = Math.max(best, toDate(e?.ts)?.getTime() ?? 0)
  return best
}

const STATUS_TEXT: Record<string, string> = {
  woke: 'Woke on its own',
  investigating: 'Investigating',
  sar_drafted: 'Waiting for an analyst',
  approved: 'Approved',
  rejected: 'Rejected',
}

function caseStatus(c: Case): { text: string; title?: string } {
  const tl = c.timeline ?? []
  const lastMsg = String(tl[tl.length - 1]?.msg ?? '')
  let err: string | undefined
  for (let i = tl.length - 1; i >= 0; i--) {
    const m = String(tl[i]?.msg ?? '')
    if (/^error/i.test(m)) {
      err = m
      break
    }
  }
  if (c.status === 'error' || /^error/i.test(lastMsg)) return { text: summariseError(err ?? lastMsg), title: err ?? lastMsg }
  return { text: STATUS_TEXT[String(c.status ?? '')] ?? String(c.status ?? DASH), title: err }
}

export function InvestigationDetails() {
  const { sar, kase } = useShownSar()
  const cases = useStore((s) => s.cases)
  const list = useMemo(
    () => Object.values(cases).map((c) => ({ c, t: lastTs(c) })).sort((a, b) => b.t - a.t).slice(0, 6),
    [cases],
  )
  const id = sar ? encodeURIComponent(sar.sar_id) : ''

  return (
    <div>
      <Section title="Cases">
        {list.length === 0 && <div className="text-mute">{DASH}</div>}
        <div className="flex flex-col gap-2">
          {list.map(({ c }) => {
            const st = caseStatus(c)
            return (
              <div key={c.ring_id} className="flex items-baseline gap-4" title={st.title}>
                <span className={cx('w-28 shrink-0 font-mono text-meta', c.ring_id === sar?.ring_id ? 'text-ink' : 'text-ink-2')}>
                  {c.ring_id}
                </span>
                <span className="text-body text-ink-2">{st.text}</span>
              </div>
            )
          })}
        </div>
      </Section>

      {sar && (
        <Section title={`Narrative · ${sar.sar_id}`}>
          <p className="whitespace-pre-line text-body text-ink">{sar.narrative || DASH}</p>
        </Section>
      )}

      <Section title={`Timeline${kase ? ` · ${kase.ring_id}` : ''}`}>
        {!kase?.timeline?.length && <div className="text-mute">{DASH}</div>}
        <div className="flex flex-col gap-2">
          {(kase?.timeline ?? []).map((e, i) => {
            const msg = String(e?.msg ?? '')
            const bad = /^error/i.test(msg)
            return (
              <div key={i} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3" title={bad ? msg : undefined}>
                <span className="tnum font-mono text-meta text-mute">{hms(e?.ts)}</span>
                <span className="wrap-break-word text-meta text-ink-2">{bad ? summariseError(msg) : msg}</span>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Citations">
        {!sar?.citations?.length && <div className="text-mute">{DASH}</div>}
        <div className="flex flex-col gap-1.5">
          {(sar?.citations ?? []).map((c, i) => (
            <div key={i} className="grid grid-cols-[7rem_9rem_1.5rem_minmax(0,1fr)] gap-3 text-meta">
              <span className="font-mono text-ink-2">{c.txn_id ?? DASH}</span>
              <span className="tnum font-mono text-ink-2">{num(c.amount, 2)}</span>
              <span className={c.valid ? 'text-clear' : 'text-hold'}>{c.valid ? '✓' : '✗'}</span>
              <span className="text-mute">{c.reason ?? ''}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Export">
        <div className="flex flex-col gap-2">
          {sar && (
            <>
              <a className="text-accent hover:underline" href={`/api/integrations/sar/${id}/fincen.xml`} target="_blank" rel="noreferrer">
                SAR draft · FinCEN-style XML
              </a>
              <a className="text-accent hover:underline" href={`/api/integrations/sar/${id}.json`} target="_blank" rel="noreferrer">
                SAR draft · JSON
              </a>
            </>
          )}
          <a className="text-accent hover:underline" href="/api/integrations/cases/export.csv" target="_blank" rel="noreferrer">
            All cases · CSV
          </a>
        </div>
      </Section>
    </div>
  )
}
