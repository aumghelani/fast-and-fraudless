// Call controls (replay, microphone, end) held once for the whole page.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useCallControls, type CallControls } from '../lib/useCallControls'
import { api } from '../lib/api'
import { getState, patchLocal } from '../lib/store'

export type Ctl = Omit<CallControls, 'level'>

const CtlContext = createContext<Ctl | null>(null)

export function CallControlsProvider({ children }: { children: ReactNode }) {
  const { mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl } = useCallControls()
  const value = useMemo<Ctl>(
    () => ({ mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl }),
    [mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl],
  )
  return <CtlContext.Provider value={value}>{children}</CtlContext.Provider>
}

export function useCtl(): Ctl {
  const v = useContext(CtlContext)
  if (!v) throw new Error('useCtl must be used inside CallControlsProvider')
  return v
}

/** Leak test: the sandbox tries to send data out; OpenShell should deny it. Result lands in state.exfil. */
export async function runExfil() {
  if (getState().exfil?.status === 'running') return
  patchLocal({ exfil: { status: 'running', at: Date.now() } })
  try {
    const r = await api.exfil()
    patchLocal({
      exfil: { status: 'done', at: Date.now(), blocked: r.blocked ?? null, message: r.error || (r.stderr || []).join(' ').slice(0, 200) },
    })
  } catch (e) {
    patchLocal({ exfil: { status: 'error', at: Date.now(), message: String((e as Error).message) } })
  }
}
