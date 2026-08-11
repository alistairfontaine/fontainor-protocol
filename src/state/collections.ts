// Favorites + listening history, persisted to localStorage (F10).
//
// Favorites are stored as a timestamped replica (v2): alongside the ordered
// id list we keep per-id `likedAt` and `unlikedAt` (tombstone) times. The
// wallet-portable sync layer merges replicas last-write-wins per id, so an
// unlike on one device can no longer be resurrected by another device
// pushing a stale union (the old v1 bug).
import { useCallback, useSyncExternalStore } from 'react'

const FAV_KEY_V1 = 'fontainor_favorites_v1'
const FAV_KEY = 'fontainor_favorites_v2'
const HIST_KEY = 'fontainor_history_v1'
const HIST_MAX = 100
// Tombstones older than this are pruned — every device has synced by then.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

type Listener = () => void

export interface FavoritesState {
  /** Liked ids in display order. */
  ids: string[]
  /** id → ms the like was made (or first seen). */
  likedAt: Record<string, number>
  /** id → ms the unlike was made. Tombstones that make unlikes portable. */
  unlikedAt: Record<string, number>
}

function emptyState(): FavoritesState {
  return { ids: [], likedAt: {}, unlikedAt: {} }
}

function sanitize(raw: unknown): FavoritesState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Partial<FavoritesState>
  if (!Array.isArray(o.ids)) return null
  const state = emptyState()
  state.ids = o.ids.map(String)
  for (const [k, v] of Object.entries(o.likedAt ?? {})) if (Number.isFinite(Number(v))) state.likedAt[k] = Number(v)
  for (const [k, v] of Object.entries(o.unlikedAt ?? {})) if (Number.isFinite(Number(v))) state.unlikedAt[k] = Number(v)
  return state
}

// --- favorites store ---------------------------------------------------------

let favCache: FavoritesState = loadFavorites()
const favListeners = new Set<Listener>()
// useSyncExternalStore needs a stable snapshot reference for the ids array.
let idsSnapshot: string[] = favCache.ids

function loadFavorites(): FavoritesState {
  try {
    const raw = localStorage.getItem(FAV_KEY)
    const parsed = raw ? sanitize(JSON.parse(raw) as unknown) : null
    if (parsed) return parsed
    // One-time migration from the v1 bare array. Likes get timestamp 1
    // ("ancient"), so any explicit action on another device wins the merge.
    const v1 = localStorage.getItem(FAV_KEY_V1)
    const arr = v1 ? (JSON.parse(v1) as unknown) : []
    const state = emptyState()
    if (Array.isArray(arr)) {
      state.ids = arr.map(String)
      for (const id of state.ids) state.likedAt[id] = 1
    }
    return state
  } catch {
    return emptyState()
  }
}

function saveFavorites(next: FavoritesState) {
  // Prune expired tombstones on every write.
  const now = Date.now()
  for (const [id, ts] of Object.entries(next.unlikedAt)) {
    if (now - ts > TOMBSTONE_TTL_MS) delete next.unlikedAt[id]
  }
  favCache = next
  idsSnapshot = next.ids
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(next))
  } catch {
    /* storage full/blocked — keep in-memory */
  }
  favListeners.forEach((l) => l())
}

export function useFavorites() {
  const ids = useSyncExternalStore(
    (l: Listener) => {
      favListeners.add(l)
      return () => favListeners.delete(l)
    },
    () => idsSnapshot,
  )
  const toggle = useCallback((id: string) => {
    const cur = favCache
    const now = Date.now()
    if (cur.ids.includes(id)) {
      const likedAt = { ...cur.likedAt }
      delete likedAt[id]
      saveFavorites({ ids: cur.ids.filter((x) => x !== id), likedAt, unlikedAt: { ...cur.unlikedAt, [id]: now } })
    } else {
      const unlikedAt = { ...cur.unlikedAt }
      delete unlikedAt[id]
      saveFavorites({ ids: [...cur.ids, id], likedAt: { ...cur.likedAt, [id]: now }, unlikedAt })
    }
  }, [])
  const has = useCallback((id: string) => favCache.ids.includes(id), [])
  return { ids, toggle, has }
}

// --- Non-hook access for the wallet-portable sync layer (src/lib/profileSync.ts) ---

export function getFavoriteIds(): string[] {
  return favCache.ids
}

export function getFavoritesState(): FavoritesState {
  return favCache
}

/** Merge a server/remote replica last-write-wins per id. Saves (and notifies)
 *  only on change. Returns the merged local state. */
export function mergeFavoritesState(remote: Partial<FavoritesState>): FavoritesState {
  const a = favCache
  const b: FavoritesState = {
    ids: Array.isArray(remote.ids) ? remote.ids.map(String) : [],
    likedAt: {},
    unlikedAt: {},
  }
  for (const [k, v] of Object.entries(remote.likedAt ?? {})) if (Number.isFinite(Number(v))) b.likedAt[k] = Number(v)
  for (const [k, v] of Object.entries(remote.unlikedAt ?? {})) if (Number.isFinite(Number(v))) b.unlikedAt[k] = Number(v)

  const likedAt: Record<string, number> = {}
  const unlikedAt: Record<string, number> = {}
  const all = new Set([...a.ids, ...b.ids, ...Object.keys(a.unlikedAt), ...Object.keys(b.unlikedAt)])
  for (const id of all) {
    const like = Math.max(a.likedAt[id] ?? (a.ids.includes(id) ? 1 : 0), b.likedAt[id] ?? (b.ids.includes(id) ? 1 : 0))
    const unlike = Math.max(a.unlikedAt[id] ?? 0, b.unlikedAt[id] ?? 0)
    if (like > 0 && like >= unlike) likedAt[id] = like
    else if (unlike > 0) unlikedAt[id] = unlike
  }
  const ids = [...a.ids, ...b.ids.filter((id) => !a.ids.includes(id))].filter((id) => id in likedAt)
  for (const id of Object.keys(likedAt)) if (!ids.includes(id)) ids.push(id)

  const changed =
    ids.length !== a.ids.length ||
    ids.some((id, i) => a.ids[i] !== id) ||
    Object.keys(unlikedAt).length !== Object.keys(a.unlikedAt).length
  if (changed) saveFavorites({ ids, likedAt, unlikedAt })
  else favCache = { ids: a.ids, likedAt, unlikedAt } // keep freshest timestamps without notifying
  return favCache
}

export function subscribeFavorites(l: Listener): () => void {
  favListeners.add(l)
  return () => {
    favListeners.delete(l)
  }
}

// --- history store -----------------------------------------------------------

function makeStore(key: string) {
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

const histStore = makeStore(HIST_KEY)

export function useHistoryLog() {
  const ids = useSyncExternalStore(histStore.subscribe, histStore.get)
  const push = useCallback((id: string) => {
    const cur = histStore.get().filter((x) => x !== id)
    histStore.save([id, ...cur].slice(0, HIST_MAX))
  }, [])
  const clear = useCallback(() => histStore.save([]), [])
  return { ids, push, clear }
}
