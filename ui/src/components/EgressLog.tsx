import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ShieldOff, TerminalSquare, Loader2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { cx, hms, num } from '../lib/format'
import { PanelHeader } from './ui'

export function EgressLog({ exfilRef }: { exfilRef?: React.MutableRefObject<(() => void) | null> }) {
  const egress = useStore((s) => s.egress)
  const [showRaw, setShowRaw] = useState(false)
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [result, setResult] = useState<string | null>(null)

  const parsed = egress.filter((e) => e.dest)
  const rows = showRaw ? egress : parsed
  const hidden = egress.length - parsed.length

  const exfil = async () => {
    if (state === 'running') return
    setState('running')
    setResult(null)
    try {
      const r = await api.exfil()
      setResult(r.blocked === true ? 'sandbox POST to example.com was blocked' : r.blocked === false ? 'request was NOT blocked' : r.error || 'no result')
    } catch (e) {
      setResult((e as Error).message)
    } finally {
      setState('done')
    }
  }
  if (exfilRef) exfilRef.current = exfil

  return (
    <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        title="OpenShell egress log"
        icon={<TerminalSquare className="h-4 w-4" />}
        right={
          <button className="btn !border-danger/50 !py-1 text-danger-ink" onClick={exfil} disabled={state === 'running'}>
            {state === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
            Simulate exfiltration <span className="kbd">E</span>
          </button>
        }
      />
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mx-3 mb-1.5 rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 font-mono text-[0.68rem] text-ink-2">
            exfil test: {result}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="scroll-thin mx-3 mb-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-[#04060a] px-2 py-1.5 font-mono text-[0.7rem] leading-[1.5]">
        {rows.length === 0 && <div className="px-1 py-2 text-mute">$ openshell logs --tail · waiting for sandbox traffic…</div>}
        <AnimatePresence initial={false}>
          {rows.slice(0, 120).map((e) => {
            const denied = e.verdict === 'DENIED'
            return (
              <motion.div
                key={e._k}
                layout="position"
                initial={{ opacity: 0, x: -10, backgroundColor: denied ? 'rgba(255,59,59,0.35)' : 'rgba(47,210,122,0.12)' }}
                animate={{ opacity: 1, x: 0, backgroundColor: denied ? 'rgba(255,59,59,0.08)' : 'rgba(0,0,0,0)' }}
                transition={{ duration: 0.9 }}
                className="flex gap-2 rounded px-1 whitespace-nowrap"
              >
                <span className="tnum shrink-0 text-mute">{hms(e.ts)}</span>
                <span className={cx('w-[4.4rem] shrink-0 font-bold', denied ? 'text-danger' : 'text-safe')}>{e.verdict ?? '—'}</span>
                <span className={cx('shrink-0', denied ? 'text-danger-ink' : 'text-ink')}>{e.dest ?? '(unparsed line)'}</span>
                {e.policy && <span className="shrink-0 text-nv/80">[{e.policy}]</span>}
                {e.process && <span className="shrink-0 text-mute">{e.process.split('/').pop()}</span>}
                {e.reason && <span className="min-w-0 truncate text-ink-2/70">{e.reason}</span>}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      {hidden > 0 && (
        <button className="-mt-2 mb-2 self-end px-3 text-[0.62rem] text-mute hover:text-ink-2" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'hide' : 'show'} {num(hidden)} lines without a destination
        </button>
      )}
    </div>
  )
}
