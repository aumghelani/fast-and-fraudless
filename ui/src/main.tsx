import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/racing-sans-one'
import './index.css'
import { App } from './app/App'
import { CallerPage } from './caller/CallerPage'

// ?call opens the customer's side of an in-app call; everything else is the bank's dashboard
const caller = new URLSearchParams(window.location.search).has('call')
createRoot(document.getElementById('root')!).render(caller ? <CallerPage /> : <App />)
