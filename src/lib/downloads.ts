// Offline downloads (F59, hardened in v4.1) — native only.
//
// Audio (and cover) land in the app's private data dir; a localStorage index
// maps release id → file paths. Playback asks `localAudioSrc()` for the local
// copy (airplane-mode safe) and streams when there is none; a local file that
// stops decoding is dropped via `dropBrokenDownload()` rather than trusted.
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
import { nativeFetchableUrl } from './api'
import { markGatewayDown, markGatewayUp, mediaCandidates } from './gateways'
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
  /** Remote refs kept so a download survives disappearing from the registry. */
  audioUri?: string | null
  coverUri?: string | null
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
let coverCache: Record<string, string> = {} // id -> convertFileSrc-ed cover URL
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
  const nextCover: Record<string, string> = {}
  for (const e of Object.values(index)) {
    try {
      const { uri } = await Filesystem.getUri({ directory: DIR, path: e.audioPath })
      next[e.id] = Capacitor.convertFileSrc(uri)
    } catch {
      /* file gone — leave unresolved; playback falls back to streaming */
    }
    if (e.coverPath) {
      try {
        const { uri } = await Filesystem.getUri({ directory: DIR, path: e.coverPath })
        nextCover[e.id] = Capacitor.convertFileSrc(uri)
      } catch {
        /* cover gone — generative fallback covers it */
      }
    }
  }
  uriCache = next
  coverCache = nextCover
  emit()
}
void warmUriCache()

/**
 * Absolute, natively-fetchable source for a release's remote audio/cover path.
 * MUST NOT resolve against location.origin: in the app that is the WebView's
 * own https://localhost server, which the downloading Java process cannot
 * reach. See nativeFetchableUrl().
 */
const remoteUrl = nativeFetchableUrl

export function isDownloaded(id: string): boolean {
  return id in index
}

/** Local (offline) audio URL if downloaded and resolvable, else null. */
export function localAudioSrc(id: string): string | null {
  return uriCache[id] ?? null
}

/**
 * Local (offline) cover URL if downloaded and resolvable, else null.
 * Before v4.3.1 the cover was downloaded, stored and deleted again but NEVER
 * read: every screen used the remote coverUrl, so a downloaded release showed
 * no artwork in airplane mode and re-fetched the same JPEG over the network
 * whenever it was online. The bytes were pure waste.
 */
export function localCoverSrc(id: string): string | null {
  return coverCache[id] ?? null
}

/**
 * A Release reconstructed from the download index alone.
 *
 * The Downloads shelf used to intersect the index with the CURRENTLY LOADED
 * registry, which silently hid (and made un-deletable) any download missing
 * from it — including every real published release when the app is offline and
 * falls back to the bundled demo snapshot. The index is authoritative for
 * things the user has on disk.
 */
export function releaseFromDownload(e: DownloadEntry): Release {
  return {
    type: 'release',
    id: e.id,
    title: e.title,
    artist: e.artist,
    label: null,
    tags: [],
    coverUrl: e.coverUri ?? null,
    audio: e.audioUri ?? null,
    arweaveTx: null,
    desc: '',
    status: null,
    date: null,
    price: { amount: 0, currency: 'USD' },
    editions: { total: 0 },
    royaltyBps: 0,
    artistWallet: null,
  }
}

/**
 * A saved file that will not decode is WORSE than no download: playback prefers
 * the local copy, so one bad file breaks a release permanently — even online. This is not hypothetical: the site serves its SPA `index.html` with
 * HTTP 200 for any unknown /audio/* path, so a typo'd or withdrawn audioUri
 * downloads a 2 KB HTML page as `<id>.mp3`. Verify before committing.
 *
 * Metadata of a local file decodes near-instantly; a timeout is treated as OK
 * so a slow device never loses a good download.
 */
