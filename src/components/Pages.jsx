import React, { useState } from 'react'
import { ReleaseGrid, Skeleton, Empty } from './Release.jsx'
import { avatarSVG, coverSVG } from '../lib/registry.js'

function Head({ title, sub }) {
  return (<><h1 className="page">{title}</h1>{sub && <p className="sub">{sub}</p>}</>)
}

function Banner({ store }) {
  const { source, repaired } = store
  const api = new URLSearchParams(location.search).get('api') || 'http://localhost:3000'
  const items = []
  if (source === 'api') items.push(<div className="loadnote ok" key="s">Connected to the backend at <code>{api}</code> — data is live from the API.</div>)
  else if (source === 'file') items.push(<div className="loadnote info" key="s">Backend not reachable at <code>{api}</code>. Falling back to local <code>registry.json</code>. Start the server (and enable CORS) to go live.</div>)
  else if (source === 'sample') items.push(<div className="loadnote info" key="s">Showing the built-in sample (no backend and no <code>registry.json</code> reachable yet).</div>)
  if (repaired) items.push(<div className="loadnote warn" key="r">The registry had a JSON error (<code>{'}{'}</code>) auto-repaired for preview only. Fix the source before going live.</div>)
  return <>{items}</>
}

// generic browse page
export function BrowsePage({ store, onOpen, title, sub, tabs, emptyMsg }) {
  const items = store.releases
  return (
    <main>
      <Banner store={store} />
      <Head title={title} sub={sub} />
      {tabs && (
        <div className="tabs">
          <button className="on">All</button>
          <button onClick={() => (location.hash = '#/recent-releases')}>Releases</button>
          <button onClick={() => (location.hash = '#/recent-posts')}>Posts</button>
        </div>
      )}
      {store.loading ? <Skeleton /> : items.length ? <ReleaseGrid items={items} store={store} onOpen={onOpen} /> : <Empty>{emptyMsg}</Empty>}
    </main>
  )
}

export function PostsPage() {
  return (
    <main>
      <Head title="Recent Posts" sub="The latest articles published on Fontainor." />
      <Empty>No posts yet. Posts are short articles artists write about their music and discoveries.<br /><br /><b>Be the first</b> — use <b>+ New release</b> or the post button in the sidebar.</Empty>
    </main>
  )
}

export function FavoritesPage({ store, onOpen }) {
  const items = [...store.favorites].map((id) => store.releases.find((r) => r.id === id)).filter(Boolean)
  return (
    <main>
      <Head title="Favorites" sub="Your favorited releases and posts." />
      {items.length ? <ReleaseGrid items={items} store={store} onOpen={onOpen} /> : <Empty>You haven’t favorited anything yet. Tap the ☆ on any release to save it here.</Empty>}
    </main>
  )
}

export function HistoryPage({ store, onOpen }) {
  const items = store.history.map((id) => store.releases.find((r) => r.id === id)).filter(Boolean)
  return (
    <main>
      <Head title="History" sub="Your recently played releases." />
      {items.length ? <ReleaseGrid items={items} store={store} onOpen={onOpen} /> : <Empty>Nothing played yet. Hit play on any release and it’ll show up here.</Empty>}
    </main>
  )
}

