// Live transcript: bottom-anchored, no scrolling. Cue quotes get an accent underline and a label.
import { useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { Call } from '../../lib/types'
import { cueLabel, cueSpans, type CueSpan } from './cues'

function pieces(text: string, spans: CueSpan[], from: number, to: number): ReactNode[] {
  const out: ReactNode[] = []
  let p = from
  for (const sp of spans) {
    if (sp.e <= from || sp.s >= to) continue
    if (sp.s > p) out.push(text.slice(p, sp.s))
    out.push(
      <mark key={`m${sp.s}`} className="text-ink underline decoration-accent decoration-2 underline-offset-4">
        {text.slice(sp.s, sp.e)}
      </mark>,
      <span key={`l${sp.s}`} className="mx-1.5 text-meta font-semibold uppercase tracking-[0.08em] text-accent">
        {cueLabel(sp.cue)}
      </span>,
    )
    p = sp.e
  }
  if (p < to) out.push(text.slice(p, to))
  return out
}

export function Transcript({ call }: { call?: Call }) {
  const text = call?.transcript_final ?? call?.transcript ?? ''
  const partial = call?.partial ?? ''
  // the newest chunk starts where the previous text ended
  const prev = useRef({ id: '', text: '', start: 0 })
  if (call?.call_id !== prev.current.id) prev.current = { id: call?.call_id ?? '', text: '', start: 0 }
  if (text !== prev.current.text) {
    const start = text.startsWith(prev.current.text) ? prev.current.text.length : 0
    prev.current = { ...prev.current, text, start }
  }
  const spans = cueSpans(text, call?.cues)
  let cut = prev.current.start
  for (const sp of spans) if (sp.s < cut && sp.e > cut) cut = sp.s

  return (
    <div
      className="relative flex h-full min-h-0 flex-col justify-end overflow-hidden"
      style={{
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 6rem)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 6rem)',
      }}
    >
      <p className="text-lead leading-normal text-ink">
        {!text && !partial && (
          <span className="text-mute">{call?.ended ? 'The call ended with no speech transcribed.' : 'Listening…'}</span>
        )}
        {pieces(text, spans, 0, cut)}
        {cut < text.length && (
          <motion.span key={cut} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            {pieces(text, spans, cut, text.length)}
          </motion.span>
        )}
        {partial && <span className="text-ink-2"> {partial}</span>}
      </p>
    </div>
  )
}
