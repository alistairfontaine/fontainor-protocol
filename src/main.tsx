import React from 'react'
import ReactDOM from 'react-dom/client'

// After a redeploy, lazy chunks from the previous build 404 for already-open
// tabs. Vite fires this event on dynamic-import failure — reload once to pick
// up the fresh build instead of leaving a dead screen.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  const KEY = 'fontainor:chunk-reload-at'
  const last = Number(sessionStorage.getItem(KEY) || 0)
  // at most one auto-reload per 15s — prevents a reload loop if the chunk
  // is genuinely unreachable (the ErrorBoundary takes over instead)
  if (Date.now() - last > 15_000) {
    sessionStorage.setItem(KEY, String(Date.now()))
    window.location.reload()
  }
})
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
