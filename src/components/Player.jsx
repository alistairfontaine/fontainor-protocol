import React from 'react'
import { fmtTime, prettyStatus, coverSVG } from '../lib/registry.js'
import { resolveAudioUri } from '../lib/api.js'


function NpCover({ rel }) {
  // Safe-resolve the image URI map if it's hosted on a local block ledger track
  const coverSource = rel.coverUrl || rel.coverUri || '';
  const resolvedCover = resolveAudioUri(coverSource);

  return (
    <div className="npcover">
      {resolvedCover ? <img src={resolvedCover} alt="" /> : <span style={{ position: 'absolute', inset: 0 }} dangerouslySetInnerHTML={{ __html: coverSVG(rel.id || rel.title) }} />}
    </div>
  )
}


export function Player({ store }) {
  const { current, playing, pos, cur, dur } = store
  if (!current) return null
  const labelTxt = current.label || prettyStatus(current.status) || ''
  const isFav = store.favorites.has(current.id)

  return (
    <div className="playerbar">
      <div className="np">
        <NpCover rel={current} />
        <div className="npmeta">
          <div className="npt"><b>{current.title}</b> <span>/ {current.artist}</span></div>
          {labelTxt && <div className="npl"><a onClick={(e) => e.preventDefault()}>{labelTxt}</a></div>}
        </div>
      </div>

      <div className="pmid">
        <span className="t">{fmtTime(cur)}</span>
        <div className="pbar" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          store.seek((e.clientX - r.left) / r.width)
        }}>
          <div className="pfill" style={{ width: pos * 100 + '%' }} />
          <div className="pknob" style={{ left: pos * 100 + '%' }} />
        </div>
        <span className="t">{fmtTime(dur)}</span>
      </div>

      <div className="pbtns">
        <button onClick={store.prev} aria-label="Previous">
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 6h2v12H6zM20 6v12l-9-6z" /></svg>
        </button>
        <button className="play" onClick={store.toggle} aria-label="Play/Pause">
          <svg width="26" height="26" viewBox="0 0 24 24">
            <path d={playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z'} />
          </svg>
        </button>
        <button onClick={store.next} aria-label="Next">
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM4 6l9 6-9 6z" /></svg>
        </button>
        <button className={'star' + (isFav ? ' fav' : '')} onClick={() => store.toggleFav(current.id)} aria-label="Favorite">
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 17.3l-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.4 4.8 1.6 7z" /></svg>
        </button>
      </div>
    </div>
  )
}
