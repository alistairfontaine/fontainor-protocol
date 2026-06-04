import React, { useState, useMemo } from 'react'
import { useLibrary } from '../../hooks/useLibrary.js'
import { LibraryToolbar } from './LibraryToolbar.jsx'
import { LibraryGrid } from './LibraryGrid.jsx'
import { normalizeOne } from '../../lib/registry.js'
// Generate N synthetic registry items (schema-shaped) to prove grid performance.
function makeSynthetic(n) {
  const artists = ['Aoi', 'Reverie', 'Null Set', 'Komorebi', 'Vesper', 'Static Bloom', 'Mono No', 'Hikari', 'Drift', 'Pale Hour']
  const words = ['Echoes', 'Glass', 'Tide', 'Neon', 'Hollow', 'Ember', 'Signal', 'Dawn', 'Velvet', 'Fracture', 'Lull', 'Mirror', 'Aether', 'Pulse']
  const tagPool = ['ambient', 'electronic', 'lofi', 'experimental', 'house', 'downtempo', 'shoegaze', 'techno', 'drone', 'pop']
  const out = []
  for (let i = 0; i < n; i++) {
    const a = artists[i % artists.length]
    const title = words[(i * 7) % words.length] + ' ' + words[(i * 13 + 3) % words.length]
    const tags = [tagPool[i % tagPool.length], tagPool[(i * 3 + 1) % tagPool.length]]
    const free = i % 5 === 0
    out.push(normalizeOne({
      id: 'SYNTH-' + String(i).padStart(4, '0'),
      title, artist: a,
      price: { amount: free ? 0 : (1 + (i % 40)) + 0.99, currency: 'USD' },
      editions: { total: i % 3 === 0 ? 0 : 50 + (i % 200) },
      status: 'REGISTERED_ON_FONTAINOR',
      date: new Date(Date.now() - i * 36e5).toISOString(),
      tags,
      audioUri: null,
      coverUri: null,
    }))
  }
  return out
}
export function LibraryView({ store, onOpen }) {
  const [synthCount, setSynthCount] = useState(0)
  const synthetic = useMemo(() => (synthCount ? makeSynthetic(synthCount) : []), [synthCount])
  // real registry items + (optional) synthetic perf set
  const source = useMemo(() => [...store.releases, ...synthetic], [store.releases, synthetic])
  const lib = useLibrary(source)
  return (
    <main>
      <h1 className="page">Library</h1>
      <p className="sub">Browse the full registry. Search, sort, and filter across every release.</p>
      {/* dev-only performance proof toggle */}
      <div className="lib-perf">
        <span className="lib-perf-label">Performance test:</span>
        {[0, 100, 500, 2000].map((n) => (
          <button key={n} className={'lib-perf-btn' + (synthCount === n ? ' on' : '')} onClick={() => setSynthCount(n)}>
            {n === 0 ? 'Off' : '+' + n}
          </button>
        ))}
        {synthCount > 0 && <span className="lib-perf-note">{synthCount} synthetic items added (virtualized)</span>}
      </div>
      <LibraryToolbar lib={lib} />
      <LibraryGrid items={lib.items} store={store} onOpen={onOpen} />
    </main>
  )
}
