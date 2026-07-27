// Artist follows + new-release awareness (F33), persisted to localStorage.
// Zero-backend by design: a follow is a local subscription, and "new for you"
// is computed by diffing the public registry against the moment you last
// checked in. No accounts, no email, nothing leaves the device.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Release } from '../lib/registry'

const FOLLOWS_KEY = 'fontainor_follows_v1'
const SEEN_KEY = 'fontainor_follows_seen_v1'

type Listener = () => void

function normArtist(name: string): string {
  return name.trim().toLowerCase()
}

function makeStringStore(key: string) {
  let cache: string[] = load()
  const listeners = new Set<Listener>()

  function load(): string[] {
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }

  function save(next: string[]) {
    cache = next
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      /* storage full/blocked — keep in-memory */
    }
    listeners.forEach((l) => l())
  }

  return {
    subscribe(l: Listener) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    get: () => cache,
    save,
  }
}

const followStore = makeStringStore(FOLLOWS_KEY)

// seen store: single ISO timestamp of the last time the user acknowledged
// their "new from followed artists" list.
const seenListeners = new Set<Listener>()
let seenCache: string = loadSeen()

function loadSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) || ''
  } catch {
    return ''
  }
}

function saveSeen(iso: string) {
  seenCache = iso
  try {
    localStorage.setItem(SEEN_KEY, iso)
  } catch {
    /* best effort */
  }
  seenListeners.forEach((l) => l())
}

function subscribeSeen(l: Listener) {
  seenListeners.add(l)
  return () => seenListeners.delete(l)
}

export function useFollows() {
  const artists = useSyncExternalStore(followStore.subscribe, followStore.get)
  const toggle = useCallback((artist: string) => {
    const key = normArtist(artist)
    if (!key) return
    const cur = followStore.get()
    followStore.save(cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key])
  }, [])
  const isFollowing = useCallback((artist: string) => followStore.get().includes(normArtist(artist)), [])
  return { artists, toggle, isFollowing }
}

/**
 * Releases by followed artists that landed after the user's last check-in.
 * First follow sets the baseline to "now" so old catalog doesn't flood the
 * inbox — only genuinely new drops count.
 */
export function useNewFromFollowed(releases: Release[]) {
  const artists = useSyncExternalStore(followStore.subscribe, followStore.get)
  const seenAt = useSyncExternalStore(subscribeSeen, () => seenCache)

  const fresh = useMemo(() => {
    if (artists.length === 0) return []
    const since = seenAt ? Date.parse(seenAt) : Number.POSITIVE_INFINITY
    if (!Number.isFinite(since)) return []
    return releases
      .filter((r) => artists.includes(normArtist(r.artist)))
      .filter((r) => {
        const t = Date.parse(r.date ?? '')
        return Number.isFinite(t) && t > since
      })
      .sort((a, b) => Date.parse(b.date ?? '') - Date.parse(a.date ?? ''))
  }, [releases, artists, seenAt])

  // Baseline moves to max(now, newest visible drop) so future-dated or
  // clock-skewed releases can't re-appear after being acknowledged.
  const markSeen = useCallback(() => {
    const newest = fresh.reduce((m, r) => Math.max(m, Date.parse(r.date ?? '') || 0), Date.now())
    saveSeen(new Date(newest).toISOString())
  }, [fresh])
  return { fresh, markSeen }
}

/** Called on first follow ever, so history before that isn't "new". */
export function ensureSeenBaseline() {
  if (!seenCache) saveSeen(new Date().toISOString())
}
