import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FixedSizeGrid } from 'react-window'
import { ReleaseCard, ReleaseGrid } from '../components/ReleaseCard'
import { IconLibrary, IconSearch } from '../components/icons'
import { Chip, EmptyState, GridSkeleton, PageHead } from '../components/ui'
import type { Release } from '../lib/registry'
import { useRegistry } from '../state/RegistryContext'

type SortKey = 'newest' | 'title' | 'artist' | 'price'
type TypeFilter = 'all' | 'release' | 'editorial'

const VIRTUALIZE_AT = 60
const GAP = 20
const TEXT_BLOCK = 86

function matches(rel: Release, q: string): boolean {
  const hay = `${rel.title} ${rel.artist} ${rel.label ?? ''} ${rel.tags.join(' ')} ${rel.id}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

function sortItems(items: Release[], sort: SortKey): Release[] {
  const arr = [...items]
  switch (sort) {
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    case 'artist':
      return arr.sort((a, b) => a.artist.localeCompare(b.artist))
    case 'price':
      return arr.sort((a, b) => a.price.amount - b.price.amount)
    default:
      return arr.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  }
}

/** Virtualized grid for large catalogs (500+ stays smooth: only visible rows mount). */
function VirtualGrid({ items }: { items: Release[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const cols = width >= 1100 ? 5 : width >= 860 ? 4 : width >= 620 ? 3 : 2
  const colWidth = width > 0 ? Math.floor(width / cols) : 0
  const rowHeight = colWidth - GAP + TEXT_BLOCK + GAP
  const height = Math.min(Math.max(560, window.innerHeight - 320), 780)

  return (
    <div ref={wrapRef}>
      {width > 0 && (
        <FixedSizeGrid
          columnCount={cols}
          columnWidth={colWidth}
          rowCount={Math.ceil(items.length / cols)}
          rowHeight={rowHeight}
          width={width}
          height={height}
          style={{ overflowX: 'hidden' }}
        >
          {({ columnIndex, rowIndex, style }) => {
            const rel = items[rowIndex * cols + columnIndex]
            if (!rel) return null
            return (
              <div style={{ ...style, padding: `0 ${GAP}px ${GAP}px 0` }}>
                <ReleaseCard rel={rel} />
              </div>
            )
          }}
        </FixedSizeGrid>
      )}
    </div>
  )
}

export default function Library() {
  const { releases, loading } = useRegistry()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')

  const filtered = useMemo(() => {
    let items = releases
    if (type !== 'all') items = items.filter((r) => r.type === type)
    if (q) items = items.filter((r) => matches(r, q))
    return sortItems(items, sort)
  }, [releases, q, type, sort])

  return (
    <>
      <PageHead
        title="Library"
        sub="Everything etched into the registry — searchable, sortable, permanent."
        right={
          <span className="text-[13px] tabular-nums text-faint">
            {loading ? '…' : `${filtered.length} item${filtered.length === 1 ? '' : 's'}`}
          </span>
        }
      />

      {/* toolbar */}
      <div className="mb-7 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:hidden">
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
            placeholder="Search releases, artists, tags…"
            className="h-11 w-full rounded-btn border border-line bg-surface pl-10 pr-4 text-sm text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
            aria-label="Search the registry"
          />
        </div>
        <Chip active={type === 'all'} onClick={() => setType('all')}>
          All
        </Chip>
        <Chip active={type === 'release'} onClick={() => setType('release')}>
          Releases
        </Chip>
        <Chip active={type === 'editorial'} onClick={() => setType('editorial')}>
          Articles
        </Chip>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-auto h-9 cursor-pointer rounded-chip border border-line bg-surface px-3 text-[13px] text-body focus:outline-none"
          aria-label="Sort library"
        >
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
          <option value="price">Price low–high</option>
        </select>
      </div>

      {q && (
        <p className="mb-5 text-sm text-muted">
          Results for <span className="font-medium text-ink">“{q}”</span>{' '}
          <button onClick={() => setParams({}, { replace: true })} className="ml-1 cursor-pointer text-accent hover:underline">
            clear
          </button>
        </p>
      )}

      {loading ? (
        <GridSkeleton count={10} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={q ? <IconSearch size={26} /> : <IconLibrary size={26} />}
          title={q ? `Nothing matches “${q}”` : 'The library is empty'}
          body={
            q
              ? 'Try fewer or different words — search covers titles, artists, labels, and tags.'
              : 'Releases published to the registry appear here permanently.'
          }
        />
      ) : filtered.length >= VIRTUALIZE_AT ? (
        <VirtualGrid items={filtered} />
      ) : (
        <ReleaseGrid items={filtered} />
      )}
    </>
  )
}
