import React from 'react'
import ReactDOM from 'react-dom/client'

// After a redeploy, lazy chunks from the previous build 404 for already-open
// tabs. Vite fires this event on dynamic-import failure — reload once to pick
// up the fresh build instead of leaving a dead screen.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  const KEY = 'fontainor:chunk-reload'
  if (sessionStorage.getItem(KEY) !== '1') {
    sessionStorage.setItem(KEY, '1')
    window.location.reload()
  }
})
window.addEventListener('load', () => sessionStorage.removeItem('fontainor:chunk-reload'))
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
