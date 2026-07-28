// Media session adapter — one API, two backends.
//
// Native (Capacitor): @capgo/capacitor-media-session drives a real Android
//   MediaSession + mediaPlayback foreground service, so playback gets a
//   lock-screen/notification card with working transport controls and
//   survives the screen turning off.
// Web: the standard `navigator.mediaSession` (best-effort, same behavior
//   as before the native app existed).
//
// All calls are fire-and-forget best-effort: media UI must never be able to
// break actual playback.
import { Capacitor } from '@capacitor/core'
import { MediaSession as NativeMediaSession } from '@capgo/capacitor-media-session'
import { API_BASE } from './api'

const isNative = (() => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
})()

const hasWebMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator

export interface TrackMetadata {
  title: string
  artist: string
  album?: string
  artworkUrl?: string
}

export type MediaAction = 'play' | 'pause' | 'previoustrack' | 'nexttrack' | 'seekto' | 'stop'

export interface MediaActionDetails {
  action: MediaAction
  seekTime?: number | null
}

// ── Native notification artwork (F55) ─────────────────────────────────────
// The registry stores RELATIVE cover paths (/covers/x.jpg). Inside the app
// those resolve to the WebView's virtual origin (https://localhost), which
// the plugin's Java HttpURLConnection can NEVER reach — so the notification
// silently lost its cover on every track. Fix: decode the cover in the
// WebView (where the bundled asset IS reachable), re-encode it as a 512px
// base64 JPEG the plugin decodes locally, and cache per URL. If the canvas
// taints (remote cover without CORS) fall back to an absolute https URL the
// Java side can fetch itself.
const ART_SIZE = 512
const artCache = new Map<string, string | null>()

async function resolveNativeArtwork(rawUrl: string): Promise<string | null> {
  const hit = artCache.get(rawUrl)
  if (hit !== undefined) return hit
  const isAbsolute = /^https?:/i.test(rawUrl)
  // Candidate loads, best first: same-origin bundled asset, then the API host.
  const candidates = isAbsolute
    ? [rawUrl]
    : [new URL(rawUrl, location.origin).href, ...(API_BASE ? [API_BASE + rawUrl] : [])]
  let fallback: string | null = null
  for (const src of candidates) {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      img.src = src
      await img.decode()
      fallback ??= src
      const c = document.createElement('canvas')
      c.width = ART_SIZE
      c.height = ART_SIZE
      const ctx = c.getContext('2d')
      if (!ctx) break
      // cover-fit: center-crop the shorter axis
      const scale = Math.max(ART_SIZE / img.naturalWidth, ART_SIZE / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      ctx.drawImage(img, (ART_SIZE - w) / 2, (ART_SIZE - h) / 2, w, h)
      const dataUrl = c.toDataURL('image/jpeg', 0.82) // throws if tainted
      artCache.set(rawUrl, dataUrl)
      return dataUrl
    } catch {
      /* try next candidate; tainted canvas falls through to fallback */
    }
  }
  // Only a REAL http(s) URL is usable by the Java side; the WebView-origin
  // candidate would 404 there, so prefer the API host if we have one.
  const javaReachable = fallback && !fallback.startsWith(location.origin) ? fallback : isAbsolute ? rawUrl : API_BASE ? API_BASE + rawUrl : null
  artCache.set(rawUrl, javaReachable)
  return javaReachable
}

let metadataToken = 0 // guards against a slow artwork load overwriting a newer track

export function msSetMetadata(meta: TrackMetadata): void {
  if (isNative) {
    const token = ++metadataToken
    const base = { title: meta.title, artist: meta.artist, album: meta.album ?? 'Fontainor' }
    // Text first (instant), artwork the moment it's ready.
    void NativeMediaSession.setMetadata({ ...base, artwork: [] }).catch(() => {})
    if (meta.artworkUrl) {
      void resolveNativeArtwork(meta.artworkUrl)
        .then((src) => {
          if (src == null || token !== metadataToken) return
          return NativeMediaSession.setMetadata({
            ...base,
            artwork: [{ src, sizes: `${ART_SIZE}x${ART_SIZE}`, type: 'image/jpeg' }],
          })
        })
        .catch(() => {})
    }
    return
  }
  const artwork = meta.artworkUrl
    ? [{ src: new URL(meta.artworkUrl, location.origin).href, sizes: '512x512', type: 'image/jpeg' }]
    : []
  if (!hasWebMediaSession) return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album ?? 'Fontainor',
      artwork,
    })
  } catch {
    /* best-effort */
  }
}

export function msSetPlaybackState(playing: boolean): void {
  if (isNative) {
    void NativeMediaSession.setPlaybackState({ playbackState: playing ? 'playing' : 'paused' }).catch(() => {})
    return
  }
  if (!hasWebMediaSession) return
  try {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  } catch {
    /* best-effort */
  }
}

export function msClear(): void {
  if (isNative) {
    void NativeMediaSession.setPlaybackState({ playbackState: 'none' }).catch(() => {})
    return
  }
  if (!hasWebMediaSession) return
  try {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  } catch {
    /* best-effort */
  }
}

export function msSetPosition(duration: number, position: number): void {
  if (!isFinite(duration) || duration <= 0) return
  const clamped = Math.min(Math.max(position, 0), duration)
  if (isNative) {
    void NativeMediaSession.setPositionState({ duration, position: clamped, playbackRate: 1 }).catch(() => {})
    return
  }
  if (!hasWebMediaSession || typeof navigator.mediaSession.setPositionState !== 'function') return
  try {
    navigator.mediaSession.setPositionState({ duration, position: clamped, playbackRate: 1 })
  } catch {
    /* best-effort */
  }
}

/**
 * Bind handlers for the transport actions we support. Returns an unbind fn.
 * Handlers should read fresh state via refs — they are registered once.
 */
export function msBindActions(handler: (details: MediaActionDetails) => void): () => void {
  const actions: MediaAction[] = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'stop']
  if (isNative) {
    for (const action of actions) {
      void NativeMediaSession.setActionHandler({ action }, (details) => {
        handler({ action, seekTime: (details as { seekTime?: number | null })?.seekTime })
      }).catch(() => {})
    }
    return () => {
      for (const action of actions) {
        void NativeMediaSession.setActionHandler({ action }, null).catch(() => {})
      }
    }
  }
  if (!hasWebMediaSession) return () => {}
  const ms = navigator.mediaSession
  for (const action of actions) {
    try {
      ms.setActionHandler(action as MediaSessionAction, (details) => {
        handler({ action, seekTime: details?.seekTime })
      })
    } catch {
      /* action not supported on this platform */
    }
  }
  return () => {
    for (const action of actions) {
      try {
        ms.setActionHandler(action as MediaSessionAction, null)
      } catch {
        /* ignore */
      }
    }
  }
}
