// One window keydown handler for the whole app. Bare digits move scenes; only Shift+1/2 start replays.
import { useEffect, useRef } from 'react'
import { getState } from '../lib/store'
import { useCtl } from './CtlProvider'
import { SCENES } from './scenes'
import { goTo, next, prev, runExfil, setAuto, setDetails, setHelp, toggleDetails } from './story'

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
      const story = getState().story

      // Shift+1 / Shift+2: e.key is "!" or "@", so match the physical key
      if (e.shiftKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
        ctlRef.current.replay(e.code === 'Digit1' ? 'CALL-01' : 'CALL-02')
        e.preventDefault()
        return
      }

      const k = e.key
      if (k === 'ArrowRight') next()
      else if (k === 'ArrowLeft') prev()
      else if (k === 'Home') goTo('watching')
      else if (k === 'End') goTo('results')
      else if (k === 'Escape') {
        if (story.help) setHelp(false)
        else if (story.details) setDetails(false)
        else return
      } else if (k === '?') setHelp(!story.help)
      else if (!e.shiftKey && k >= '1' && k <= '6' && k.length === 1) goTo(SCENES[Number(k) - 1].id)
      else {
        const c = k.toLowerCase()
        if (c === 'd') toggleDetails()
        else if (c === 'a') setAuto(!story.auto)
        else if (c === 'm') {
          if (story.scene !== 'watching' && story.scene !== 'call') return
          ctlRef.current.toggleMic()
        } else if (c === 'e') {
          goTo('proof')
          runExfil()
        } else return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
