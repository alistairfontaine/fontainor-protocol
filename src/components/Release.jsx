import React from 'react'
import { coverSVG, priceLabel, edLabel, isSold } from '../lib/registry.js'

// Cover with optional overlay children (play button, fav, sold flag)
export function CoverBox({ rel, children }) {
  return (
    <div className="cover">
      {rel.coverUrl ? <img src={rel.coverUrl} alt="" /> : <Svg html={coverSVG(rel.id || rel.title)} />}
      {children}
    </div>
  )
}
export function Svg({ html }) {
  return <span style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
}

const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
)
const StarIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z" /></svg>
)

export function ReleaseCard({ rel, isFav, onOpen, onPlay, onFav, onTag }) {
  const sold = isSold(rel.editions)
  return (
    <div className="card" onClick={onOpen}>
      <CoverBox rel={rel}>
        {sold && <span className="sold-flag">SOLD OUT</span>}
        <button className={'favmark' + (isFav ? ' fav' : '')} aria-label="Favorite"
          onClick={(e) => { e.stopPropagation(); onFav() }}><StarIcon /></button>
        <button className="playover" aria-label="Play"
          onClick={(e) => { e.stopPropagation(); onPlay() }}><PlayIcon /></button>
      </CoverBox>
      <div className="l1">{rel.artist} — {rel.title}</div>
      {rel.label && <div className="l2">{rel.label}</div>}
      {rel.tags && rel.tags.length > 0 && (
        <div className="tags">
          {rel.tags.map((t) => (
            <a key={t} onClick={(e) => { e.stopPropagation(); onTag(t) }}>#{t}</a>
          ))}
        </div>
      )}
      <div className="price">{priceLabel(rel.price)} · {edLabel(rel.editions)}</div>
    </div>
  )
}

export function ReleaseGrid({ items, store, onOpen }) {
  if (!items.length) return null
  return (
    <div className="grid">
      {items.map((rel) => (
        <ReleaseCard
          key={rel.id}
          rel={rel}
          isFav={store.favorites.has(rel.id)}
          onOpen={() => onOpen(rel)}
          onPlay={() => store.play(rel)}
          onFav={() => store.toggleFav(rel.id)}
          onTag={(t) => (location.hash = '#/tag/' + encodeURIComponent(t))}
        />
      ))}
    </div>
  )
}

export function Skeleton({ n = 8 }) {
  return (
    <div className="sk-grid">
      {Array.from({ length: n }).map((_, i) => (
        <div className="sk-card" key={i}>
          <div className="sk-cover" />
          <div className="sk-l" />
          <div className="sk-l short" />
        </div>
      ))}
    </div>
  )
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}
