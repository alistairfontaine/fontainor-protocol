import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { WalletButton } from './components/WalletButton'
import { Favorites, History } from './pages/Collections'
import { About, Contact, Faq, NotFound, Privacy, Terms } from './pages/Static'
import { EditorialArticle, EditorialList } from './pages/Editorial'
import Home from './pages/Home'
import Library from './pages/Library'
import Profile from './pages/Profile'
import Publish from './pages/Publish'
import ReleaseDetail from './pages/ReleaseDetail'
import { AuthProvider } from './state/AuthContext'
import { PlayerProvider } from './state/PlayerContext'
import { RegistryProvider } from './state/RegistryContext'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  return (
    <AuthProvider>
      <RegistryProvider>
        <PlayerProvider>
          <ScrollToTop />
          <AppShell walletSlot={<WalletButton />}>
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
          </AppShell>
        </PlayerProvider>
      </RegistryProvider>
    </AuthProvider>
  )
}
