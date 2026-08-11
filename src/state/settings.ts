// App settings (v4.4) — a tiny localStorage-backed store with the same
// useSyncExternalStore pattern as favorites. Settings are device-local by
// design: "Wi-Fi only" describes THIS device's data plan, not the account.
import { useCallback, useSyncExternalStore } from 'react'

export interface Settings {
  /** Queue downloads while on a metered connection; start them on Wi-Fi. */
  wifiOnlyDownloads: boolean
  /** Download a release automatically when it is liked (native only). */
  autoDownloadLikes: boolean
}

const KEY = 'fontainor_settings_v1'

const DEFAULTS: Settings = {
  wifiOnlyDownloads: false,
  autoDownloadLikes: false,
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    return {
      wifiOnlyDownloads: typeof parsed.wifiOnlyDownloads === 'boolean' ? parsed.wifiOnlyDownloads : DEFAULTS.wifiOnlyDownloads,
      autoDownloadLikes: typeof parsed.autoDownloadLikes === 'boolean' ? parsed.autoDownloadLikes : DEFAULTS.autoDownloadLikes,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let cache: Settings = load()
const listeners = new Set<() => void>()

export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  return cache[key]
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  if (cache[key] === value) return
  cache = { ...cache, [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage full/blocked — keep in-memory */
  }
  listeners.forEach((l) => l())
}

export function useSettings() {
  const settings = useSyncExternalStore(
    (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => cache,
  )
  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setSetting(key, value), [])
  return { settings, set }
}
