// Fast and Fraudless: the story of one wire in six scenes, one focal point at a time.
import { memo, useEffect } from 'react'
import { connect } from './lib/store'
import { CtlProvider } from './flow/CtlProvider'
import { useDirector } from './flow/useDirector'
import { useKeys } from './flow/useKeys'
import { Header } from './shell/Header'
import { Stage } from './shell/Stage'
import { DetailsDrawer } from './shell/DetailsDrawer'
import { SystemOverlays } from './shell/SystemOverlays'
import { ShortcutSheet } from './shell/ShortcutSheet'

if (import.meta.env.DEV) import('./dev/fixtures').catch(() => {})

// no props, so a change in the call controls never re-renders the layout
const Layout = memo(function Layout() {
  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      <Header />
      <Stage />
      <DetailsDrawer />
      <SystemOverlays />
      <ShortcutSheet />
    </div>
  )
})

function Shell() {
  useEffect(() => {
    connect()
  }, [])
  useKeys()
  useDirector()
  return <Layout />
}

export default function App() {
  return (
    <CtlProvider>
      <Shell />
    </CtlProvider>
  )
}
