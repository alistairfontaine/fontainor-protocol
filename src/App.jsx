import React, { useState, useEffect, useCallback } from 'react'
import { useStore } from './hooks/useStore.js'
import { useAudioUploader } from './hooks/useAudioUploader.js'
import { Sidebar, TopNav } from './components/Nav.jsx'
import { Player } from './components/Player.jsx'
import { ReleaseDetail } from './components/ReleaseDetail.jsx'
import { AuthModal, PublishModal } from './components/Modals.jsx'
import { Toast } from './components/Toast.jsx'
import { LibraryView } from './components/library/LibraryView.jsx'
import {
  BrowsePage, PostsPage, FavoritesPage, HistoryPage, PopularTagsPage,
  EditorialPage, InsightsPage, IcebergPage, OfframpPage, TextPage, ProfilePage,
} from './components/Pages.jsx'
import { ReleaseGrid, Empty } from './components/Release.jsx'

const FULL = ['iceberg', 'profile'] // pages with no left sidebar

function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.replace(/^#\/?/, '') || 'following')
  useEffect(() => {
    const on = () => { setRoute(location.hash.replace(/^#\/?/, '') || 'following') }
    window.addEventListener('hashchange', on)
    if (!location.hash) location.hash = '#/following'
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export default function App() {
  const store = useStore()
  const uploader = useAudioUploader() // 🔒 FIXED: Declared unconditionally at the component top level
  const route = useHashRoute()
  const [detail, setDetail] = useState(null)        // rel or null
  const [auth, setAuth] = useState(null)            // 'login' | 'signup' | null
  const [pub, setPub] = useState(false)


  const [base, param] = route.split('/')

  // close detail when route changes
  useEffect(() => { setDetail(null) }, [route])

  const openAuth = useCallback((mode) => setAuth(mode || 'login'), [])
  // expose for the ProfilePage gate link
  useEffect(() => { window.__openAuth = openAuth; return () => { delete window.__openAuth } }, [openAuth])

  const onPublish = useCallback(() => {
    if (!store.user) { setAuth('login'); return }
    setPub(true)
  }, [store.user])

  const onWritePost = useCallback(() => {
    if (!store.user) { setAuth('login'); return }
    alert('Posts are coming soon. Your account is set up to write them.')
  }, [store.user])

  // esc closes layers
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { setDetail(null); setAuth(null); setPub(false) } }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])

  const open = (rel) => setDetail(rel)

  const renderPage = () => {
    switch (base) {
      case 'following': return <BrowsePage store={store} onOpen={open} title="Following" sub="Releases and posts from accounts, hubs, and tags you follow." tabs emptyMsg="Nothing in your feed yet." />
      case 'recent-posts': return <PostsPage />
      case 'recent-releases': return <BrowsePage store={store} onOpen={open} title="Recent Releases" sub="The latest releases published on Fontainor." emptyMsg="No releases yet." />
      case 'discover': return <BrowsePage store={store} onOpen={open} title="Discover" sub="Personalized recommendations based on your listening." emptyMsg="Play some music and recommendations will appear." />
      case 'staff-picks': return <BrowsePage store={store} onOpen={open} title="Staff Picks" sub="Selections from the Fontainor team." emptyMsg="No staff picks yet." />
      case 'now-listening': return <BrowsePage store={store} onOpen={open} title="Now Listening" sub="What people are listening to right now on Fontainor." emptyMsg="Nobody's listening right now." />
      case 'explore': return <BrowsePage store={store} onOpen={open} title="Explore" sub="Browse everything on Fontainor." emptyMsg="Nothing to explore yet." />
      case 'library': return <LibraryView store={store} onOpen={open} />
      case 'editorial': return <EditorialPage store={store} onOpen={open} />
      case 'popular-tags': return <PopularTagsPage store={store} onOpen={open} />
      case 'favorites': return <FavoritesPage store={store} onOpen={open} />
      case 'history': return <HistoryPage store={store} onOpen={open} />
      case 'insights': return <InsightsPage store={store} />
      case 'iceberg': return <IcebergPage />
      case 'offramp': return <OfframpPage />
      case 'profile': return <ProfilePage store={store} onOpen={open} onPublish={onPublish} />
      case 'tag': {
        const t = decodeURIComponent(param || '')
        const list = store.releases.filter((r) => r.tags.includes(t))
        return <BrowsePageFiltered store={store} onOpen={open} title={'#' + t} sub={'Releases tagged ' + t + '.'} items={list} emptyMsg="No releases with this tag yet." />
      }
      case 'about': return <TextPage title="About" body="Fontainor is an open, artist-owned music registry. Releases live permanently on Arweave; payments settle on Solana. No central authority can take your music down." />
      case 'faq': return <TextPage title="FAQ" body="Coming soon." />
      case 'terms': return <TextPage title="Terms" body="Coming soon." />
      case 'for-artists': return <TextPage title="Fontainor for artists" body="Publish your music, keep 100% of sales, and reach listeners directly. Coming soon." />
      case 'for-labels': return <TextPage title="Fontainor for labels" body="Tools for labels to manage rosters and releases. Coming soon." />
      case 'settings': return <TextPage title="Settings" body={store.user ? 'Account settings coming soon.' : 'Log in to manage settings.'} />
      default: return <BrowsePage store={store} onOpen={open} title="Following" sub="Releases and posts from accounts, hubs, and tags you follow." tabs emptyMsg="Nothing in your feed yet." />
    }
  }

  return (
    <>
      <div className="topaccent" />
      <TopNav store={store} route={route} onAuth={openAuth} onPublish={onPublish} />
      <div className={'app' + (FULL.includes(base) ? ' full' : '')}>
        {!FULL.includes(base) && <Sidebar route={route} onPublish={onPublish} onWritePost={onWritePost} />}
        {renderPage()}
      </div>

      <Player store={store} />
      <Toast toast={store.toast} onClose={store.dismissToast} />

      {detail && <ReleaseDetail rel={detail} store={store} onClose={() => setDetail(null)} />}
      {auth && <AuthModal store={store} mode={auth} setMode={setAuth} onClose={(go) => { setAuth(null); if (go) location.hash = '#/' + go }} />}
      {pub && <PublishModal store={store} uploader={uploader} onClose={(go) => { setPub(false); if (go) location.hash = '#/' + go }} />}
    </>
  )
}


// small variant for the tag route (passes explicit items)
function BrowsePageFiltered({ store, onOpen, title, sub, items, emptyMsg }) {
  return (
    <main>
      <h1 className="page">{title}</h1>
      <p className="sub">{sub}</p>
      {items.length ? <ReleaseGrid items={items} store={store} onOpen={onOpen} /> : <Empty>{emptyMsg}</Empty>}
    </main>
  )
}
