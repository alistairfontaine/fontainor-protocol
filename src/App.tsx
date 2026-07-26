import { Suspense, lazy, useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { WalletButton } from './components/WalletButton'
import Home from './pages/Home'
import { AuthProvider } from './state/AuthContext'
import { PlayerProvider } from './state/PlayerContext'
import { RegistryProvider } from './state/RegistryContext'

// Route-level code splitting: Home stays in the main chunk (first paint),
// everything else loads on demand. One loader per chunk so the lazy()
// wrappers and the idle warm-up below share the same module requests.
const routeLoaders = {
  library: () => import('./pages/Library'),
  releaseDetail: () => import('./pages/ReleaseDetail'),
  publish: () => import('./pages/Publish'),
  profile: () => import('./pages/Profile'),
  editorial: () => import('./pages/Editorial'),
  collections: () => import('./pages/Collections'),
  static: () => import('./pages/Static'),
}

const Library = lazy(routeLoaders.library)
const ReleaseDetail = lazy(routeLoaders.releaseDetail)
const Publish = lazy(routeLoaders.publish)
const Profile = lazy(routeLoaders.profile)
const EditorialList = lazy(() => routeLoaders.editorial().then((m) => ({ default: m.EditorialList })))
const EditorialArticle = lazy(() => routeLoaders.editorial().then((m) => ({ default: m.EditorialArticle })))
const Favorites = lazy(() => routeLoaders.collections().then((m) => ({ default: m.Favorites })))
const History = lazy(() => routeLoaders.collections().then((m) => ({ default: m.History })))
const About = lazy(() => routeLoaders.static().then((m) => ({ default: m.About })))
const Terms = lazy(() => routeLoaders.static().then((m) => ({ default: m.Terms })))
const Privacy = lazy(() => routeLoaders.static().then((m) => ({ default: m.Privacy })))
const Contact = lazy(() => routeLoaders.static().then((m) => ({ default: m.Contact })))
const Faq = lazy(() => routeLoaders.static().then((m) => ({ default: m.Faq })))
const NotFound = lazy(() => routeLoaders.static().then((m) => ({ default: m.NotFound })))

/** Warm every route chunk right after first paint so in-app navigation
 * never depends on the network. On flaky connections (or QUIC-hostile
 * networks) the click-time chunk fetch can hang or fail → dark screen;
 * prefetching while the connection is known-good sidesteps that entirely.
 * Failed warms retry with backoff until everything is cached. */
function useWarmRouteChunks() {
  useEffect(() => {
    let disposed = false
    let delay = 2_000
    let remaining = Object.values(routeLoaders)

    const warm = async () => {
      if (disposed) return
      const failed: typeof remaining = []
      for (const load of remaining) {
        try {
          await load()
        } catch {
          failed.push(load)
        }
      }
      remaining = failed
      if (remaining.length > 0 && delay < 120_000) {
        delay *= 2
        setTimeout(() => void warm(), delay)
      }
    }

    const start = () => {
      const idle: (cb: () => void) => void =
        'requestIdleCallback' in window ? (cb) => window.requestIdleCallback(cb) : (cb) => setTimeout(cb, 1_500)
      idle(() => void warm())
    }
    if (document.readyState === 'complete') start()
    else window.addEventListener('load', start, { once: true })

    return () => {
      disposed = true
    }
  }, [])
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

/** Spinner while a route chunk loads. If the fetch is hanging (dead
 * connection, stalled QUIC socket) we say so after 6s instead of leaving
 * a dark page with a tiny spinner. */
function RouteFallback() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6_000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center" aria-busy="true">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
      {slow && (
        <>
          <p className="max-w-sm text-sm text-muted">
            Still loading — your connection seems slow. A reload usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-btn bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hi"
          >
            Reload page
          </button>
        </>
      )}
    </div>
  )
}

export default function App() {
  useWarmRouteChunks()
  return (
    <AuthProvider>
      <RegistryProvider>
        <PlayerProvider>
          <ScrollToTop />
          <AppShell walletSlot={<WalletButton />}>
            <ErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/library" element={<Library />} />
                <Route path="/release/:id" element={<ReleaseDetail />} />
                <Route path="/editorial" element={<EditorialList />} />
                <Route path="/editorial/:id" element={<EditorialArticle />} />
                <Route path="/publish" element={<Publish />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/favorites" element={<Favorites />} />
                <Route path="/history" element={<History />} />
                <Route path="/about" element={<About />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/faq" element={<Faq />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </AppShell>
        </PlayerProvider>
      </RegistryProvider>
    </AuthProvider>
  )
}
