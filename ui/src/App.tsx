// Fast and Fraudless: one page that stops a scam wire while the customer is still on the phone.
import { memo, useEffect } from 'react'
import { connect } from './lib/store'
import { CtlProvider } from './flow/CtlProvider'
import { useDirector } from './flow/useDirector'
import { useKeys } from './flow/useKeys'
import { SinglePage } from './single/SinglePage'
import { SystemOverlays } from './shell/SystemOverlays'

if (import.meta.env.DEV) import('./dev/fixtures').catch(() => {})

// no props, so a change in the call controls never re-renders the layout
const Layout = memo(function Layout() {
  return (
    <div className="h-full">
      <SinglePage />
      <SystemOverlays />
    </div>
  )
})

function Shell() {
  useEffect(() => {
    connect()
  }, [])
  useKeys()
  useDirector() // still keeps the story state (story call, shown SAR); scenes are not rendered
  return <Layout />
}

export default function App() {
  return (
    <CtlProvider>
      <Shell />
    </CtlProvider>
  )
}
