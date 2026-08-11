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
import { inject } from '@vercel/analytics'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { formatEntry, recordError } from './lib/errlog'
import { bootNativeWalletEarly, setupNativeChrome } from './lib/native'
import './styles/index.css'

// Native (Capacitor) app: install the Phantom deeplink provider as
// `window.solana` BEFORE React renders, so AuthContext detects a wallet on
// first paint exactly as it would with the desktop extension. No-op on web.
bootNativeWalletEarly()

// Vercel Web Analytics — no-op until it's enabled in the Vercel dashboard.
inject()

// Absolute last resort: if an uncaught error still empties #root (React 18
// unmounts the tree when no boundary catches), never leave a silent black
// page. Recovery ladder mirrors ErrorBoundary: record the error → one
// guarded automatic reload → only then a visible notice with the actual
// error details (see src/lib/errlog.ts).
function lastResortScreen(err: unknown) {
  // record every uncaught error (diagnosable later via __fontainorErrors()),
  // but only take over the page when React's tree is actually gone
  const entry = recordError(err, 'window')
  const root = document.getElementById('root')
  if (!root || root.childElementCount > 0) return
  const RELOAD_KEY = 'fontainor:chunk-reload-at'
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
  if (Date.now() - last > 15_000) {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    window.location.reload()
    return
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  root.innerHTML =
    '<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;color:#e8eaf0;font-family:system-ui,sans-serif;background:#0b0d12">' +
    '<div style="font-size:20px;font-weight:600">Something went wrong</div>' +
    '<div style="font-size:14px;color:#9aa1b0;max-width:360px">The app hit an unexpected error and automatic recovery didn&#8217;t take.</div>' +
    '<button onclick="location.reload()" style="cursor:pointer;border:0;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;background:#f7b733;color:#211803">Reload page</button>' +
    '<pre style="max-width:90vw;max-height:160px;overflow:auto;text-align:left;font-size:11px;line-height:1.6;color:#9aa1b0;background:#12151d;border:1px solid #262b38;border-radius:10px;padding:12px">' +
    esc(formatEntry(entry)) +
    '</pre></div>'
}
window.addEventListener('error', (e) => setTimeout(() => lastResortScreen(e.error ?? e.message), 50))
window.addEventListener('unhandledrejection', (e) => setTimeout(() => lastResortScreen(e.reason), 50))

// Root-level boundary: the inner boundary in App only wraps <Routes>, so an
// uncaught error in AppShell / PlayerBar / providers would make React 18
// unmount the ENTIRE tree → bare body background (a pure #0b0d12 "black
// screen" with no message). This outer boundary turns that into a visible
// error screen instead.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </HashRouter>
  </React.StrictMode>,
)

// Native chrome (status bar, splash, back button, safe-area top). No-op on web.
void setupNativeChrome()
