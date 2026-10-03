import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, Check, X, ShieldCheck, FileText, Loader2 } from 'lucide-react'
import { useStore } from '../lib/store'
import type { Case, Sar } from '../lib/types'
import { api } from '../lib/api'
import { cx, hms, num, toDate } from '../lib/format'
import { PanelHeader, Tag } from './ui'

const STATUS: Record<string, { tone: 'grey' | 'red' | 'green' | 'amber' | 'nv' | 'blue'; label: string }> = {
  woke: { tone: 'blue', label: 'woke' },
  investigating: { tone: 'amber', label: 'investigating' },
  sar_drafted: { tone: 'nv', label: 'SAR drafted' },
  approved: { tone: 'green', label: 'approved' },
  rejected: { tone: 'grey', label: 'rejected' },
  error: { tone: 'red', label: 'error' },
}

function lastTs(c: Case): number {
  const t = c.timeline?.[c.timeline.length - 1]?.ts
  return toDate(t as any)?.getTime() ?? 0
}

function StatusPill({ status }: { status?: string }) {
  const s = STATUS[status || ''] || { tone: 'grey' as const, label: status || '—' }
  return (
    <Tag tone={s.tone}>
      {status === 'investigating' && <Loader2 className="h-3 w-3 animate-spin" />}
      {s.label}
    </Tag>
  )
}

