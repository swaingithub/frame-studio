import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initTheme, useThemeStore } from './ui/theme'
import { TooltipProvider } from './ui/tooltip'
import { ErrorBoundary } from './ui/errorBoundary'

// Apply the stored theme before first paint to avoid a flash.
const theme = initTheme()
useThemeStore.setState({ theme })

// Install as an offline-capable web app in production builds only. Dev keeps
// using Vite's live modules (a SW here would serve stale code).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

createRoot(document.getElementById('root') ?? document.body).render(
  <StrictMode>
    <ErrorBoundary>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>,
)
