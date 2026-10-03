// One window keydown handler. Single page, so no scene keys: Shift+1/2 replay, M mic, E leak test.
import { useEffect, useRef } from 'react'
import { useCtl } from './CtlProvider'
import { runExfil } from './story'

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export function useKeys() {
  const ctl = useCtl()
  const ctlRef = useRef(ctl)
  ctlRef.current = ctl

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return

      // Shift+1 / Shift+2: e.key is "!" or "@", so match the physical key
      if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        ctlRef.current.replay(e.code === 'Digit1' ? 'CALL-01' : 'CALL-02')
        e.preventDefault()
        return
      }
      if (e.shiftKey) return

      const c = e.key.toLowerCase()
      if (c === 'm') ctlRef.current.toggleMic()
      else if (c === 'e') runExfil()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
