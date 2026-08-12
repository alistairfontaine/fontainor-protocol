// Session stream cache (C40) — Metrolist-inspired.
//
// Metrolist (and ExoPlayer's SimpleCache) keeps recently streamed audio in a
// size-capped local cache so replays are instant and free. The web has no way
// to tee the <audio> element's own network stream without a service worker,
// so this layer does the pragmatic equivalent:
//
//   1. After a track starts streaming from a gateway, `stashStream` fetches
//      the same immutable content once in the background and stores it in
//      CacheStorage. Gateways serve permanent content with long-lived
//      cache-control, so this second fetch is usually satisfied by the
//      browser's HTTP cache — not a second trip over the wire.
//   2. `warmStreamCache` materialises a cached response into a blob URL
//      (async, at preload/queue time). `cachedStreamUrl` then answers
//      synchronously so the player's source-list construction stays sync.
//   3. An LRU index in localStorage enforces a byte cap; the oldest-touched
//      entries are evicted (cache delete + blob URL revoke) when over it.
//
// The cache never replaces real downloads (localAudioSrc wins) and it is a
// pure optimisation: a missing/failed blob URL simply fails over to the
// gateway list exactly like any dead source.
import { contentIdOf } from './gateways'

export const STREAM_CACHE_NAME = 'fontainor-stream-v1'
export const STREAM_CACHE_DEFAULT_BYTES = 256 * 1024 * 1024 // 256 MB
const INDEX_KEY = 'fontainor_stream_cache_index_v1'
/** Settings override (bytes). Metrolist exposes exactly this knob. */
export const STREAM_CACHE_CAP_KEY = 'fontainor_stream_cache_cap_v1'

export function streamCacheCapBytes(): number {
  try {
    const n = Number(localStorage.getItem(STREAM_CACHE_CAP_KEY))
    if (Number.isFinite(n) && n > 0) return n
  } catch {
    /* fall through to default */
  }
  return STREAM_CACHE_DEFAULT_BYTES
}

/** Refuse to cache single files bigger than this — they'd evict everything else. */
function maxItemBytes(): number {
  return Math.min(64 * 1024 * 1024, streamCacheCapBytes())
}

interface IndexEntry {
  key: string
  size: number
  /** last-touched ms — LRU eviction order. */
  at: number
}

/** Canonical cache key: the permanent content id when known, else the URI. */
export function streamKeyOf(uri: string): string {
  return contentIdOf(uri) ?? uri
}

const hasCaches = () => typeof caches !== 'undefined' && typeof caches.open === 'function'

function loadIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (e): e is IndexEntry =>
        !!e && typeof e === 'object' && typeof (e as IndexEntry).key === 'string' && Number.isFinite((e as IndexEntry).size),
    )
  } catch {
    return []
  }
}

function saveIndex(idx: IndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx))
  } catch {
    /* storage blocked — cache still works, eviction just restarts from empty */
  }
}

// contentKey → materialised blob URL, valid for this session.
const materialized = new Map<string, string>()
// keys with a warm/stash already in flight — dedupes concurrent calls.
const inflight = new Set<string>()

/** Cache request URL — a synthetic same-origin path keyed by content id. */
function cacheRequestFor(key: string): string {
  return `/__stream-cache__/${encodeURIComponent(key)}`
}

function touch(key: string): void {
  const idx = loadIndex()
  const e = idx.find((x) => x.key === key)
  if (!e) return
  e.at = Date.now()
  saveIndex(idx)
}

/**
 * Synchronous lookup for the player's source-list construction. Only answers
 * once `warmStreamCache` has materialised the entry this session.
 */
export function cachedStreamUrl(uri: string | null | undefined): string | null {
  if (!uri) return null
  return materialized.get(streamKeyOf(uri)) ?? null
}

/**
 * Materialise a CacheStorage hit into a blob URL so the NEXT sync lookup
 * (preload firing, the user pressing play) is served locally. Fire-and-forget.
 */
export function warmStreamCache(uri: string | null | undefined): void {
  if (!uri || !hasCaches()) return
  const key = streamKeyOf(uri)
  if (materialized.has(key) || inflight.has(key)) return
  inflight.add(key)
  void (async () => {
    try {
      const cache = await caches.open(STREAM_CACHE_NAME)
      const res = await cache.match(cacheRequestFor(key))
      if (!res) {
        // stale index entry with no body — drop it
        const idx = loadIndex()
        if (idx.some((e) => e.key === key)) saveIndex(idx.filter((e) => e.key !== key))
        return
      }
      const blob = await res.blob()
      if (!materialized.has(key)) materialized.set(key, URL.createObjectURL(blob))
      touch(key)
    } catch {
      /* cache unavailable — playback streams as before */
    } finally {
      inflight.delete(key)
    }
  })()
}

/**
 * Store the content behind `fetchUrl` under this uri's key, then evict LRU
 * entries beyond the byte cap. Fire-and-forget; never throws.
 */
export function stashStream(uri: string | null | undefined, fetchUrl: string): void {
  if (!uri || !fetchUrl || !hasCaches()) return
  const key = streamKeyOf(uri)
  if (materialized.has(key) || inflight.has(key)) return
  if (loadIndex().some((e) => e.key === key)) {
    // already cached; just make it usable this session
    warmStreamCache(uri)
    return
  }
  inflight.add(key)
  void (async () => {
    try {
      const res = await fetch(fetchUrl)
      if (!res.ok) return
      const blob = await res.blob()
      if (blob.size <= 0 || blob.size > maxItemBytes()) return
      const cache = await caches.open(STREAM_CACHE_NAME)
      await cache.put(
        cacheRequestFor(key),
        new Response(blob, { headers: { 'content-type': res.headers.get('content-type') ?? 'audio/mpeg' } }),
      )
      const idx = loadIndex().filter((e) => e.key !== key)
      idx.push({ key, size: blob.size, at: Date.now() })
      // LRU eviction: oldest-touched first, never the entry just written.
      const cap = streamCacheCapBytes()
      let total = idx.reduce((s, e) => s + e.size, 0)
      if (total > cap) {
        const byAge = [...idx].sort((a, b) => a.at - b.at)
        for (const victim of byAge) {
          if (total <= cap || victim.key === key) continue
          await cache.delete(cacheRequestFor(victim.key))
          const url = materialized.get(victim.key)
          if (url) {
            URL.revokeObjectURL(url)
            materialized.delete(victim.key)
          }
          idx.splice(idx.indexOf(victim), 1)
          total -= victim.size
        }
      }
      saveIndex(idx)
      if (!materialized.has(key)) materialized.set(key, URL.createObjectURL(blob))
    } catch {
      /* offline mid-fetch, CORS, quota — all fine, purely best-effort */
    } finally {
      inflight.delete(key)
    }
  })()
}

/** Wipe the stream cache (settings/debug). */
export async function clearStreamCache(): Promise<void> {
  try {
    for (const url of materialized.values()) URL.revokeObjectURL(url)
    materialized.clear()
    saveIndex([])
    if (hasCaches()) await caches.delete(STREAM_CACHE_NAME)
  } catch {
    /* best-effort */
  }
}

/** Total bytes currently indexed (for a settings readout). */
export function streamCacheBytes(): number {
  return loadIndex().reduce((s, e) => s + e.size, 0)
}
