// Offline downloads (F59) — native only.
//
// Audio (and cover) are copied into the app's private data dir via
// @capacitor/filesystem; a small localStorage index maps release id →
// file paths. Playback resolves through `playableSrc()`: a downloaded
// track plays from disk (airplane-mode safe), everything else streams.
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

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => resolve((r.result as string).split(',', 2)[1] ?? '')
    r.readAsDataURL(blob)
  })
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

export async function downloadRelease(rel: Release): Promise<void> {
  if (!IS_NATIVE || !rel.audio || isDownloaded(rel.id)) return
  const audioRes = await fetch(remoteUrl(rel.audio))
  if (!audioRes.ok) throw new Error(`audio fetch ${audioRes.status}`)
  const audioBlob = await audioRes.blob()
  const audioPath = `downloads/${rel.id}.mp3`
  await Filesystem.writeFile({
    directory: DIR,
    path: audioPath,
    data: await blobToBase64(audioBlob),
    recursive: true,
  })
  let coverPath: string | null = null
  if (rel.coverUrl) {
    try {
      const coverRes = await fetch(remoteUrl(rel.coverUrl))
      if (coverRes.ok) {
        coverPath = `downloads/${rel.id}.jpg`
        await Filesystem.writeFile({
          directory: DIR,
          path: coverPath,
          data: await blobToBase64(await coverRes.blob()),
          recursive: true,
        })
      }
    } catch {
      coverPath = null // cover is cosmetic; audio is the download
    }
  }
  index = {
    ...index,
    [rel.id]: { id: rel.id, title: rel.title, artist: rel.artist, audioPath, coverPath, bytes: audioBlob.size, at: Date.now() },
  }
  persist()
  try {
    const { uri } = await Filesystem.getUri({ directory: DIR, path: audioPath })
    uriCache = { ...uriCache, [rel.id]: Capacitor.convertFileSrc(uri) }
    emit()
  } catch {
    /* resolved on next launch */
  }
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
let snapshot: { entries: DownloadEntry[]; ids: Set<string> } | null = null
const getSnapshot = () => {
  if (!snapshot) {
    const entries = Object.values(index).sort((a, b) => b.at - a.at)
    snapshot = { entries, ids: new Set(entries.map((e) => e.id)) }
  }
  return snapshot
}
listeners.add(() => {
  snapshot = null
})

export function useDownloads(): { entries: DownloadEntry[]; ids: Set<string> } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot,
    getSnapshot,
  )
}