function Narrative({ sar }: { sar: Sar }) {
  // highlight cited transaction ids in the narrative with their validation result
  const valid = new Map<string, boolean>()
  for (const c of sar.citations || []) if (c.txn_id) valid.set(c.txn_id, c.valid)
  const text = sar.narrative || ''
  const parts = text.split(/(\bT\d{3,}\b)/g)
  return (
    <p className="whitespace-pre-wrap text-[0.8rem] leading-relaxed text-ink-2">
      {parts.map((p, i) =>
        valid.has(p) ? (
          <span key={i} className={cx('rounded px-0.5 font-mono font-semibold', valid.get(p) ? 'bg-safe/10 text-safe' : 'bg-danger/15 text-danger-ink')}>{p}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  )
}

export function AgentPanel() {
  const cases = useStore((s) => s.cases)
  const sars = useStore((s) => s.sars)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const list = useMemo(() => {
    const ids = new Set([...Object.keys(cases), ...Object.values(sars).map((s) => s.ring_id)])
    return Array.from(ids)
      .map((id) => cases[id] || ({ ring_id: id, status: 'sar_drafted', timeline: [] } as Case))
      .sort((a, b) => lastTs(b) - lastTs(a))
  }, [cases, sars])

  const selId = picked && list.some((c) => c.ring_id === picked) ? picked : list[0]?.ring_id
  const sel = list.find((c) => c.ring_id === selId)
  const sar = sel ? sars['SAR-' + sel.ring_id] || Object.values(sars).find((s) => s.ring_id === sel.ring_id) : undefined
  const okCount = sar?.citations?.filter((c) => c.valid).length ?? 0

  const decide = async (d: 'approve' | 'reject') => {
    if (!sar) return
    setBusy(d)
    setErr(null)
    try {
      await api.sarDecision(sar.sar_id, d)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        title="Investigator agent"
        icon={<Bot className="h-4 w-4" />}
        sub="OpenClaw in OpenShell · Nemotron local"
        right={<span className="text-[0.7rem] text-mute"><span className="tnum text-ink-2">{num(list.length)}</span> cases</span>}
      />
      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[0.84rem] text-mute">
          Waiting for an escalated ring. The agent wakes on its own from a MongoDB change stream. No one prompts it.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="scroll-thin mx-3 max-h-[7.2rem] shrink-0 overflow-y-auto rounded-lg border border-line">
            <AnimatePresence initial={false}>
              {list.map((c) => (
                <motion.button
                  layout
                  key={c.ring_id}
                  initial={{ opacity: 0, backgroundColor: 'rgba(118,185,0,0.18)' }}
                  animate={{ opacity: 1, backgroundColor: c.ring_id === selId ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0)' }}
                  transition={{ duration: 0.6 }}
                  onClick={() => setPicked(c.ring_id)}
                  className="flex w-full items-center gap-2 border-b border-line/60 px-3 py-1.5 text-left last:border-0"
                >
                  <span className="w-[5.5rem] shrink-0 font-mono text-[0.8rem] font-semibold text-ink">{c.ring_id}</span>
                  <StatusPill status={c.status} />
                  <span className="min-w-0 flex-1 truncate text-[0.72rem] text-ink-2">{c.timeline?.[c.timeline.length - 1]?.msg ?? ''}</span>
                  <span className="tnum shrink-0 font-mono text-[0.66rem] text-mute">{hms(c.timeline?.[c.timeline.length - 1]?.ts as any)}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>

          {sel && (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] gap-3 p-3">
              {/* timeline */}
              <div className="scroll-thin min-h-0 overflow-y-auto pr-1">
                <div className="mb-1.5 text-[0.6rem] font-bold uppercase tracking-[0.16em] text-mute">Timeline · {sel.ring_id}</div>
                <ol className="relative ml-1.5 border-l border-line-2">
                  {(sel.timeline || []).map((t, i, arr) => (
                    <motion.li key={`${t.ts}-${i}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative mb-2 pl-3">
                      <span className={cx('absolute top-1.5 -left-[4.5px] h-2 w-2 rounded-full', i === arr.length - 1 ? 'bg-nv shadow-[0_0_8px_#76b900]' : 'bg-line-2')} />
                      <div className="tnum font-mono text-[0.64rem] text-mute">{hms(t.ts as any)}</div>
                      <div className="text-[0.74rem] leading-snug text-ink-2">{t.msg}</div>
                    </motion.li>
                  ))}
                  {!sel.timeline?.length && <li className="pl-3 text-[0.74rem] text-mute">—</li>}
                </ol>
              </div>

              {/* SAR */}
              <div className="flex min-h-0 flex-col">
                {!sar ? (
                  <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line-2 text-[0.8rem] text-mute">
                    {sel.status === 'error' ? 'Agent run ended without a SAR (shown as error, never faked)' : 'SAR draft not received yet'}
                  </div>
                ) : (
                  <>
                    <div className="mb-1.5 flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-ink-2" />
                      <span className="font-mono text-[0.78rem] font-semibold text-ink">{sar.sar_id}</span>
                      <span className="text-[0.66rem] text-mute">draft by the agent</span>
                      {sar.decision && <Tag tone={sar.decision === 'approved' ? 'green' : 'grey'} className="ml-auto">{sar.decision}</Tag>}
                    </div>
                    <AnimatePresence>
                      {sar.valid_all && (sar.citations?.length ?? 0) > 0 && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                          className="mb-1.5 flex items-center gap-1.5 rounded-md border border-safe/40 bg-safe/10 px-2 py-1 text-[0.74rem] font-semibold text-safe">
                          <ShieldCheck className="h-3.5 w-3.5" /> Every number checked against the database
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {!sar.valid_all && (sar.citations?.length ?? 0) > 0 && (
                      <div className="mb-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[0.74rem] font-semibold text-danger-ink">
                        {okCount}/{sar.citations!.length} citations verified · check the ✗ ones
                      </div>
                    )}
                    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-black/25 px-3 py-2">
                      <Narrative sar={sar} />
                    </div>
                    <div className="scroll-thin mt-1.5 flex max-h-[3.4rem] flex-wrap gap-1 overflow-y-auto">
                      {(sar.citations || []).map((c, i) => (
                        <span key={i} className={cx('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[0.64rem]', c.valid ? 'border-safe/40 text-safe' : 'border-danger/50 text-danger-ink')}
                          title={c.reason || ''}>
                          {c.valid ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                          {c.txn_id || 'amount'}{c.amount != null ? ` · ${num(c.amount, 2)}` : ''}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button className={cx('btn', sar.decision === 'approved' ? '!border-safe !bg-safe text-black' : '!border-safe/50 text-safe')} disabled={!!busy || !!sar.decision} onClick={() => decide('approve')}>
                        <Check className="h-4 w-4" /> Approve SAR
                      </button>
                      <button className={cx('btn', sar.decision === 'rejected' && '!bg-line-2')} disabled={!!busy || !!sar.decision} onClick={() => decide('reject')}>
                        <X className="h-4 w-4" /> Reject
                      </button>
                      <span className="text-[0.66rem] text-mute">{sar.decision ? `analyst ${sar.decision}` : 'an analyst approves; nothing is filed automatically'}</span>
                      {err && <span className="text-[0.7rem] text-amber">{err}</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
