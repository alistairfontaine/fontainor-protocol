import React, { useRef, useState, useEffect } from 'react'
import { FixedSizeGrid } from 'react-window'
import { LibraryCard } from './LibraryCard.jsx'

const MIN_COL = 200      // min card width (px) -> determines column count
const GAP = 22
const CARD_EXTRA = 86    // space under the square cover for title/artist/price
const ROW_H_RATIO = 1    // cover is square

// Renders only the cells visible in the viewport; scrolls 500+ items with ~constant DOM.
export function LibraryGrid({ items, store, onOpen, height = 620 }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)

  // measure available width (responsive columns) without an extra dep
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width))
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // compute columns + cell size from the measured width
  const cols = Math.max(1, Math.floor((width + GAP) / (MIN_COL + GAP))) || 1
  const colWidth = width ? Math.floor((width - GAP * (cols - 1)) / cols) : MIN_COL
  const cellW = colWidth + GAP
  const rowH = Math.floor(colWidth * ROW_H_RATIO) + CARD_EXTRA + GAP
  const rowCount = Math.ceil(items.length / cols)

  // plain inner component (react-window already optimizes cell rendering)
  const Cell = ({ columnIndex, rowIndex, style }) => {
    const idx = rowIndex * cols + columnIndex
    if (idx >= items.length) return null
    const rel = items[idx]
    const cellStyle = {
      ...style,
      width: style.width - GAP,
      height: style.height - GAP,
    }
    return (
      <div style={cellStyle}>
        <LibraryCard
          rel={rel}
          isFav={store.favorites.has(rel.id)}
          onOpen={() => onOpen(rel)}
          onPlay={() => store.play(rel)}
          onFav={() => store.toggleFav(rel.id)}
        />
      </div>
    )
  }

  return (
    <div ref={wrapRef} className="lib-grid-wrap">
      {!items.length ? (
        <div className="empty">No releases match. Try a different search or filter.</div>
      ) : width > 0 ? (
        <FixedSizeGrid
          columnCount={cols}
          columnWidth={cellW}
          rowCount={rowCount}
          rowHeight={rowH}
          height={height}
          width={width}
          overscanRowCount={2}
        >
          {Cell}
        </FixedSizeGrid>
      ) : null}
    </div>
  )
}
