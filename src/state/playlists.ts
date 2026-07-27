// User playlists (F39), persisted to localStorage. Zero-backend by design,
// same pattern as favorites (F10) and follows (F33): playlists live on this
// device, nothing leaves it, no accounts needed.
import { useCallback, useSyncExternalStore } from 'react'

const KEY = 'fontainor_playlists_v1'

export interface Playlist {
  id: string
  name: string
  createdAt: string
  /** release ids, in play order */
  ids: string[]
}

type Listener = () => void

function isPlaylist(x: unknown): x is Playlist {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.ids)
}

function load(): Playlist[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPlaylist).map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
      ids: p.ids.map(String),
    }))
  } catch {
    return []
  }
}

let cache: Playlist[] = load()
const listeners = new Set<Listener>()

function save(next: Playlist[]) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage full/blocked — keep in-memory */
  }
  listeners.forEach((l) => l())
}

function subscribe(l: Listener) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function newId(): string {
  return `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function usePlaylists() {
  const lists = useSyncExternalStore(subscribe, () => cache)

  const create = useCallback((name: string): Playlist | null => {
    const trimmed = name.trim()
    if (!trimmed) return null
    const pl: Playlist = { id: newId(), name: trimmed.slice(0, 80), createdAt: new Date().toISOString(), ids: [] }
    save([...cache, pl])
    return pl
  }, [])

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    save(cache.map((p) => (p.id === id ? { ...p, name: trimmed.slice(0, 80) } : p)))
  }, [])

  const remove = useCallback((id: string) => {
    save(cache.filter((p) => p.id !== id))
  }, [])

  /** Add a release to a playlist (no duplicates within one playlist). */
  const addTrack = useCallback((id: string, relId: string) => {
    save(cache.map((p) => (p.id === id && !p.ids.includes(relId) ? { ...p, ids: [...p.ids, relId] } : p)))
  }, [])

  const removeTrack = useCallback((id: string, relId: string) => {
    save(cache.map((p) => (p.id === id ? { ...p, ids: p.ids.filter((x) => x !== relId) } : p)))
  }, [])

  /** Move a track one step up (-1) or down (+1) inside a playlist. */
  const moveTrack = useCallback((id: string, index: number, dir: -1 | 1) => {
    save(
      cache.map((p) => {
        if (p.id !== id) return p
        const j = index + dir
        if (index < 0 || index >= p.ids.length || j < 0 || j >= p.ids.length) return p
        const ids = [...p.ids]
        ;[ids[index], ids[j]] = [ids[j], ids[index]]
        return { ...p, ids }
      }),
    )
  }, [])

  return { lists, create, rename, remove, addTrack, removeTrack, moveTrack }
}
