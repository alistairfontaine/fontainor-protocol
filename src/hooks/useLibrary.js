import { useMemo, useState, useEffect, useRef } from 'react'

// Pure data transformation for the library: search + sort + filter.
// Operates on the already-loaded, normalized releases array (fast, in-memory).
export function useLibrary(releases) {
  const [queryRaw, setQueryRaw] = useState('')
  const [query, setQuery] = useState('')      // debounced
  const [sort, setSort] = useState('newest')  // newest | title | artist | price
  const [filter, setFilter] = useState('all') // all | free | sale | sold

  // debounce the search input (~150ms) so typing stays smooth
  const t = useRef(null)
  useEffect(() => {
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => setQuery(queryRaw.trim().toLowerCase()), 150)
    return () => t.current && clearTimeout(t.current)
  }, [queryRaw])

  const result = useMemo(() => {
    let list = releases

    // ---- search: title, artist, id, and tags ----
    if (query) {
      list = list.filter((r) => {
        const hay = [
          r.title, r.artist, r.id,
          ...(Array.isArray(r.tags) ? r.tags : []),
        ].join(' ').toLowerCase()
        return hay.includes(query)
      })
    }

    // ---- filter ----
    if (filter !== 'all') {
      list = list.filter((r) => {
        const free = !r.price || r.price.amount === 0 || r.price.amount == null
        const sold = r.editions && r.editions.total > 0 && r.editions.minted != null && r.editions.minted >= r.editions.total
        if (filter === 'free') return free
        if (filter === 'sale') return !free && !sold
        if (filter === 'sold') return sold
        return true
      })
    }

    // ---- sort (copy first so we don't mutate the source) ----
    const sorted = list.slice()
    if (sort === 'newest') {
      sorted.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    } else if (sort === 'title') {
      sorted.sort((a, b) => String(a.title).localeCompare(String(b.title)))
    } else if (sort === 'artist') {
      sorted.sort((a, b) => String(a.artist).localeCompare(String(b.artist)))
    } else if (sort === 'price') {
      sorted.sort((a, b) => (a.price?.amount || 0) - (b.price?.amount || 0))
    }
    return sorted
  }, [releases, query, sort, filter])

  return {
    items: result,
    total: releases.length,
    shown: result.length,
    query: queryRaw, setQuery: setQueryRaw,
    sort, setSort,
    filter, setFilter,
  }
}
