// Favorites + listening history, persisted to localStorage (F10).
import { useCallback, useSyncExternalStore } from 'react'

const FAV_KEY = 'fontainor_favorites_v1'
const HIST_KEY = 'fontainor_history_v1'
const HIST_MAX = 100

type Listener = () => void

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

const favStore = makeStore(FAV_KEY)
const histStore = makeStore(HIST_KEY)

export function useFavorites() {
  const ids = useSyncExternalStore(favStore.subscribe, favStore.get)
  const toggle = useCallback((id: string) => {
    const cur = favStore.get()
    favStore.save(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }, [])
  const has = useCallback((id: string) => favStore.get().includes(id), [])
  return { ids, toggle, has }
}

// --- Non-hook access for the wallet-portable sync layer (src/lib/profileSync.ts) ---

export function getFavoriteIds(): string[] {
  return favStore.get()
}

/** Union server + local likes, local order first. Saves (and notifies) only on change. */
export function mergeFavoriteIds(incoming: string[]): string[] {
  const cur = favStore.get()
  const merged = [...cur, ...incoming.map(String).filter((id) => !cur.includes(id))]
  if (merged.length !== cur.length) favStore.save(merged)
  return favStore.get()
}

export function subscribeFavorites(l: Listener): () => void {
  return favStore.subscribe(l)
}

export function useHistoryLog() {
  const ids = useSyncExternalStore(histStore.subscribe, histStore.get)
  const push = useCallback((id: string) => {
    const cur = histStore.get().filter((x) => x !== id)
    histStore.save([id, ...cur].slice(0, HIST_MAX))
  }, [])
  const clear = useCallback(() => histStore.save([]), [])
  return { ids, push, clear }
}
