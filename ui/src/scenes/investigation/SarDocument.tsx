// The SAR draft on stage: narrative with verified-citation chips, and the analyst's approve or reject.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api } from '../../lib/api'
import { cx, num } from '../../lib/format'
import type { Citation, Sar } from '../../lib/types'
import { Button, Chip } from '../../ui/primitives'
import { EASE, usePrefersReducedMotion } from '../../ui/tokens'

const ID_SPLIT = /(\bT\d{3,}\b)/
const ID_ONLY = /^T\d{3,}$/
const REF_LINE = /^T\d{3,}\b/

type Part = string | { id: string; n: number }
type Block = { kind: 'p'; parts: Part[] } | { kind: 'refs'; items: { id: string; n: number }[] }

/** Lines that are only a transaction reference become chip grids; ids inside prose become inline chips. */
function parse(text: string): { blocks: Block[]; chips: number } {
  let n = 0
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = REF_LINE.exec(line)
    if (m && line.length <= 48) {
      const last = blocks[blocks.length - 1]
      const item = { id: m[0], n: n++ }
      if (last && last.kind === 'refs') last.items.push(item)
      else blocks.push({ kind: 'refs', items: [item] })
      continue
    }
    const parts = line
      .split(ID_SPLIT)
      .filter(Boolean)
      .map((p): Part => (ID_ONLY.test(p) ? { id: p, n: n++ } : p))
    blocks.push({ kind: 'p', parts })
  }
  return { blocks, chips: n }
}

function CiteChip({ id, cite, amount, delay, still }: {
  id: string; cite?: Citation; amount: boolean; delay: number; still: boolean
}) {
  const bad = !!cite && !cite.valid
  const title = cite
    ? [cite.amount != null ? num(cite.amount, 2) : '', cite.reason ?? ''].filter(Boolean).join(' · ')
    : undefined
  return (
    <motion.span
      title={title}
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay, ease: EASE }}
      className={cx(
        'mx-0.5 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 font-mono text-meta',
        bad ? 'border-hold text-hold' : 'border-line-2 text-ink-2',
      )}
    >
      {cite && <span className={bad ? 'text-hold' : 'text-clear'}>{bad ? '✗' : '✓'}</span>}
      <span>
        {id}
        {amount && cite?.amount != null ? ` · ${num(cite.amount, 2)}` : ''}
      </span>
    </motion.span>
  )
}

export function SarDocument({ sar }: { sar: Sar }) {
  const reduced = usePrefersReducedMotion()
  const { blocks, chips } = useMemo(() => parse(sar.narrative ?? ''), [sar.narrative])
  const cites = useMemo(() => {
    const m = new Map<string, Citation>()
    for (const c of sar.citations ?? []) if (c.txn_id && !m.has(c.txn_id)) m.set(c.txn_id, c)
    return m
  }, [sar.citations])
  // stagger 50 ms, every chip in within 500 ms
  const step = chips > 1 ? Math.min(0.05, 0.3 / (chips - 1)) : 0

  const boxRef = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sar.narrative])

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

  const chip = (id: string, n: number, amount: boolean) => (
    <CiteChip key={`${id}-${n}`} id={id} cite={cites.get(id)} amount={amount} delay={n * step} still={reduced} />
  )

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-surface p-8">
      <div className="mb-6 flex shrink-0 items-center justify-between gap-4">
        <span className="font-mono text-body text-ink">{sar.sar_id}</span>
        <Chip>Draft · not filed</Chip>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={boxRef} className="flex h-full flex-col gap-4 overflow-hidden">
          {blocks.map((b, i) =>
            b.kind === 'refs' ? (
              <div key={i} className="grid grid-cols-3 gap-2">
                {b.items.map((it) => chip(it.id, it.n, true))}
              </div>
            ) : (
              <p key={i} className="text-lead leading-normal text-ink">
                {b.parts.map((p, j) => (typeof p === 'string' ? <span key={j}>{p}</span> : chip(p.id, p.n, false)))}
              </p>
            ),
          )}
        </div>
        {clipped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-b from-transparent to-surface" />
        )}
      </div>
      {clipped && <div className="mt-2 shrink-0 text-meta text-mute">Full text in Details</div>}

      <div className="mt-6 flex h-14 shrink-0 items-center gap-4">
        <AnimatePresence mode="wait" initial={false}>
          {decided ? (
            <motion.div
              key="decided"
              className={cx('text-lead font-semibold', decided === 'approved' ? 'text-clear' : 'text-hold')}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {decided === 'approved' ? 'Approved' : 'Rejected'}
            </motion.div>
          ) : (
            <motion.div
              key="actions"
              className="flex items-center gap-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Button variant="primary" size="lg" disabled={!!busy} onClick={() => decide('approve')}>
                {busy === 'approve' ? 'Approving…' : 'Approve SAR'}
              </Button>
              <Button variant="ghost" size="lg" disabled={!!busy} onClick={() => decide('reject')}>
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="ml-auto text-right">
          {err ? (
            <span className="text-body text-ink-2" title={err}>
              Could not save the decision. Try again.
            </span>
          ) : (
            <span className="text-meta text-mute">An analyst approves. Nothing is filed automatically.</span>
          )}
        </div>
      </div>
    </div>
  )
}