export function PopularTagsPage({ store, onOpen }) {
  const map = {}
  store.releases.forEach((r) => r.tags.forEach((t) => { (map[t] = map[t] || []).push(r) }))
  const tags = Object.keys(map)
  return (
    <main>
      <Head title="Popular Tags" sub="The most popular tags on Fontainor right now." />
      {tags.length === 0
        ? <Empty>No tagged releases yet. Add a <code>"tags": ["ambient","electronic"]</code> array to a release and it’ll be grouped here by genre.</Empty>
        : (
          <div className="tagcols">
            {tags.map((t) => (
              <div className="tagcol" key={t}>
                <h3>{t} ›</h3>
                {map[t].map((r) => (
                  <div className="tagrow" key={r.id + r.title} onClick={() => onOpen(r)}>
                    <div className="th" dangerouslySetInnerHTML={{ __html: r.coverUrl ? `<img src="${r.coverUrl}">` : coverSVG(r.id) }} />
                    <div><div className="tt">{r.title}</div><div className="ta">{r.artist}</div></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
    </main>
  )
}

export function EditorialPage({ store, onOpen }) {
  const list = store.releases
  return (
    <main>
      <Head title="Editorial" sub="Features, reviews, and picks from the Fontainor community." />
      {list.length ? (
        <>
          <div className="ed-sec-h">Staff Picks ›</div>
          <div className="ed-row">
            {list.map((r) => (
              <div className="ed-card" key={r.id + r.title} onClick={() => onOpen(r)}>
                <div className="cv" dangerouslySetInnerHTML={{ __html: r.coverUrl ? `<img src="${r.coverUrl}">` : coverSVG(r.id) }} />
                <div className="t">{r.artist} - {r.title}</div>
                <div className="d">{r.desc || 'Featured on Fontainor.'}</div>
                <div className="src">Staff Picks</div>
                {r.tags.length > 0 && <div className="tags">{r.tags.map((t) => <a key={t} onClick={(e) => { e.stopPropagation(); location.hash = '#/tag/' + encodeURIComponent(t) }}>#{t}</a>)}</div>}
              </div>
            ))}
          </div>
          <div className="ed-sec-h">Community Picks ›</div>
          <Empty>No community picks yet.</Empty>
        </>
      ) : <Empty>No editorial features yet.</Empty>}
    </main>
  )
}

export function InsightsPage({ store }) {
  const [tab, setTab] = useState('community')
  const handle = store.user ? store.user.handle : '@guest'
  const plays = store.history.length
  const favs = store.favorites.size
  return (
    <main>
      <h1 className="page">Insights</h1>
      <p className="sub" style={{ color: 'var(--gray)' }}>{handle}</p>
      <div className="ins-top">
        <select><option>Last 7 days</option><option>Last 30 days</option><option>All time</option></select>
        <span className="ghost" onClick={() => (location.hash = '#/offramp')}>Open wallet</span>
      </div>
      <div className="ins-tabs">
        <button className={tab === 'community' ? 'on' : ''} onClick={() => setTab('community')}>COMMUNITY</button>
        <button className={tab === 'publisher' ? 'on' : ''} onClick={() => setTab('publisher')}>PUBLISHER</button>
      </div>
      {tab === 'community' ? (
        <>
          <div className="ins-panel">
            <div className="lead">Here’s how your shares have impacted the Fontainor community. <a onClick={(e) => e.preventDefault()}>Learn more about Community Revenue Share.</a></div>
            <div className="ins-stats">
              <div className="st"><div className="k">Plays</div><div className="v">{plays}</div><div className="d">{plays ? '+100%' : '—'}</div></div>
              <div className="st"><div className="k">Follows</div><div className="v">0</div></div>
              <div className="st"><div className="k">Favorites</div><div className="v">{favs}</div></div>
              <div className="st"><div className="k">Users</div><div className="v">0</div></div>
            </div>
          </div>
          <div className="ins-panel">
            <div className="lead">Your shares have resulted in the following earnings through the Community Revenue Share:</div>
            <div className="ins-stats">
              {['Artist', 'Artist Referrer', 'Collector Referrer', 'First Collector', 'Sale Referrer', 'Total'].map((k) => (
                <div className="st" key={k}><div className="k">{k}</div><div className="v">$0.00</div></div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="ins-panel">
          <div className="lead">Publisher insights for your own releases.</div>
          <div className="ins-stats">
            <div className="st"><div className="k">Plays</div><div className="v">{plays}</div></div>
            <div className="st"><div className="k">Collects</div><div className="v">0</div></div>
            <div className="st"><div className="k">Earnings</div><div className="v">$0.00</div></div>
          </div>
        </div>
      )}
    </main>
  )
}

const ICE_TIERS = [
  ['indie', 'ambient', 'alternative', 'electronic', 'indietronica', 'experimental', 'pop', 'shoegaze'],
  ['downtempo', 'electronica', 'emo', 'house', 'indierock', 'folk', 'dance', 'twee', 'rock', 'alternativerock', 'dreampop', 'cloudrock', 'techno', 'guitar'],
  ['triphop', 'singer-songwriter', 'ambientpop', 'drone', 'postpunk', 'dub', 'instrumental', 'lofi', 'slowcore', 'artpop', 'synthpop', 'acoustic'],
  ['altpop', 'hyperpop', 'footwork', 'club', 'underground', 'sophistipop', 'jungle', 'cloudfolk', 'grunge', 'folktronica', 'ambient-pop', 'electro'],
  ['witchhouse', 'experimentalhiphop', 'laptop-twee', 'glitch', 'bass', 'hailfunk', 'piano', 'hiphop', 'trance', 'leftfield', 'noise'],
]
function seedNum(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }
function faceSVG(level) {
  const eyes = level < 2 ? '<circle cx="36" cy="42" r="3"/><circle cx="64" cy="42" r="3"/>'
    : level < 3 ? '<circle cx="36" cy="42" r="4"/><circle cx="64" cy="42" r="4"/>'
      : '<circle cx="36" cy="40" r="6" fill="#fff" stroke="#111" stroke-width="2"/><circle cx="64" cy="40" r="6" fill="#fff" stroke="#111" stroke-width="2"/><circle cx="36" cy="40" r="2.5"/><circle cx="64" cy="40" r="2.5"/>'
  const mouth = level < 1 ? '<path d="M36 60 Q50 70 64 60" fill="none" stroke="#111" stroke-width="2.5"/>'
    : level < 2 ? '<line x1="38" y1="62" x2="62" y2="62" stroke="#111" stroke-width="2.5"/>'
      : level < 3 ? '<path d="M38 64 Q50 56 62 64" fill="none" stroke="#111" stroke-width="2.5"/>'
        : '<ellipse cx="50" cy="64" rx="9" ry="6" fill="#111"/>'
  const hair = level < 3 ? '' : '<path d="M22 30 l8 -8 6 8 6 -10 6 10 6 -8 8 8" fill="none" stroke="#111" stroke-width="2"/>'
  return `<svg width="64" height="64" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="#fff" stroke="#111" stroke-width="2"/>${hair}${eyes}${mouth}</svg>`
}
export function IcebergPage() {
  const [t, setT] = useState('24 Hours')
  return (
    <main>
      <h1 className="page" style={{ marginBottom: 4 }}>The Official Genre Iceberg</h1>
      <p className="sub">A real time pulse of the underground — how deep does your taste go?</p>
      <div style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 4 }}>Click tags to explore · Toggle to see trends over time</div>
      <div className="ice-toggles">
        {['1 Hour', '6 Hours', '24 Hours', '7 Days', 'All Time'].map((x) => (
          <button key={x} className={t === x ? 'on' : ''} onClick={() => setT(x)}>{x}</button>
        ))}
      </div>
      <div className="iceberg">
        <div className="ice-main">
          <span className="ice-share">SHARE</span>
          {ICE_TIERS.map((tier, ti) => {
            const topPct = 8 + ti * 19
            const size = 22 - ti * 2.6
            return tier.map((w, wi) => {
              const leftPct = (100 / (tier.length + 1)) * (wi + 1) + ((seedNum(w) % 10) - 5)
              const jitter = (seedNum(w + ti) % 8) - 4
              return (
                <span className="ice-tag" key={w + ti}
                  style={{ left: leftPct.toFixed(1) + '%', top: (topPct + jitter).toFixed(1) + '%', fontSize: size.toFixed(1) + 'px', fontWeight: ti < 2 ? 600 : 400 }}>
                  {w}
                </span>
              )
            })
          })}
        </div>
        <div className="ice-faces">
          {[0, 1, 2, 3, 4].map((i) => <div className="ice-face" key={i} dangerouslySetInnerHTML={{ __html: faceSVG(i) }} />)}
        </div>
      </div>
    </main>
  )
}

export function OfframpPage() {
  return (
    <main>
      <Head title="Offramp" sub="Cash out your USDC earnings to your bank. No middle-man fees." />
      <div className="off-card">
        <div className="lbl">Available balance</div>
        <div className="off-bal">$0.00</div>
        <div className="lbl">USDC on Solana</div>
        <button disabled>Withdraw to bank</button>
        <div className="lbl" style={{ marginTop: 14 }}>Nothing to withdraw yet. Earnings from sales and support appear here.</div>
      </div>
    </main>
  )
}

export function TextPage({ title, body }) {
  return (<main><Head title={title} /><Empty>{body}</Empty></main>)
}

export function ProfilePage({ store, onOpen, onPublish }) {
  const [tab, setTab] = useState('releases')
  if (!store.user) {
    return (
      <main>
        <Head title="Profile" />
        <Empty>You’re not signed in. <a onClick={() => (window.__openAuth && window.__openAuth('login'))}>Log in or create an account</a> to see your profile, releases, supporters, and earnings.</Empty>
      </main>
    )
  }
  const u = store.user
  const list = store.releases
  const plays = store.history.length
  const favs = store.favorites.size
  const tabs = [['releases', `RELEASES (${list.length})`], ['hubs', 'HUBS (0)'], ['posts', 'POSTS (0)'], ['favorites', `FAVORITES (${favs})`], ['collection', 'COLLECTION (0)'], ['history', `HISTORY (${plays})`], ['scheduled', 'SCHEDULED']]
  let body
  if (tab === 'releases') body = list.length ? <ReleaseGrid items={list} store={store} onOpen={onOpen} /> : <Empty>No releases yet. <a onClick={onPublish}>Register your first release.</a></Empty>
  else if (tab === 'favorites') { const fl = [...store.favorites].map((id) => store.releases.find((r) => r.id === id)).filter(Boolean); body = fl.length ? <ReleaseGrid items={fl} store={store} onOpen={onOpen} /> : <Empty>No favorites yet.</Empty> }
  else if (tab === 'history') { const hl = store.history.map((id) => store.releases.find((r) => r.id === id)).filter(Boolean); body = hl.length ? <ReleaseGrid items={hl} store={store} onOpen={onOpen} /> : <Empty>No history yet.</Empty> }
  else body = <Empty>Nothing here yet.</Empty>

  return (
    <main>
      <div className="pf">
        <div>
          <div className="pf-av" dangerouslySetInnerHTML={{ __html: avatarSVG(u.handle) }} />
          <h1>{u.name}</h1>
          <div className="pf-btns">
            <button onClick={() => (location.hash = '#/offramp')}>Wallet</button>
            <button onClick={() => (location.hash = '#/settings')}>Settings</button>
            <button onClick={store.logout}>Log out</button>
          </div>
          <div className="pf-mini">
            <button className="blue" onClick={() => list.length && store.play(list[0])}><svg width="16" height="16" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></button>
            <button aria-label="Queue"><svg width="16" height="16" viewBox="0 0 24 24" fill="#1c1c1e"><path d="M3 6h13v2H3zM3 11h13v2H3zM3 16h9v2H3zM19 8l4 4-4 4z" /></svg></button>
            <button className="shareb">Share</button>
          </div>
          <div className="prof2-h" style={{ marginTop: 8 }}>INSIGHTS</div>
          <div className="ins-top">
            <select><option>Last 7 days</option></select>
            <span className="ghost" onClick={() => (location.hash = '#/insights')}>View all insights</span>
          </div>
          <div className="ins-panel">
            <div className="lead">Here are stats about your releases:</div>
            <div className="ins-stats">
              <div className="st"><div className="k">Plays</div><div className="v">{plays}</div></div>
              <div className="st"><div className="k">Favorites</div><div className="v">{favs}</div></div>
              <div className="st"><div className="k">Collects</div><div className="v">0</div></div>
              <div className="st"><div className="k">Earnings</div><div className="v">$0.00</div></div>
            </div>
          </div>
          <div className="pf-tabs">
            {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {body}
        </div>
        <div className="rail">
          <div className="blk"><h4>About</h4><div style={{ fontSize: 14, color: 'var(--gray-d)' }}>{u.via === 'wallet' ? 'Connected via Solana wallet' : u.handle}</div></div>
          <div className="blk"><h4>Top Supporters</h4><div className="avrow">{Array.from({ length: 6 }).map((_, i) => <div className="a" key={i} dangerouslySetInnerHTML={{ __html: avatarSVG('sup' + i) }} />)}</div></div>
          <div className="blk"><h4>Followers (0)</h4><div className="empty" style={{ padding: '6px 0', fontSize: 13 }}>No followers yet.</div></div>
          <div className="blk"><h4>Following (0)</h4><div className="empty" style={{ padding: '6px 0', fontSize: 13 }}>Not following anyone yet.</div></div>
        </div>
      </div>
    </main>
  )
}
