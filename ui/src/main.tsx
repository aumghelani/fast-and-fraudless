import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/racing-sans-one'
import './index.css'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<App />)
