import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
// racing display and condensed numerals, self-hosted (latin only)
import '@fontsource/racing-sans-one/latin-400.css'
import '@fontsource/teko/latin-600.css'
import '@fontsource/teko/latin-700.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
)
