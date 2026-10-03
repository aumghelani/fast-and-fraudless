import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { attachElement, resumeAudio } from './audio'
import { startMic, type MicHandle } from './mic'
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

  const stopLocal = useCallback(async () => {
    if (mic.current) {
      mic.current.stop() // flushes the tail chunk into sendChain
      mic.current = null
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

  const toggleMic = useCallback(() => {
    if (modeRef.current === 'mic') end()
    else if (modeRef.current === 'idle' || modeRef.current === 'replay') startMicCall()
  }, [end, startMicCall])

  return { mode, level, error, micMode, replay, startMicCall, toggleMic, end, audioEl }
}

export type CallControls = ReturnType<typeof useCallControls>
