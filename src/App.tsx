import { Suspense, lazy, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { WalletButton } from './components/WalletButton'
import Home from './pages/Home'
import { AuthProvider } from './state/AuthContext'
import { PlayerProvider } from './state/PlayerContext'
import { RegistryProvider } from './state/RegistryContext'

// Route-level code splitting: Home stays in the main chunk (first paint),
// everything else loads on demand.
const Library = lazy(() => import('./pages/Library'))
const ReleaseDetail = lazy(() => import('./pages/ReleaseDetail'))
const Publish = lazy(() => import('./pages/Publish'))
const Profile = lazy(() => import('./pages/Profile'))
const EditorialList = lazy(() => import('./pages/Editorial').then((m) => ({ default: m.EditorialList })))
const EditorialArticle = lazy(() => import('./pages/Editorial').then((m) => ({ default: m.EditorialArticle })))
const Favorites = lazy(() => import('./pages/Collections').then((m) => ({ default: m.Favorites })))
const History = lazy(() => import('./pages/Collections').then((m) => ({ default: m.History })))
const About = lazy(() => import('./pages/Static').then((m) => ({ default: m.About })))
const Terms = lazy(() => import('./pages/Static').then((m) => ({ default: m.Terms })))
const Privacy = lazy(() => import('./pages/Static').then((m) => ({ default: m.Privacy })))
const Contact = lazy(() => import('./pages/Static').then((m) => ({ default: m.Contact })))
const Faq = lazy(() => import('./pages/Static').then((m) => ({ default: m.Faq })))
const NotFound = lazy(() => import('./pages/Static').then((m) => ({ default: m.NotFound })))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <RegistryProvider>
        <PlayerProvider>
          <ScrollToTop />
          <AppShell walletSlot={<WalletButton />}>
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
          </AppShell>
        </PlayerProvider>
      </RegistryProvider>
    </AuthProvider>
  )
}
