import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ReleaseCard, ReleaseGrid } from '../components/ReleaseCard'
import { IconClose, IconSearch, IconTag } from '../components/icons'
import { Chip, EmptyState, GridSkeleton, PageHead } from '../components/ui'
import { fetchTopPlays, type TopPlay } from '../lib/plays'
import type { Release } from '../lib/registry'
import { useRegistry } from '../state/RegistryContext'

// A dedicated discovery destination (distinct from the raw /library list):
// a big search field with live results, the searcher's own recent queries,
// trending releases this week, and the most common tags to browse into. This
// mirrors the "Search tab" pattern every major music app uses — a place to
// start when you don't yet have a query, not just a filtered list.

const RECENT_KEY = 'fontainor_recent_searches_v1'
const RECENT_MAX = 8

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}
function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {
    /* private mode — recents just don't persist */
  }
}

function matches(rel: Release, q: string): boolean {
  const hay = `${rel.title} ${rel.artist} ${rel.label ?? ''} ${rel.tags.join(' ')} ${rel.id}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term))
}

export default function Search() {
  const { releases, loading } = useRegistry()
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const [q, setQ] = useState(urlQ)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [top, setTop] = useState<TopPlay[]>([])
  const commitRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // keep the box synced if the URL query changes (e.g. header search deep-link)
  useEffect(() => {
    setQ(urlQ)
  }, [urlQ])

  useEffect(() => {
    let alive = true
    void fetchTopPlays('week', 12).then((t) => {
      if (alive) setTop(t)
    })
    return () => {
      alive = false
    }
  }, [])

  // Reflect the query into the URL (debounced) so a search is shareable and
  // Back-navigable, and record a recent search once the user pauses typing.
  useEffect(() => {
    if (commitRef.current) clearTimeout(commitRef.current)
    commitRef.current = setTimeout(() => {
      setParams(q ? { q } : {}, { replace: true })
      const trimmed = q.trim()
      if (trimmed.length >= 2) {
        setRecent((prev) => {
          const next = [trimmed, ...prev.filter((r) => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_MAX)
          saveRecent(next)
          return next
        })
      }
    }, 350)
    return () => {
      if (commitRef.current) clearTimeout(commitRef.current)
    }
  }, [q, setParams])

  const results = useMemo(() => {
    if (!q.trim()) return []
    return releases.filter((r) => matches(r, q)).slice(0, 60)
  }, [releases, q])

  const trending = useMemo(() => {
    const byId = new Map(releases.map((r) => [r.id, r]))
    return top
      .map((t) => byId.get(t.id))
      .filter((r): r is Release => Boolean(r && r.type === 'release'))
      .slice(0, 8)
  }, [top, releases])

  const topTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of releases) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t)
  }, [releases])

  const clearRecent = () => {
    setRecent([])
    saveRecent([])
  }

  return (
    <>
      <PageHead title="Search" sub="Find any release, artist, or tag etched into the registry." />

      <div className="relative mb-8">
        <IconSearch size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search releases, artists, tags…"
          aria-label="Search the registry"
          className="h-14 w-full rounded-card border border-line bg-surface pl-12 pr-12 text-base text-ink placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQ('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-faint transition-colors hover:text-ink"
          >
            <IconClose size={18} />
          </button>
        )}
      </div>

      {q.trim() ? (
        loading ? (
          <GridSkeleton count={8} />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<IconSearch size={26} />}
            title={`Nothing matches “${q}”`}
            body="Try fewer or different words — search covers titles, artists, labels, and tags."
          />
        ) : (
          <>
            <p className="mb-5 text-sm text-muted">
              {results.length} result{results.length === 1 ? '' : 's'} for{' '}
              <span className="font-medium text-ink">“{q}”</span>
            </p>
            <ReleaseGrid items={results} />
          </>
        )
      ) : (
        <div className="space-y-11">
          {recent.length > 0 && (
            <section aria-label="Recent searches">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Recent</h2>
                <button onClick={clearRecent} className="cursor-pointer text-[13px] text-accent hover:underline">
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {recent.map((r) => (
                  <Chip key={r} onClick={() => setQ(r)}>
                    {r}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {topTags.length > 0 && (
            <section aria-label="Browse by tag">
              <div className="mb-4 flex items-baseline gap-2">
                <IconTag size={17} className="text-faint" />
                <h2 className="text-lg font-semibold">Browse tags</h2>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {topTags.map((t) => (
                  <Chip key={t} onClick={() => setQ(t)}>
                    {t}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {trending.length > 0 && (
            <section aria-label="Trending this week">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Trending this week</h2>
                <span className="text-[13px] text-faint">Most played across the registry</span>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
                {trending.map((rel) => (
                  <ReleaseCard key={rel.id} rel={rel} />
                ))}
              </div>
            </section>
          )}

          {recent.length === 0 && trending.length === 0 && topTags.length === 0 && !loading && (
            <EmptyState
              icon={<IconSearch size={26} />}
              title="Search the registry"
              body="Start typing to find releases, artists, and tags. Trending picks appear here as the platform grows."
            />
          )}
        </div>
      )}
    </>
  )
}
