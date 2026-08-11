import React, { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { WalletButton } from './components/WalletButton'
import Home from './pages/Home'
import Library from './pages/Library'
import Search from './pages/Search'
import ReleaseDetail from './pages/ReleaseDetail'
import Publish from './pages/Publish'
import Profile from './pages/Profile'
import { EditorialList, EditorialArticle } from './pages/Editorial'
import { Playlists, PlaylistDetail } from './pages/Playlists'
import { Collection, Favorites, History } from './pages/Collections'
import { About, Terms, Privacy, Contact, Faq, NotFound } from './pages/Static'
import { Support } from './pages/Support'
import { AndroidApp } from './pages/AndroidApp'
import { AndroidBanner } from './components/AndroidBanner'
import { AuthProvider } from './state/AuthContext'
import { PlayerProvider } from './state/PlayerContext'
import { RegistryProvider, useRegistry } from './state/RegistryContext'
import { useAutoDownloadLikes } from './lib/autoDownload'

// NO route-level code splitting. All pages together are ~46 KB minified —
// splitting them saved nothing but made every navigation depend on a
// network fetch, which on flaky/QUIC-hostile connections stalls or fails
// → black screen (chunk-error auto-reload then stalls again on the same
// bad connection). Bundling everything means that once the app has
// painted, navigation can never hit the network. Keep it this way unless
// a single route grows genuinely heavy (>150 KB), and if you re-split,
// the failure mode below must be re-solved.

/** Remounts (and thus re-animates) its children on every route change. */
function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <div key={pathname} className="page-in">
      {children}
    </div>
  )
}

/** Auto-download newly-liked releases (native, opt-in). Needs the registry, so it lives under RegistryProvider. */
function AutoDownloadLikes() {
  const { music } = useRegistry()
  useAutoDownloadLikes(music)
  return null
}

function ScrollToTop() {
  const { pathname } = useLocation()
  // Body MUST be a block, never `() => window.scrollTo(...)`: an implicit
  // return hands scrollTo's return value to React as the effect CLEANUP.
  // Stock browsers return undefined, but smooth-scroll extensions patch
  // window.scrollTo to return a truthy object — React then calls it on the
  // next navigation → "TypeError: n is not a function" crash (seen live on
  // #/library, 2026-07-26). Same rule for every effect in this codebase.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <RegistryProvider>
        <PlayerProvider>
          <ScrollToTop />
          <AutoDownloadLikes />
          <AppShell walletSlot={<WalletButton />}>
            <ErrorBoundary>
              {/* Promo banner sits OUTSIDE PageTransition so it doesn't
                  re-animate on every navigation (and it self-hides inside the
                  native app via the Capacitor check in androidApp.ts). */}
              <AndroidBanner />
              <PageTransition>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/library" element={<Library />} />
                <Route path="/search" element={<Search />} />
                <Route path="/release/:id" element={<ReleaseDetail />} />
                <Route path="/editorial" element={<EditorialList />} />
                <Route path="/editorial/:id" element={<EditorialArticle />} />
                <Route path="/publish" element={<Publish />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/collection" element={<Collection />} />
                <Route path="/favorites" element={<Favorites />} />
                <Route path="/playlists" element={<Playlists />} />
                <Route path="/playlists/:id" element={<PlaylistDetail />} />
                <Route path="/history" element={<History />} />
                <Route path="/about" element={<About />} />
                <Route path="/support" element={<Support />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/faq" element={<Faq />} />
                <Route path="/android" element={<AndroidApp />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </PageTransition>
            </ErrorBoundary>
          </AppShell>
        </PlayerProvider>
      </RegistryProvider>
    </AuthProvider>
  )
}
