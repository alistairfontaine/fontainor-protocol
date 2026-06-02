import React from 'react'

export function LibraryToolbar({ lib }) {
  return (
    <div className="lib-toolbar">
      <div className="lib-search">
        <input
          type="text"
          placeholder="Search title, artist, or #tag"
          value={lib.query}
          onChange={(e) => lib.setQuery(e.target.value)}
        />
        {lib.query && (
          <button className="lib-clear" onClick={() => lib.setQuery('')} aria-label="Clear">×</button>
        )}
      </div>

      <div className="lib-controls">
        <select className="lib-select" value={lib.sort} onChange={(e) => lib.setSort(e.target.value)}>
          <option value="newest">Newest</option>
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
          <option value="price">Price</option>
        </select>

        <div className="lib-pills">
          {[['all', 'All'], ['free', 'Free'], ['sale', 'For sale'], ['sold', 'Sold out']].map(([k, label]) => (
            <button
              key={k}
              className={'lib-pill' + (lib.filter === k ? ' on' : '')}
              onClick={() => lib.setFilter(k)}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="lib-count">
        {lib.shown === lib.total
          ? <>{lib.total} {lib.total === 1 ? 'release' : 'releases'}</>
          : <>{lib.shown} of {lib.total}</>}
      </div>
    </div>
  )
}
