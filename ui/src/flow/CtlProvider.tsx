// Holds the call controls once for the whole app. The mic level (about 16 updates a second) stays here:
// children are passed through and the context value only changes with mode, error or micMode.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useCallControls, type CallControls } from '../lib/useCallControls'

export type Ctl = Omit<CallControls, 'level'>

const CtlContext = createContext<Ctl | null>(null)

export function CtlProvider({ children }: { children: ReactNode }) {
  const { mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl } = useCallControls()
  // the functions and audioEl are stable, so this changes only with mode, error and micMode
  const value = useMemo<Ctl>(
    () => ({ mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl }),
    [mode, error, micMode, replay, startMicCall, toggleMic, end, audioEl],
  )
  return <CtlContext.Provider value={value}>{children}</CtlContext.Provider>
}

export function useCtl(): Ctl {
  const v = useContext(CtlContext)
  if (!v) throw new Error('useCtl must be used inside CtlProvider')
  return v
}
