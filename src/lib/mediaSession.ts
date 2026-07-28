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

export function msSetMetadata(meta: TrackMetadata): void {
  const artwork = meta.artworkUrl
    ? [{ src: new URL(meta.artworkUrl, location.origin).href, sizes: '512x512', type: 'image/jpeg' }]
    : []
  if (isNative) {
    void NativeMediaSession.setMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album ?? 'Fontainor',
      artwork,
    }).catch(() => {})
    return
  }
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
