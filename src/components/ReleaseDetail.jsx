import React, { useState } from 'react'
import {
  coverSVG, priceLabel, edLabel, royaltyLabel, fmtDate, prettyStatus, isSold, isFree,
} from '../lib/registry.js'

function CoverBig({ rel }) {
  return rel.coverUrl
    ? <div className="dcover"><img src={rel.coverUrl} alt="" /></div>
    : <div className="dcover" dangerouslySetInnerHTML={{ __html: coverSVG(rel.id || rel.title) }} />
}

export function ReleaseDetail({ rel, store, onClose }) {
  const [amt, setAmt] = useState(5)
  const sold = isSold(rel.editions)
  const date = fmtDate(rel.date)
  const status = prettyStatus(rel.status)
  const isFav = store.favorites.has(rel.id)
  const tips = rel.social ? rel.social.totalTips : 0
  const ledger = rel.social ? rel.social.ledger : []

  return (
    <div className="overlay">
      <div className="topaccent" />
      <div className="ovwrap">
        <div className="ovbar">
          <span className="logo" style={{ fontSize: 22 }} onClick={onClose}>fontainor</span>
          <button className="back" onClick={onClose}>← Back</button>
        </div>

        <div className="detail">
          <CoverBig rel={rel} />
          <div className="dinfo">
            <h1>{rel.title}</h1>
            <div className="dby">{rel.artist}{rel.label ? ' · ' + rel.label : ''}</div>
            {rel.tags.length > 0 && (
              <div className="dtags">
                {rel.tags.map((t) => <a key={t} onClick={() => (location.hash = '#/tag/' + encodeURIComponent(t))}>#{t}</a>)}
              </div>
            )}

            <div>
              <button className="dplay" onClick={() => store.play(rel)}>
                <svg width="16" height="16" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> Play
              </button>
              <button className={'dfav' + (isFav ? ' fav' : '')} onClick={() => store.toggleFav(rel.id)}>
                <svg viewBox="0 0 24 24"><path d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z" /></svg>
                {isFav ? ' Favorited' : ' Favorite'}
              </button>
            </div>

            <div className="specs">
              <div className="row"><span className="k">Copies</span><span className="v">{edLabel(rel.editions)}{sold ? ' — sold out' : ''}</span></div>
              <div className="row"><span className="k">Price</span><span className="v blue">{priceLabel(rel.price)}</span></div>
              <div className="row"><span className="k">Resale royalty to artist</span><span className="v">{royaltyLabel(rel.royaltyBps)}</span></div>
              {status && <div className="row"><span className="k">Status</span><span className="v">{status}</span></div>}
              {date && <div className="row"><span className="k">Registered</span><span className="v">{date}</span></div>}
              <div className="row"><span className="k">Arweave TX</span><span className="v">{rel.arweaveTx || 'not yet uploaded'}</span></div>
            </div>

            <div className="buyrow">
              <button className="buy" disabled={sold}>{isFree(rel) ? 'Download free' : sold ? 'Sold out' : 'Collect this edition'}</button>
              <span className="amt">{priceLabel(rel.price)}{isFree(rel) ? <span> · unlimited</span> : <span> · one-time · 100% to artist</span>}</span>
            </div>

            {/* support / pay-what-you-want */}
            <div className="support">
              <div className="sup-head">
                <span className="sup-title">Support this release</span>
                <span className="sup-total">${Number(tips).toFixed(2)} <span>raised</span></span>
              </div>
              <p className="sup-sub">Pay what you want. Support is public and goes directly to the artist (2% to the community treasury).</p>
              <div className="sup-row">
                <div className="sup-amt">$ <input type="number" min="1" step="1" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
                <button className="sup-btn" onClick={() => { const v = Number(amt); if (v > 0) store.support(rel, v) }}>Send support</button>
              </div>
              <div className="led-h">Recent support</div>
              {ledger.length
                ? <ul className="led">{ledger.slice().reverse().slice(0, 6).map((ev, i) => (
                    <li key={i}><span className="who">{ev.sender || ev.wallet || 'anonymous'}</span><span className="amt2">${Number(ev.amount || 0).toFixed(2)}</span></li>
                  ))}</ul>
                : <p className="led-empty">No public support yet — be the first.</p>}
            </div>

            {rel.desc ? <p className="desc">{rel.desc}</p> : <p className="desc empty">No description yet.</p>}

            {rel.bonus && rel.bonus.length > 0 && (
              <>
                <div className="bonus-h">Bonus material — unlocked on collect</div>
                <ul className="bonus">{rel.bonus.map((b, i) => <li key={i}>{b}</li>)}</ul>
              </>
            )}

            {(rel.profile && (rel.profile.bio || (rel.profile.links && rel.profile.links.length > 0))) && (
              <div className="prof2">
                <div className="prof2-h">About the artist</div>
                {rel.profile.bio && <p className="prof2-bio">{rel.profile.bio}</p>}
                {rel.profile.links && rel.profile.links.length > 0 && (
                  <div className="prof2-links">
                    {rel.profile.links.map((l, i) => {
                      const url = typeof l === 'string' ? l : (l.url || l.href || '')
                      const lab = typeof l === 'string' ? l : (l.label || l.name || url)
                      return url ? <a key={i} href={url} target="_blank" rel="noopener noreferrer">{lab}</a> : null
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
