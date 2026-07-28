// Offline downloads (F59, hardened in v4.1) — native only.
//
// Audio (and cover) land in the app's private data dir; a localStorage index
// maps release id → file paths. Playback resolves through `playableSrc()`:
// a downloaded track plays from disk (airplane-mode safe), else streams.
//
// v4.1 CRASH FIX + progress: v4.0.0 fetched the MP3 into the WebView and
// pushed it across the Capacitor bridge as ONE multi-megabyte base64 string
// (Filesystem.writeFile). Huge bridge messages OOM/kill the Android renderer
// — "clicking download crashes the app" on device. Now the NATIVE layer
// downloads straight to disk (Filesystem.downloadFile): zero bytes cross the
// bridge, and its 'progress' events drive a YouTube-style per-item progress
// UI (downloading % → downloaded, with error + retry states).
// Web builds keep the API surface but every operation is a no-op.
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { useSyncExternalStore } from 'react'
import { IS_NATIVE } from './platform'
import type { Release } from './registry'

export interface DownloadEntry {
  id: string
  title: string
  artist: string
  audioPath: string
  coverPath: string | null
  bytes: number
  at: number
}

const KEY = 'fontainor.downloads.v1'
const DIR = Directory.Data

function load(): Record<string, DownloadEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, DownloadEntry>
  } catch {
    return {}
  }
}

let index: Record<string, DownloadEntry> = load()
let uriCache: Record<string, string> = {} // id -> convertFileSrc-ed audio URL
const listeners = new Set<() => void>()
const emit = () => {
  listeners.forEach((l) => l())
}
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(index))
  } catch {
    /* best-effort */
  }
  emit()
}

// Resolve file paths to WebView-fetchable URLs once at startup (getUri is
// async; playNow needs a synchronous answer).
async function warmUriCache(): Promise<void> {
  if (!IS_NATIVE) return
  const next: Record<string, string> = {}
  for (const e of Object.values(index)) {
    try {
      const { uri } = await Filesystem.getUri({ directory: DIR, path: e.audioPath })
      next[e.id] = Capacitor.convertFileSrc(uri)
    } catch {
      /* file gone — leave unresolved; playback falls back to streaming */
    }
  }
  uriCache = next
  emit()
}
void warmUriCache()

/** Absolute, fetchable source for a release's remote audio/cover path. */
function remoteUrl(path: string): string {
  if (/^https?:/i.test(path)) return path
  return new URL(path, location.origin).href
}

export function isDownloaded(id: string): boolean {
  return id in index
}

/** Local (offline) audio URL if downloaded and resolvable, else null. */
export function localAudioSrc(id: string): string | null {
  return uriCache[id] ?? null
}

/** The URL playback should use: local file when we have it, else the stream. */
export function playableSrc(rel: Release): string | null {
  return localAudioSrc(rel.id) ?? rel.audio
}

// ── download progress (YouTube-style states) ──
export type DownloadProgress =
  | { state: 'downloading'; pct: number | null } // null = size unknown
  | { state: 'error'; message: string }

let progressMap: Record<string, DownloadProgress> = {}
const setProgress = (id: string, p: DownloadProgress | null) => {
  if (p) progressMap = { ...progressMap, [id]: p }
  else {
    const { [id]: _gone, ...rest } = progressMap
    progressMap = rest
  }
  emit()
}

// One shared native progress listener; downloadFile progress events carry the
// URL, so in-flight downloads register themselves here by URL.
const inflightByUrl = new Map<string, string>() // url -> release id
let progressListenerArmed = false
function armProgressListener(): void {
  if (progressListenerArmed || !IS_NATIVE) return
  progressListenerArmed = true
  void Filesystem.addListener('progress', (st) => {
    const id = inflightByUrl.get(st.url)
    if (!id) return
    const pct = st.contentLength > 0 ? Math.min(100, Math.round((st.bytes / st.contentLength) * 100)) : null
    setProgress(id, { state: 'downloading', pct })
  })
}

export async function downloadRelease(rel: Release): Promise<void> {
  if (!IS_NATIVE || !rel.audio || isDownloaded(rel.id)) return
  if (progressMap[rel.id]?.state === 'downloading') return // already in flight
  armProgressListener()
  const url = remoteUrl(rel.audio)
  const audioPath = `downloads/${rel.id}.mp3`
  inflightByUrl.set(url, rel.id)
  setProgress(rel.id, { state: 'downloading', pct: 0 })
  try {
    // Native-side streaming download — nothing crosses the JS bridge.
    await Filesystem.downloadFile({ url, directory: DIR, path: audioPath, progress: true, recursive: true })
    let bytes = 0
    try {
      bytes = (await Filesystem.stat({ directory: DIR, path: audioPath })).size
    } catch {
      /* size is cosmetic */
    }
    let coverPath: string | null = null
    if (rel.coverUrl) {
      try {
        coverPath = `downloads/${rel.id}.jpg`
        await Filesystem.downloadFile({ url: remoteUrl(rel.coverUrl), directory: DIR, path: coverPath, recursive: true })
      } catch {
        coverPath = null // cover is cosmetic; audio is the download
      }
    }
    index = {
      ...index,
      [rel.id]: { id: rel.id, title: rel.title, artist: rel.artist, audioPath, coverPath, bytes, at: Date.now() },
    }
    setProgress(rel.id, null)
    persist()
    try {
      const { uri } = await Filesystem.getUri({ directory: DIR, path: audioPath })
      uriCache = { ...uriCache, [rel.id]: Capacitor.convertFileSrc(uri) }
      emit()
    } catch {
      /* resolved on next launch */
    }
  } catch (e) {
    // Failed/cancelled: clean partial file, surface a retryable error state.
    try {
      await Filesystem.deleteFile({ directory: DIR, path: audioPath })
    } catch {
      /* nothing written */
    }
    setProgress(rel.id, { state: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    inflightByUrl.delete(url)
  }
}

/** Clear an error state (dismiss / before retry). */
export function clearDownloadError(id: string): void {
  if (progressMap[id]?.state === 'error') setProgress(id, null)
}

export async function removeDownload(id: string): Promise<void> {
  const e = index[id]
  if (!e) return
  for (const p of [e.audioPath, e.coverPath]) {
    if (!p) continue
    try {
      await Filesystem.deleteFile({ directory: DIR, path: p })
    } catch {
      /* already gone */
    }
  }
  const { [id]: _gone, ...rest } = index
  index = rest
  const { [id]: _g2, ...restUri } = uriCache
  uriCache = restUri
  persist()
}

// ── React binding ──
export interface DownloadsSnapshot {
  entries: DownloadEntry[]
  ids: Set<string>
  progress: Record<string, DownloadProgress>
}
let snapshot: DownloadsSnapshot | null = null
const getSnapshot = () => {
  if (!snapshot) {
    const entries = Object.values(index).sort((a, b) => b.at - a.at)
    snapshot = { entries, ids: new Set(entries.map((e) => e.id)), progress: progressMap }
  }
  return snapshot
}
listeners.add(() => {
  snapshot = null
})

export function useDownloads(): DownloadsSnapshot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot,
    getSnapshot,
  )
}
