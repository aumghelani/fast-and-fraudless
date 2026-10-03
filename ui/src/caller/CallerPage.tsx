// The customer's side of an in-app call: open the app with ?call, type a name, press Call.
// The voice goes straight to the banker's laptop; the box only connects the two.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Copy, Phone, PhoneOff, ShieldCheck } from 'lucide-react'
import { VoiceRing3D } from '../components/VoiceRing3D'
import { audioCtx, getAnalyser, resumeAudio } from '../lib/audio'
import { gathered, line, newPeer, phoneMic } from '../lib/rtc'
import { Button } from '../app/kit'
import { mmss } from '../app/call/helpers'

type Phase = 'idle' | 'calling' | 'connected' | 'ended' | 'insecure'

export function CallerPage() {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('ff.caller') || ''
    } catch {
      return ''
    }
  })
  const [phase, setPhase] = useState<Phase>('idle')
  const [note, setNote] = useState('')
  const [t0, setT0] = useState(0)
  const [now, setNow] = useState(Date.now())
  const s = useRef<{ pc: RTCPeerConnection; mine: MediaStream; id?: string; poll?: number } | null>(null)
  const ear = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (phase !== 'connected') return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [phase])

  const cleanup = () => {
    const x = s.current
    s.current = null
    if (!x) return
    if (x.poll) clearInterval(x.poll)
    x.pc.close()
    x.mine.getTracks().forEach((t) => t.stop())
    if (ear.current) ear.current.srcObject = null
  }

  // closing or refreshing this page hangs up
  useEffect(() => {
    const onHide = () => {
      const id = s.current?.id
      if (id) navigator.sendBeacon?.('/api/rtc/hangup', new Blob([JSON.stringify({ id })], { type: 'application/json' }))
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  const call = async () => {
    const who = name.trim() || 'Customer'
    try {
      localStorage.setItem('ff.caller', who)
    } catch {
      /* private mode */
    }
    setNote('')
    setPhase('calling')
    try {
      await resumeAudio()
      const mine = await phoneMic()
      audioCtx().createMediaStreamSource(mine).connect(getAnalyser()) // the ring follows your own voice
      const pc = newPeer()
      mine.getTracks().forEach((t) => pc.addTrack(t, mine))
      pc.ontrack = (e) => {
        if (!ear.current) ear.current = new Audio()
        ear.current.srcObject = e.streams[0] ?? new MediaStream([e.track])
        ear.current.play().catch(() => {})
      }
      s.current = { pc, mine }
      await pc.setLocalDescription(await pc.createOffer())
      await gathered(pc)
      const { id } = await line.call(pc.localDescription!.sdp, who)
      if (!s.current) return line.hangup(id).catch(() => {})
      s.current.id = id
      s.current.poll = window.setInterval(async () => {
        const x = s.current
        if (!x) return
        try {
          const l = await line.state()
          if (l.id !== x.id || l.state === 'idle') {
            cleanup()
            setPhase('ended')
            setNote('The bank ended the call.')
          } else if (l.state === 'connected' && l.answer && !x.pc.remoteDescription) {
            await x.pc.setRemoteDescription({ type: 'answer', sdp: l.answer })
            setT0(Date.now())
            setPhase('connected')
          }
        } catch {
          /* try again on the next tick */
        }
      }, 600)
    } catch (e) {
      cleanup()
      if (String((e as Error).message) === 'insecure') setPhase('insecure')
      else {
        setPhase('idle')
        setNote(`Could not start the call: ${(e as Error).message}`)
      }
    }
  }

  const hangUp = () => {
    const id = s.current?.id
    cleanup()
    if (id) line.hangup(id).catch(() => {})
    setPhase('ended')
    setNote('You ended the call.')
  }

  const live = phase === 'connected'
  const origin = window.location.origin
  return (
    <div className="dot-grid flex h-full flex-col items-center overflow-hidden px-6 py-6">
      <header className="flex w-full max-w-[720px] items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-accent text-white">
          <ShieldCheck className="size-5" strokeWidth={2.2} />
        </span>
        <span className="font-brand text-[24px] text-ink">Harbor Bank</span>
        <span className="ml-auto font-mono text-[13px] text-mute">customer line · demo</span>
      </header>

      <main className="card mt-6 flex min-h-0 w-full max-w-[720px] flex-1 flex-col items-center px-8 py-6 text-center">
        <div className="font-mono text-[13px] uppercase tracking-[0.08em] text-ink-2">
          {phase === 'calling' ? 'Calling the bank…' : live ? `On the call · ${mmss((now - t0) / 1000)}` : phase === 'ended' ? 'Call ended' : 'Call your banker'}
        </div>
        <div className="relative mt-2 min-h-[220px] w-full flex-1">
          <VoiceRing3D active={live} tone="listening" tilt={0.42} bars={96} className="absolute inset-0">
            <span className="relative grid size-20 place-items-center rounded-full bg-accent text-white shadow-[0_10px_30px_rgb(79_70_229/0.35)]">
              {phase === 'calling' && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-accent"
                  animate={{ scale: [1, 1.7], opacity: [0.4, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <Phone className="relative size-8" strokeWidth={2.2} />
            </span>
          </VoiceRing3D>
        </div>

        {phase === 'insecure' ? (
          <div className="mt-4 max-w-[560px] text-left text-[15px] leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">This browser blocks the microphone on this address. One-time fix in Chrome:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open <span className="font-mono text-ink">chrome://flags/#unsafely-treat-insecure-origin-as-secure</span></li>
              <li>
                Paste <span className="font-mono text-ink">{origin}</span>{' '}
                <button className="inline-flex items-center gap-1 text-accent" onClick={() => navigator.clipboard?.writeText(origin)}>
                  <Copy size={13} /> copy
                </button>
                , set it to <b>Enabled</b>, press <b>Relaunch</b>, and open this page again.
              </li>
            </ol>
          </div>
        ) : (
          <div className="mt-4 flex w-full max-w-[460px] flex-col items-center gap-3">
            {(phase === 'idle' || phase === 'ended') && (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="h-12 w-full rounded-xl border border-line-2 bg-surface px-4 text-center text-[17px] text-ink outline-none focus:border-accent"
                />
                <button
                  onClick={call}
                  className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-clear text-[18px] font-semibold text-white hover:opacity-90"
                >
                  <Phone size={20} /> {phase === 'ended' ? 'Call again' : 'Call the bank'}
                </button>
              </>
            )}
            {(phase === 'calling' || live) && (
              <Button variant="hold" className="h-14 w-full justify-center text-[18px]" onClick={hangUp}>
                <PhoneOff size={20} /> {live ? 'Hang up' : 'Cancel'}
              </Button>
            )}
            {note && <p className="text-[14px] text-mute">{note}</p>}
          </div>
        )}
      </main>
      <p className="mt-3 font-mono text-[12px] text-mute">Your voice goes to the banker's laptop on the bank's network. Nothing leaves the building.</p>
    </div>
  )
}
