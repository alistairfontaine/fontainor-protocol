import React from 'react'
import { coverSVG, priceLabel, edLabel, isSold } from '../../lib/registry.js'

const PlayIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>)
const StarIcon = () => (<svg viewBox="0 0 24 24"><path d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z" /></svg>)

// Memoized so react-window re-renders stay cheap while scrolling.
export const LibraryCard = React.memo(function LibraryCard({ rel, isFav, onOpen, onPlay, onFav }) {
  const sold = isSold(rel.editions)
  // confirmed schema: coverUri (nullable). fall back to generated SVG.
  const cover = rel.coverUrl
    ? <img src={rel.coverUrl} alt="" loading="lazy" />
    : <span style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: coverSVG(rel.id || rel.title) }} />

  return (
    <div className="lib-card" onClick={onOpen}>
      <div className="lib-cover">
        {cover}
        {sold && <span className="sold-flag">SOLD OUT</span>}
        <button className={'favmark' + (isFav ? ' fav' : '')} aria-label="Favorite"
          onClick={(e) => { e.stopPropagation(); onFav() }}><StarIcon /></button>
        <button className="playover" aria-label="Play"
          onClick={(e) => { e.stopPropagation(); onPlay() }}><PlayIcon /></button>
      </div>
      <div className="lib-l1">{rel.title}</div>
      <div className="lib-l2">{rel.artist}</div>
      <div className="lib-l3">{priceLabel(rel.price)} · {edLabel(rel.editions)}</div>
    </div>
  )
})