function verifyPlayable(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const a = new Audio()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      a.removeAttribute('src')
      resolve(ok)
    }
    const timer = setTimeout(() => finish(true), 15000)
    a.addEventListener('loadedmetadata', () => finish(true))
    a.addEventListener('error', () => finish(false))
    a.preload = 'metadata'
    a.src = src
    a.load()
  })
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
  const audioPath = `downloads/${rel.id}.mp3`
  // One gateway being unreachable must not mean "this release cannot be saved":
  // the same permanent bytes are served by every gateway that knows the id.
  const urls = mediaCandidates(rel.audio).map(remoteUrl)
  setProgress(rel.id, { state: 'downloading', pct: 0 })

  /** Download + verify from ONE url. Throws (and leaves no audio file) on failure. */
  const attempt = async (url: string): Promise<{ bytes: number; localSrc: string }> => {
    inflightByUrl.set(url, rel.id)
    try {
      // Native-side streaming download — nothing crosses the JS bridge.
      await Filesystem.downloadFile({ url, directory: DIR, path: audioPath, progress: true, recursive: true })
      let bytes = 0
      try {
        bytes = (await Filesystem.stat({ directory: DIR, path: audioPath })).size
      } catch {
        /* size is cosmetic */
      }
      // Resolve the local URI first: it is needed both to verify the file and
      // to play it back.
      const localSrc = Capacitor.convertFileSrc((await Filesystem.getUri({ directory: DIR, path: audioPath })).uri)
      if (!(await verifyPlayable(localSrc))) {
        throw new Error('The server did not return playable audio for this release.')
      }
      markGatewayUp(url)
      return { bytes, localSrc }
    } catch (err) {
      markGatewayDown(url)
      try {
        await Filesystem.deleteFile({ directory: DIR, path: audioPath })
      } catch {
        /* nothing written */
      }
      throw err
    } finally {
      inflightByUrl.delete(url)
    }
  }

  try {
    let saved: { bytes: number; localSrc: string } | null = null
    let lastErr: unknown = new Error('No source available for this release.')
    for (const url of urls) {
      try {
        saved = await attempt(url)
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (!saved) throw lastErr
    const { bytes, localSrc } = saved

    let coverPath: string | null = null
    if (rel.coverUrl) {
      try {
        coverPath = `downloads/${rel.id}.jpg`
        await Filesystem.downloadFile({ url: remoteUrl(mediaCandidates(rel.coverUrl)[0] ?? rel.coverUrl), directory: DIR, path: coverPath, recursive: true })
      } catch {
        coverPath = null // cover is cosmetic; audio is the download
      }
    }
    index = {
      ...index,
      [rel.id]: {
        id: rel.id,
        title: rel.title,
        artist: rel.artist,
        audioPath,
        coverPath,
        bytes,
        at: Date.now(),
        audioUri: rel.audio,
        coverUri: rel.coverUrl,
      },
    }
    uriCache = { ...uriCache, [rel.id]: localSrc }
    if (coverPath) {
      try {
        const { uri } = await Filesystem.getUri({ directory: DIR, path: coverPath })
        coverCache = { ...coverCache, [rel.id]: Capacitor.convertFileSrc(uri) }
      } catch {
        /* cosmetic */
      }
    }
    setProgress(rel.id, null)
    persist()
  } catch (e) {
    // Failed / cancelled / unplayable: clean up BOTH files so a retry starts
    // clean, and surface a retryable error state.
    for (const p of [audioPath, `downloads/${rel.id}.jpg`]) {
      try {
        await Filesystem.deleteFile({ directory: DIR, path: p })
      } catch {
        /* nothing written */
      }
    }
    setProgress(rel.id, { state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Forget a download whose file stopped working (deleted by the OS, corrupted,
 * storage evicted). Playback calls this so it can fall back to streaming
 * instead of insisting on a dead file.
 */
export async function dropBrokenDownload(id: string): Promise<void> {
  await removeDownload(id)
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
  const { [id]: _g3, ...restCover } = coverCache
  coverCache = restCover
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
