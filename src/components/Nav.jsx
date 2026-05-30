import React, { useState, useEffect } from 'react'

const NAV = [
  ['following', 'Following'],
  ['recent-posts', 'Recent Posts'],
  ['recent-releases', 'Recent Releases'],
  ['discover', 'Discover'],
  ['staff-picks', 'Staff Picks'],
  ['now-listening', 'Now Listening'],
  ['editorial', 'Editorial'],
  ['popular-tags', 'Popular Tags'],
]

export function Sidebar({ route, onPublish, onWritePost }) {
  const base = route.split('/')[0]
  const A = ([key, label]) => (
    <a key={key} className={base === key ? 'on' : ''} onClick={() => (location.hash = '#/' + key)}>{label}</a>
  )
  return (
    <aside>
      <div className="grp">{NAV.map(A)}</div>
      <div className="grp">{A(['explore', 'Explore'])}</div>
      <div className="grp">
        {A(['favorites', 'Favorites'])}
        {A(['history', 'History'])}
        {A(['insights', 'Insights'])}
      </div>
      <div className="pub">
        <h4>Share your voice</h4>
        <p>Write about your music, discoveries, and more.</p>
        <button onClick={onWritePost}>Write a post</button>
        <button className="ghost" onClick={onPublish}>+ New release</button>
      </div>
    </aside>
  )
}

export function TopNav({ store, route, onAuth, onPublish }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const base = route.split('/')[0]
  useEffect(() => {
    const close = () => setMenuOpen(false)
    if (menuOpen) { document.addEventListener('click', close); return () => document.removeEventListener('click', close) }
  }, [menuOpen])

  const goto = (r) => () => { location.hash = '#/' + r; setMenuOpen(false) }

  return (
    <header>
      <div className="topbar">
        <span className="logo" onClick={() => (location.hash = '#/following')}>fontainor</span>
        <input className="search" placeholder="Search by release, tag, user, hub, or post" />
        <nav className="topnav">
          <span className="num">0</span>
          <a className={base === 'editorial' ? 'on' : ''} onClick={() => (location.hash = '#/editorial')}>Editorial</a>
          <a className={base === 'offramp' ? 'on' : ''} onClick={() => (location.hash = '#/offramp')}>Offramp</a>
          <a className={base === 'iceberg' ? 'on' : ''} onClick={() => (location.hash = '#/iceberg')}>Iceberg</a>
          {store.user
            ? <a className={base === 'profile' ? 'on' : ''} onClick={() => (location.hash = '#/profile')}>Profile</a>
            : <>
                <button className="login" onClick={() => onAuth('login')}>Log in</button>
                <button className="signup" onClick={() => onAuth('signup')}>Sign up</button>
              </>}
          <button className="dots" onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}>···</button>
        </nav>
      </div>
      {menuOpen && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          <a onClick={goto('insights')}>Insights</a>
          <a onClick={goto('about')}>About</a>
          <a onClick={goto('faq')}>FAQ</a>
          <a onClick={goto('terms')}>Terms</a>
          <div className="sep" />
          <a onClick={goto('for-artists')}>Fontainor for artists</a>
          <a onClick={goto('for-labels')}>Fontainor for labels</a>
          <a onClick={() => { onPublish(); setMenuOpen(false) }}>+ New release</a>
          <div className="sep" />
          <a onClick={goto('settings')}>Settings</a>
          {store.user
            ? <a onClick={() => { store.logout(); setMenuOpen(false); location.hash = '#/following' }}>Log out</a>
            : <a onClick={() => { onAuth('login'); setMenuOpen(false) }}>Log in</a>}
        </div>
      )}
    </header>
  )
}
