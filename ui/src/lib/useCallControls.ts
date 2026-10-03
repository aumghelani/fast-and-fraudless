import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { attachElement, resumeAudio } from './audio'
import { startMic, startStream, type MicHandle } from './mic'
import { gathered, line, newPeer, phoneMic, type Line } from './rtc'
import { getState, patchLocal } from './store'

export type CallMode = 'idle' | 'starting' | 'mic' | 'replay'

/** Start mic / replay calls, stream audio, end. Shared by the buttons and the keyboard shortcuts. */
export function useCallControls() {
  const [mode, setMode] = useState<CallMode>('idle')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [micMode, setMicMode] = useState<string | null>(null)
  const mic = useRef<MicHandle | null>(null)
  const callId = useRef<string | null>(null)
  const sendChain = useRef<Promise<unknown>>(Promise.resolve())
  const audioEl = useRef<HTMLAudioElement | null>(null)
  const modeRef = useRef<CallMode>('idle')
  modeRef.current = mode
  // an in-app phone call: the peer connection, the line id, the banker's mic and the speaker for the caller
  const phone = useRef<{ pc: RTCPeerConnection; id: string; mine: MediaStream; ear: HTMLAudioElement } | null>(null)

  useEffect(() => {
    const a = new Audio()
    a.preload = 'auto'
    a.crossOrigin = 'anonymous'
    a.onended = () => {
      if (modeRef.current === 'replay') setMode('idle') // server auto-ends the replayed call
    }
    audioEl.current = a
    return () => {
      a.pause()
      a.src = ''
    }
  }, [])

  // a refresh or closed tab ends the call this page started, so the box never keeps a "live" call nobody hears
  useEffect(() => {
    const onHide = () => {
      const id = callId.current
      if (!id || modeRef.current === 'idle') return
      const url = `/api/calls/${encodeURIComponent(id)}/end`
      if (!navigator.sendBeacon?.(url)) fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
      const ph = phone.current
      if (ph) {
        const body = new Blob([JSON.stringify({ id: ph.id })], { type: 'application/json' })
        if (!navigator.sendBeacon?.('/api/rtc/hangup', body)) line.hangup(ph.id).catch(() => {})
      }
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  const stopLocal = useCallback(async () => {
    if (mic.current) {
      mic.current.stop() // flushes the tail chunk into sendChain
      mic.current = null
    }
    const ph = phone.current
    if (ph) {
      phone.current = null
      ph.pc.close()
      ph.mine.getTracks().forEach((t) => t.stop())
      ph.ear.srcObject = null
      line.hangup(ph.id).catch(() => {})
    }
    const a = audioEl.current
    if (a) a.pause()
    await sendChain.current.catch(() => {})
  }, [])

  const end = useCallback(async () => {
    const id = callId.current
    const wasActive = modeRef.current !== 'idle'
    await stopLocal()
    setMode('idle')
    if (id && wasActive) {
      const c = getState().calls[id]
      if (!c?.ended) {
        try {
          await api.endCall(id)
        } catch (e) {
          setError(String((e as Error).message))
        }
      }
    }
  }, [stopLocal])

  const replay = useCallback(
    async (scenario: 'CALL-01' | 'CALL-02') => {
      setError(null)
      if (modeRef.current !== 'idle') await end()
      setMode('starting')
      try {
        await resumeAudio()
        const { call_id } = await api.startCall(scenario)
        callId.current = call_id
        patchLocal({ activeCallId: call_id })
        const a = audioEl.current!
        attachElement(a)
        a.src = `/api/audio/${scenario}`
        a.load()
        await api.replay(call_id, scenario)
        setMode('replay')
        await a.play().catch((e) => setError(`audio playback: ${e.message}`))
      } catch (e) {
        setMode('idle')
        setError(String((e as Error).message))
      }
    },
    [end],
  )

  // scenario: whose account the live caller speaks for (e.g. CALL-01 = Margaret's); none = a generic profile
  const startMicCall = useCallback(async (scenario?: string) => {
    setError(null)
    if (modeRef.current !== 'idle') await end()
    setMode('starting')
    try {
      await resumeAudio()
      const { call_id } = await api.startCall(scenario)
      callId.current = call_id
      patchLocal({ activeCallId: call_id })
      sendChain.current = Promise.resolve()
      const h = await startMic({
        onChunk: (pcm) => {
          // keep POSTs in order: the backend cuts ASR windows from a continuous buffer
          sendChain.current = sendChain.current
            .then(() => api.sendAudio(call_id, pcm))
            .catch((e) => setError(`audio upload: ${(e as Error).message}`))
        },
        onLevel: setLevel,
      })
      mic.current = h
      setMicMode(h.mode)
      setMode('mic')
    } catch (e) {
      setMode('idle')
      setError(String((e as Error).message))
    }
  }, [end])

  /** Answer an in-app call: the banker hears the caller, the caller hears the banker,
   *  and only the caller's voice goes to speech recognition on the box. */
  const answerPhone = useCallback(
    async (ring: Line) => {
      if (!ring.id || !ring.offer) return
      setError(null)
      if (modeRef.current !== 'idle') await end()
      setMode('starting')
      let pc: RTCPeerConnection | null = null
      let mine: MediaStream | null = null
      try {
        await resumeAudio()
        mine = await phoneMic()
        pc = newPeer()
        mine.getTracks().forEach((t) => pc!.addTrack(t, mine!))
        const theirs = new Promise<MediaStream>((res) => {
          pc!.ontrack = (e) => res(e.streams[0] ?? new MediaStream([e.track]))
        })
        await pc.setRemoteDescription({ type: 'offer', sdp: ring.offer })
        await pc.setLocalDescription(await pc.createAnswer())
        await gathered(pc)
        await line.answer(ring.id, pc.localDescription!.sdp)
        const { call_id } = await api.startCall(undefined, ring.name)
        callId.current = call_id
        patchLocal({ activeCallId: call_id })
        const voice = await theirs
        const ear = new Audio()
        ear.srcObject = voice // the banker hears the caller (this also keeps the remote audio flowing)
        await ear.play().catch(() => {})
        phone.current = { pc, id: ring.id, mine, ear }
        sendChain.current = Promise.resolve()
        mic.current = await startStream(
          voice,
          {
            onChunk: (pcm) => {
              sendChain.current = sendChain.current
                .then(() => api.sendAudio(call_id, pcm))
                .catch((e) => setError(`audio upload: ${(e as Error).message}`))
            },
            onLevel: setLevel,
          },
          false,
        )
        setMode('mic')
      } catch (e) {
        pc?.close()
        mine?.getTracks().forEach((t) => t.stop())
        line.hangup(ring.id).catch(() => {})
        setMode('idle')
        setError(String((e as Error).message) === 'insecure' ? 'Microphone needs localhost or https' : String((e as Error).message))
      }
    },
    [end],
  )

  // the caller hung up: end the call here too
  useEffect(() => {
    if (mode !== 'mic') return
    const t = setInterval(async () => {
      const ph = phone.current
      if (!ph) return
      try {
        const l = await line.state()
        if (l.id !== ph.id || l.state === 'idle') end()
      } catch {
        /* keep the call; the next poll decides */
      }
    }, 1000)
    return () => clearInterval(t)
  }, [mode, end])

  const toggleMic = useCallback(() => {
    if (modeRef.current === 'mic') end()
    else if (modeRef.current === 'idle' || modeRef.current === 'replay') startMicCall()
  }, [end, startMicCall])

  return { mode, level, error, micMode, replay, startMicCall, toggleMic, end, answerPhone, audioEl }
}

export type CallControls = ReturnType<typeof useCallControls>
